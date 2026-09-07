import { recordBlobUpload } from '../_lib/media-objects.js';
import { uploadPolicy } from '../_lib/upload-policy.js';
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

  // Callback URLs only select a configured credential; the SDK must still verify
  // that credential's signature before any callback data is trusted.
  const callbackUrl=req.body?.type==='blob.upload-completed' ? req.body?.payload?.blob?.url : null;
  const privateUpload=callbackUrl
    ? (()=>{try{return new URL(callbackUrl).hostname.endsWith('.private.blob.vercel-storage.com');}catch{return false;}})()
    : String(req.body?.payload?.pathname || '').startsWith('creator-contracts/');
  const blobAccess=privateUpload?'private':'public';
  const blobToken=privateUpload?process.env.HOWL_PRIVATE_READ_WRITE_TOKEN:process.env.BLOB_READ_WRITE_TOKEN;
  if(!blobToken)return res.status(503).json({error:'Upload storage is not configured for this destination'});

  try {
    const sql = neon(process.env.DATABASE_URL);
    if(req.body?.type==='blob.generate-client-token') {
    const rate = await checkRateLimit(sql, {
      route: 'blob-upload-token:post',
      key: rateLimitKey(req),
      limit: 60,
      windowSeconds: 10 * 60,
    });
    if (!rate.allowed) return sendRateLimited(res, rate);
    }

    let uploadLimits;
    const jsonResponse = await handleUpload({
      token: blobToken,
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const policy=uploadPolicy(pathname);
        let ownerId='local-dev';
        uploadLimits={maximumSizeInBytes:policy.maximumSizeInBytes,allowedContentTypes:policy.allowedContentTypes};
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
            ownerId=userId;
            if (!access.user || access.user.status !== 'active') throw new Error('Active workspace membership required');
            if (!hasPermission(access, policy.permission)) {
              throw new Error(`${policy.permission} required for this upload`);
            }
          } catch (err) {
            throw new Error(`Unauthorized — ${err.message}`);
          }
        }
        return {
          allowedContentTypes: policy.allowedContentTypes,
          maximumSizeInBytes: policy.maximumSizeInBytes,
          addRandomSuffix: true,
          // Don't let the Clerk JWT (clientPayload) become the tokenPayload —
          // it inflates the signed clientToken past header limits and Blob
          // backend then rejects the PUT with a generic "Access denied".
          tokenPayload: JSON.stringify({v:1,ownerId,scope:policy.permission.split('.')[0]}),
        };
      },
      onUploadCompleted: async payload=>{
        try {await recordBlobUpload(sql,payload,blobToken,blobAccess);}
        catch(error){error.statusCode=503;throw error;}
      },
    });
    return res.status(200).json({...jsonResponse,...(uploadLimits?{uploadLimits,access:blobAccess}:{})});
  } catch (err) {
    console.error('blob upload token error', err);
    return res.status(err.statusCode || 400).json({ error: err.message || 'Upload token failed' });
  }
}
