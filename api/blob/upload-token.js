import { clerkSecretKey } from '../_lib/clerk-config.js';
import { resolveEmail } from '../_lib/auth.js';
import { resolveWorkspaceIdentity } from '../_lib/auth-identities.js';
// Issues short-lived client upload tokens for Vercel Blob direct-from-browser uploads.
// Used by the UGC Editor to upload multi-GB source videos without proxying through
// a Vercel function.
//
// Auth: @vercel/blob/client.upload() uses its own internal fetch which does NOT go
// through the global Authorization-header interceptor, so we can't use the standard
// Bearer-token gate here. Instead, the client passes its Clerk session JWT via
// `clientPayload`, and we verify it inside onBeforeGenerateToken.
import { handleUpload } from '@vercel/blob/client';
import { verifyToken } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import { getAppAccess, hasPermission } from '../_lib/app-access.js';
import { checkRateLimit, rateLimitKey, sendRateLimited } from '../_lib/rate-limit.js';

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Server-side sanity check so any silent prod misconfiguration shows up in
  // the response instead of looking like a generic "Access denied" from Blob.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN is not set in this function environment' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rate = await checkRateLimit(sql, {
      route: 'blob-upload-token:post',
      key: rateLimitKey(req),
      limit: 60,
      windowSeconds: 10 * 60,
    });
    if (!rate.allowed) return sendRateLimited(res, rate);

    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Local-dev escape hatch — matches requireAuth's behavior.
        const isLocalBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED === 'true';
        if (!isLocalBypass) {
          if (!clerkSecretKey()) throw new Error('CLERK_SECRET_KEY not configured');
          if (!clientPayload) throw new Error('Unauthorized — clientPayload missing');
          try {
            const payload = await verifyToken(clientPayload, { secretKey: clerkSecretKey() });
            const email = await resolveEmail(payload.sub, payload.email);
            const userId = process.env.CLERK_IDENTITY_MIGRATION_ISSUER === payload.iss
              ? await resolveWorkspaceIdentity(sql,{issuer:payload.iss,subject:payload.sub,email}) : payload.sub;
            const access = await getAppAccess({
              userId, email,
            });
            if (!access.user || access.user.status !== 'active') throw new Error('Active workspace membership required');
            if (!hasPermission(access, 'assets.write') && !hasPermission(access, 'creators.write')) {
              throw new Error('assets.write or creators.write required');
            }
          } catch (err) {
            throw new Error(`Unauthorized — ${err.message}`);
          }
        }
        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/webm',
            'video/x-matroska',
            'video/mpeg',
            'image/jpeg',
            'image/png',
            'image/webp',
            'audio/mpeg',
            'application/pdf',
          ],
          maximumSizeInBytes: 10 * 1024 * 1024 * 1024, // 10 GB
          addRandomSuffix: true,
          // Don't let the Clerk JWT (clientPayload) become the tokenPayload —
          // it inflates the signed clientToken past header limits and Blob
          // backend then rejects the PUT with a generic "Access denied".
          tokenPayload: '',
        };
      },
      onUploadCompleted: async () => {
        // Hook for future side effects. The session row is created by the client
        // immediately after upload completes via /api/db/ugc-sessions.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('blob upload token error', err);
    return res.status(400).json({ error: err.message || 'Upload token failed' });
  }
}
