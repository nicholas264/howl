export async function ensureApprovalSnapshots(sql) {
  await sql`CREATE TABLE IF NOT EXISTS deliverable_approvals (
    id BIGSERIAL PRIMARY KEY, deliverable_id BIGINT NOT NULL REFERENCES creator_deliverables(id),
    creator_id BIGINT NOT NULL, actor_id TEXT NOT NULL, snapshot JSONB NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS approval_id BIGINT REFERENCES deliverable_approvals(id)`;
}

export async function approveDeliverable(sql, id, creatorId, expectedUpdatedAt, actorId, evidence) {
  if (!evidence?.sha256 && !evidence?.drive_md5) throw new Error('Verified output content is required for approval');
  const [saved] = await sql`
    WITH current AS MATERIALIZED (
      SELECT d.* FROM creator_deliverables d
      WHERE d.id = ${id} AND d.creator_id = ${creatorId} AND d.updated_at = ${expectedUpdatedAt}::timestamptz
        AND (d.output_url IS NOT NULL OR d.source_url IS NOT NULL OR d.drive_file_id IS NOT NULL)
      FOR UPDATE
    ), approval AS (
      INSERT INTO deliverable_approvals (deliverable_id,creator_id,actor_id,snapshot)
      SELECT id,creator_id,${actorId},jsonb_build_object(
        'output_url',output_url,'source_url',source_url,'drive_file_id',CASE WHEN output_url IS NULL THEN drive_file_id ELSE NULL END,
        'ugc_session_id',ugc_session_id,'creative_asset_id',creative_asset_id,
        'engagement_id',engagement_id,'brief_id',brief_id,'deliverable_updated_at',updated_at,'evidence',${JSON.stringify(evidence)}::jsonb
      ) FROM current RETURNING id,deliverable_id,approved_at
    )
    UPDATE creator_deliverables d SET status = 'approved', approval_id = approval.id,
      approved_at = approval.approved_at, approved_asset_count = GREATEST(d.approved_asset_count,d.expected_asset_count), updated_at = now()
    FROM approval WHERE d.id = approval.deliverable_id RETURNING d.*
  `;
  return saved || null;
}
