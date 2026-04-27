// One-shot endpoint to ensure schema exists. Idempotent — safe to call repeatedly.
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS launch_history (
        id           BIGSERIAL PRIMARY KEY,
        ad_id        TEXT NOT NULL,
        adset_id     TEXT,
        campaign_id  TEXT,
        drive_file_id TEXT,
        drive_file_name TEXT,
        creator      TEXT,
        product_id   TEXT,
        angle_id     TEXT,
        ad_name      TEXT,
        headline     TEXT,
        primary_text TEXT,
        dest_url     TEXT,
        mime_type    TEXT,
        launched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_creator ON launch_history(creator)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_launched_at ON launch_history(launched_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_ad_id ON launch_history(ad_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS copy_library (
        id           BIGSERIAL PRIMARY KEY,
        label        TEXT,
        headline     TEXT,
        primary_text TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
