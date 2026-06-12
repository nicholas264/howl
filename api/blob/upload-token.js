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
import { getAppAccess, hasPermission } from '../_lib/app-access.js';

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
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Local-dev escape hatch — matches requireAuth's behavior.
        const isLocalBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED === 'true';
        if (!isLocalBypass) {
          if (!process.env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY not configured');
          if (!clientPayload) throw new Error('Unauthorized — clientPayload missing');
          try {
            const payload = await verifyToken(clientPayload, { secretKey: process.env.CLERK_SECRET_KEY });
            const access = await getAppAccess({
              userId: payload.sub,
              email: payload.email || null,
            });
            if (!hasPermission(access, 'assets.write')) throw new Error('assets.write required');
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
