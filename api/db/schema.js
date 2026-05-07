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

    // Creative analytics — one row per ad in the Meta account, refreshed by the
    // sync_creative_analytics endpoint. group_key (= video_id || image_hash)
    // is what the Top Creatives table groups by.
    await sql`
      CREATE TABLE IF NOT EXISTS creative_performance (
        ad_id          TEXT PRIMARY KEY,
        ad_name        TEXT,
        adset_id       TEXT,
        campaign_id    TEXT,
        creative_id    TEXT,
        video_id       TEXT,
        image_hash     TEXT,
        group_key      TEXT,
        thumbnail_url  TEXT,
        asset_url      TEXT,
        status         TEXT,
        created_time   TIMESTAMPTZ,
        synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_performance_group_key ON creative_performance(group_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_performance_created_time ON creative_performance(created_time DESC)`;

    // Daily ad insights. PK = (ad_id, date). Stores raw metrics; the aggregation
    // endpoint sums these across a date window and groups by group_key.
    await sql`
      CREATE TABLE IF NOT EXISTS creative_insights_daily (
        ad_id              TEXT NOT NULL,
        date               DATE NOT NULL,
        spend              NUMERIC(14,4) NOT NULL DEFAULT 0,
        impressions        BIGINT NOT NULL DEFAULT 0,
        clicks             BIGINT NOT NULL DEFAULT 0,
        unique_link_clicks BIGINT NOT NULL DEFAULT 0,
        purchases          BIGINT NOT NULL DEFAULT 0,
        purchase_value     NUMERIC(14,4) NOT NULL DEFAULT 0,
        video_3s_views     BIGINT NOT NULL DEFAULT 0,
        video_thruplays    BIGINT NOT NULL DEFAULT 0,
        video_avg_watch    NUMERIC(10,4) NOT NULL DEFAULT 0,
        synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (ad_id, date)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_insights_date ON creative_insights_daily(date DESC)`;

    // Per-creative AI analysis ("Creative DNA"). One row per group_key.
    // Populated by the analyze_creative_group action: Whisper for video transcript,
    // Claude vision for visual + structural analysis, blended with the perf snapshot
    // at analysis time. Read by the From Winners generation tab.
    await sql`
      CREATE TABLE IF NOT EXISTS creative_analysis (
        group_key             TEXT PRIMARY KEY,
        asset_kind            TEXT,
        transcript            TEXT,
        hook_text_verbatim    TEXT,
        hook_type             TEXT,
        format                TEXT,
        angle                 TEXT,
        talent_description    TEXT,
        visual_summary        TEXT,
        why_it_worked         TEXT,
        performance_snapshot  JSONB,
        model                 TEXT,
        generated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_creative_analysis_generated_at ON creative_analysis(generated_at DESC)`;

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
