export async function ensureAnalysisSchema(sql) {
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS source_asset_id BIGINT`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS vision_frame_count INTEGER`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS transcription_status TEXT`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS structured_analysis JSONB`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS evidence JSONB`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4)`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS operator_summary TEXT`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS recommended_next_step TEXT`;
await sql`
    CREATE TABLE IF NOT EXISTS creative_analysis_dismissals (
      group_key TEXT PRIMARY KEY,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}
