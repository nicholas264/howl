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

    await sql`
      CREATE TABLE IF NOT EXISTS dashboard_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS ugc_sessions (
        id            BIGSERIAL PRIMARY KEY,
        user_id       TEXT,
        title         TEXT,
        file_name     TEXT,
        file_size     BIGINT,
        duration      DOUBLE PRECISION,
        video_url     TEXT NOT NULL,
        audio_url     TEXT,
        words         JSONB,
        settings      JSONB,
        thumbnail_url TEXT,
        status        TEXT NOT NULL DEFAULT 'uploaded',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ugc_sessions_updated_at ON ugc_sessions(updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ugc_sessions_user_id ON ugc_sessions(user_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS callout_layouts (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT,
        product_id  TEXT,
        format      TEXT,
        title       TEXT,
        subtitle    TEXT,
        title_pos   JSONB,
        callouts    JSONB,
        image_url   TEXT,
        thumb_url   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_callout_layouts_updated_at ON callout_layouts(updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_callout_layouts_user_id ON callout_layouts(user_id)`;

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
