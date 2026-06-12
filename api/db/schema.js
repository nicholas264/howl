// One-shot endpoint to ensure schema exists. Idempotent — safe to call repeatedly.
import { neon } from '@neondatabase/serverless';
import { requireAdmin } from '../_lib/auth.js';
import { backfillCreativeAssetsFromLaunchHistory, ensureCreativeAssetTables } from '../_lib/creative-assets.js';
import { ensureCreativeAnalysisQueue } from '../_lib/creative-analysis-queue.js';
import { ensureAppTables } from '../_lib/app-access.js';
import { ensureCreatorOpsTables } from '../_lib/creator-ops.js';

export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;
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
    // Per-format callout positions for the inactive formats. Active format's
    // positions live on the flat callout rows; this holds the other(s).
    await sql`ALTER TABLE callout_layouts ADD COLUMN IF NOT EXISTS pos_by_format JSONB`;

    // Reusable base images uploaded into the Callout Ads tool. Decoupled from
    // callout_layouts so the same image can back many layouts.
    await sql`
      CREATE TABLE IF NOT EXISTS callout_images (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT,
        product_id  TEXT,
        url         TEXT NOT NULL,
        file_name   TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_callout_images_created_at ON callout_images(created_at DESC)`;

    // Shared image library — backs ImageAdTool's photo set and ReviewAdTool's
    // background picker. Was previously a per-browser localStorage blob keyed
    // by 'howl_saved_images', which silently dropped uploads past the LS quota.
    await sql`
      CREATE TABLE IF NOT EXISTS image_library (
        id         BIGSERIAL PRIMARY KEY,
        user_id    TEXT,
        url        TEXT NOT NULL,
        file_name  TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_image_library_user ON image_library(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_image_library_created_at ON image_library(created_at DESC)`;

    // Per-product, per-feature spec used by /api/callout-vision to ground
    // anchor placement. Visual description + typical location go straight into
    // the Claude prompt; body_copy is the benefit statement displayed on the ad.
    await sql`
      CREATE TABLE IF NOT EXISTS callout_feature_specs (
        id                  BIGSERIAL PRIMARY KEY,
        product_id          TEXT NOT NULL,
        feature_name        TEXT NOT NULL,
        visual_description  TEXT,
        typical_location    TEXT,
        body_copy           TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (product_id, feature_name)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_callout_feature_specs_product ON callout_feature_specs(product_id)`;

    // Per-image, per-feature anchor cache. Vision results land here on first
    // run; manual user drags overwrite the row with source='manual'. Subsequent
    // renders read from this table before considering a vision call.
    await sql`
      CREATE TABLE IF NOT EXISTS callout_image_placements (
        id            BIGSERIAL PRIMARY KEY,
        image_id      BIGINT NOT NULL REFERENCES callout_images(id) ON DELETE CASCADE,
        feature_name  TEXT NOT NULL,
        anchor_x      DOUBLE PRECISION NOT NULL,
        anchor_y      DOUBLE PRECISION NOT NULL,
        side          TEXT NOT NULL,
        text_x        DOUBLE PRECISION,
        text_y        DOUBLE PRECISION,
        source        TEXT NOT NULL DEFAULT 'vision',
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (image_id, feature_name)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_callout_placements_image ON callout_image_placements(image_id)`;

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
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_video_url TEXT`;
    await ensureCreativeAssetTables(sql);
    await backfillCreativeAssetsFromLaunchHistory(sql);
    await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS source_asset_id BIGINT`;
    await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS vision_frame_count INTEGER`;
    await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS transcription_status TEXT`;
    await ensureCreativeAnalysisQueue(sql);

    // Attribution columns on launch_history (idempotent).
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS launched_by_user_id TEXT`;
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS launched_by_email TEXT`;
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_launched_by ON launch_history(launched_by_user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_creator_id ON launch_history(creator_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_brief_id ON launch_history(brief_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_deliverable_id ON launch_history(deliverable_id)`;

    // Internal bug/feature/edge-case reports submitted from the in-app widget.
    await sql`
      CREATE TABLE IF NOT EXISTS feedback (
        id          BIGSERIAL PRIMARY KEY,
        user_id     TEXT,
        email       TEXT,
        kind        TEXT NOT NULL,
        message     TEXT NOT NULL,
        page_url    TEXT,
        user_agent  TEXT,
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)`;
    await ensureAppTables(sql);
    await ensureCreatorOpsTables(sql);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
