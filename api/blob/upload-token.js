// Issues short-lived client upload tokens for Vercel Blob direct-from-browser uploads.
// Used by the UGC Editor to upload multi-GB source videos without proxying through
// a Vercel function. Auth-gated via Clerk.
import { handleUpload } from '@vercel/blob/client';
import { requireAuth } from '../_lib/auth.js';

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
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
      }),
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
