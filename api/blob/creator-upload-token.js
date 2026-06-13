import { handleUpload } from '@vercel/blob/client';
import { neon } from '@neondatabase/serverless';
import { ensureCreatorOpsTables } from '../_lib/creator-ops.js';
import { getActiveSubmission } from '../_lib/creator-submissions.js';

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Upload storage is not configured' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureCreatorOpsTables(sql);
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const submission = await getActiveSubmission(sql, clientPayload);
        if (!submission
          || submission.status !== 'active'
          || submission.upload_count > 0
          || submission.token_issue_count >= 5
          || new Date(submission.expires_at).getTime() <= Date.now()) {
          throw new Error('This upload link is invalid, expired, or already used');
        }
        const expectedPrefix = `creator-submissions/${submission.id}/`;
        if (!pathname.startsWith(expectedPrefix)) throw new Error('Invalid upload destination');
        const [claimed] = await sql`
          UPDATE creator_submission_links
          SET token_issue_count = token_issue_count + 1, updated_at = now()
          WHERE id = ${submission.id}
            AND status = 'active'
            AND upload_count = 0
            AND token_issue_count < 5
            AND expires_at > now()
          RETURNING id
        `;
        if (!claimed) throw new Error('This upload link has reached its upload attempt limit');
        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/webm',
            'video/x-matroska',
            'video/mpeg',
          ],
          maximumSizeInBytes: 10 * 1024 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: String(submission.id),
        };
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Upload token failed' });
  }
}
