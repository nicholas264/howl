import { createHash } from 'node:crypto';

export function submissionTokenHash(token) {
  return createHash('sha256').update((token || '').toString()).digest('hex');
}

export async function getActiveSubmission(sql, token) {
  if (!token || token.length < 32 || token.length > 200) return null;
  const [submission] = await sql`
    SELECT
      l.id, l.creator_id, l.brief_id, l.title, l.due_at, l.status,
      l.upload_count, l.token_issue_count, l.expires_at, c.name AS creator_name,
      b.title AS brief_title, b.product, b.objective, b.angle,
      b.brief, b.script, b.deliverables
    FROM creator_submission_links l
    JOIN creators c ON c.id = l.creator_id
    LEFT JOIN creator_briefs b ON b.id = l.brief_id
    WHERE l.token_hash = ${submissionTokenHash(token)}
    LIMIT 1
  `;
  return submission || null;
}
