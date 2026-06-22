import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { getActiveSubmission, submissionTokenHash } from './_lib/creator-submissions.js';

function publicSubmission(submission) {
  const expired = new Date(submission.expires_at).getTime() <= Date.now();
  return {
    id: Number(submission.id),
    creator_name: submission.creator_name,
    title: submission.title,
    due_at: submission.due_at,
    expires_at: submission.expires_at,
    status: expired && submission.status === 'active' ? 'expired' : submission.status,
    brief: submission.brief_id ? {
      title: submission.brief_title,
      product: submission.product,
      objective: submission.objective,
      angle: submission.angle,
      brief: submission.brief,
      script: submission.script,
      deliverables: submission.deliverables,
    } : null,
  };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const token = (req.method === 'GET' ? req.query?.token : req.body?.token || '').toString();
  const sql = neon(process.env.DATABASE_URL);
  let uploadedUrl = null;

  try {
    await ensureCreatorOpsTables(sql);
    const submission = await getActiveSubmission(sql, token);
    if (!submission) return res.status(404).json({ error: 'Upload link not found' });
    if (req.method === 'GET') return res.json({ submission: publicSubmission(submission) });

    if (submission.status !== 'active'
      || submission.upload_count > 0
      || new Date(submission.expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'This upload link is expired or already used' });
    }

    const videoUrl = (req.body?.video_url || '').toString();
    const fileName = (req.body?.file_name || '').toString().trim().slice(0, 500);
    const fileSize = Number(req.body?.file_size) || null;
    let parsedUrl;
    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      return res.status(400).json({ error: 'Uploaded video URL is invalid' });
    }
    if (parsedUrl.protocol !== 'https:'
      || !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')
      || !parsedUrl.pathname.replace(/^\/+/, '').startsWith(`creator-submissions/${submission.id}/`)) {
      return res.status(400).json({ error: 'Uploaded video is outside this submission' });
    }
    uploadedUrl = parsedUrl.toString();

    const head = await fetch(parsedUrl, { method: 'HEAD' });
    const contentType = head.headers.get('content-type') || '';
    if (!head.ok || !contentType.startsWith('video/')) {
      await del(parsedUrl.toString()).catch(() => {});
      return res.status(400).json({ error: 'Submission must be a valid video file' });
    }

    const [ids] = await sql`
      SELECT
        nextval(pg_get_serial_sequence('ugc_sessions', 'id')) AS session_id
    `;
    const sessionId = Number(ids.session_id);
    const [requestedDeliverable] = await sql`
      SELECT d.id
      FROM creator_deliverables d
      WHERE d.creator_id = ${submission.creator_id}
        AND d.brief_id IS NOT DISTINCT FROM ${submission.brief_id || null}
        AND d.status IN ('requested', 'received', 'editing', 'edited', 'approved')
        AND d.ugc_session_id IS NULL
      ORDER BY d.created_at DESC
      LIMIT 1
    `;
    const deliverableId = requestedDeliverable
      ? Number(requestedDeliverable.id)
      : Number((await sql`SELECT nextval(pg_get_serial_sequence('creator_deliverables', 'id')) AS deliverable_id`)[0].deliverable_id);
    const tokenHash = submissionTokenHash(token);
    const [result] = await sql`
      WITH claimed AS (
        UPDATE creator_submission_links
        SET status = 'completed', upload_count = upload_count + 1,
            last_used_at = now(), updated_at = now()
        WHERE id = ${submission.id}
          AND token_hash = ${tokenHash}
          AND status = 'active'
          AND upload_count = 0
          AND expires_at > now()
        RETURNING creator_id, brief_id, title, due_at
      ),
      session_insert AS (
        INSERT INTO ugc_sessions (
          id, user_id, title, file_name, file_size, video_url, settings, status,
          creator_id, source_type, source_label, brief_id, deliverable_id
        )
        SELECT
          ${sessionId}, ${`creator-submit:${submission.id}`}, title,
          ${fileName || null}, ${fileSize}, ${parsedUrl.toString()}, '{}'::jsonb, 'uploaded',
          creator_id, 'external_creator', null, brief_id, ${deliverableId}
        FROM claimed
        RETURNING creator_id, brief_id, title
      ),
      deliverable_upsert AS (
        INSERT INTO creator_deliverables (
          id, creator_id, brief_id, title, status, expected_asset_count,
          received_asset_count, source_url, ugc_session_id, due_at, received_at, created_by
        )
        SELECT
          ${deliverableId}, claimed.creator_id, claimed.brief_id, claimed.title,
          'received', 1, 1, ${parsedUrl.toString()}, ${sessionId}, claimed.due_at, now(),
          ${`creator-submit:${submission.id}`}
        FROM claimed
        ON CONFLICT (id) DO UPDATE SET
          status = CASE
            WHEN creator_deliverables.status = 'requested' THEN 'received'
            ELSE creator_deliverables.status
          END,
          received_asset_count = GREATEST(creator_deliverables.received_asset_count, 1),
          source_url = EXCLUDED.source_url,
          ugc_session_id = EXCLUDED.ugc_session_id,
          received_at = COALESCE(creator_deliverables.received_at, now()),
          updated_at = now()
        RETURNING id
      ),
      activity_insert AS (
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        SELECT
          creator_id, 'footage_received', ${`Creator footage received: ${submission.title}`},
          ${JSON.stringify({
            submission_link_id: Number(submission.id),
            deliverable_id: deliverableId,
            ugc_session_id: sessionId,
            brief_id: submission.brief_id ? Number(submission.brief_id) : null,
          })}::jsonb,
          ${`creator-submit:${submission.id}`}
        FROM claimed
      )
      SELECT id AS deliverable_id, ${sessionId}::bigint AS session_id
      FROM deliverable_upsert
    `;
    if (!result) {
      const [existingSession] = await sql`
        SELECT id FROM ugc_sessions
        WHERE video_url = ${parsedUrl.toString()}
        LIMIT 1
      `;
      if (!existingSession) await del(parsedUrl.toString()).catch(() => {});
      return res.status(409).json({ error: 'This upload link was already used' });
    }
    return res.status(201).json({
      ok: true,
      submission: { ...publicSubmission(submission), status: 'completed' },
    });
  } catch (err) {
    if (uploadedUrl) await del(uploadedUrl).catch(() => {});
    return res.status(500).json({ error: err.message || 'Could not receive creator footage' });
  }
}
