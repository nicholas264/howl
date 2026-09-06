export async function ensureLocalReceipts(sql) {
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS operation_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_history_operation ON launch_history(operation_key)`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS launch_receipt_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_assets_launch_receipt ON creative_assets(launch_receipt_key)`;
  await sql`ALTER TABLE creator_activity ADD COLUMN IF NOT EXISTS event_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_activity_event ON creator_activity(event_key)`;
}
