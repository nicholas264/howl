let creatorOpsTablesReady = null;

async function createCreatorOpsTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS creators (
      id                  BIGSERIAL PRIMARY KEY,
      name                TEXT NOT NULL,
      email               TEXT,
      phone               TEXT,
      status              TEXT NOT NULL DEFAULT 'prospect',
      stage               TEXT NOT NULL DEFAULT 'sourced',
      source              TEXT NOT NULL DEFAULT 'manual',
      source_external_id  TEXT,
      location            TEXT,
      timezone            TEXT,
      bio                 TEXT,
      activities          TEXT[] NOT NULL DEFAULT '{}',
      tags                TEXT[] NOT NULL DEFAULT '{}',
      rate_notes          TEXT,
      notes               TEXT,
      source_metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
      avatar_url          TEXT,
      owner_user_id       TEXT,
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_stage ON creators(stage)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_name ON creators(lower(name))`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_source_external
    ON creators(source, source_external_id)
    WHERE source_external_id IS NOT NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_social_accounts (
      id               BIGSERIAL PRIMARY KEY,
      creator_id       BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      platform         TEXT NOT NULL,
      handle           TEXT,
      profile_url      TEXT,
      followers        BIGINT,
      following        BIGINT,
      avg_views        BIGINT,
      engagement_rate  NUMERIC(8,4),
      metrics          JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at   TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (creator_id, platform)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_social_creator ON creator_social_accounts(creator_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_activity (
      id          BIGSERIAL PRIMARY KEY,
      creator_id  BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      summary     TEXT NOT NULL,
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      user_id     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_activity_creator ON creator_activity(creator_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_outreach (
      id            BIGSERIAL PRIMARY KEY,
      creator_id    BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      channel       TEXT NOT NULL DEFAULT 'email',
      direction     TEXT NOT NULL DEFAULT 'outbound',
      subject       TEXT,
      body          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      external_id   TEXT,
      sent_at       TIMESTAMPTZ,
      created_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_outreach_creator ON creator_outreach(creator_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_engagements (
      id                    BIGSERIAL PRIMARY KEY,
      creator_id            BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      engagement_type       TEXT NOT NULL DEFAULT 'one_off',
      status                TEXT NOT NULL DEFAULT 'draft',
      approval_date         DATE,
      starts_on             DATE,
      ends_on               DATE,
      asset_commitment      INTEGER,
      cadence               TEXT,
      fee_amount            NUMERIC(12,2),
      fee_currency          TEXT NOT NULL DEFAULT 'USD',
      ugc_video_rate        NUMERIC(12,2),
      raw_footage_rate      NUMERIC(12,2),
      hook_rate             NUMERIC(12,2),
      photo_rate            NUMERIC(12,2),
      whitelisting_monthly_rate NUMERIC(12,2),
      usage_term_months     INTEGER,
      paid_media_included   BOOLEAN NOT NULL DEFAULT true,
      raw_footage_included  BOOLEAN NOT NULL DEFAULT false,
      exclusivity_notes     TEXT,
      payment_terms         TEXT,
      notes                 TEXT,
      created_by            TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_engagements_creator ON creator_engagements(creator_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_engagements_dates ON creator_engagements(starts_on, ends_on)`;
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS ugc_video_rate NUMERIC(12,2)`;
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS raw_footage_rate NUMERIC(12,2)`;
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS hook_rate NUMERIC(12,2)`;
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS photo_rate NUMERIC(12,2)`;
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS whitelisting_monthly_rate NUMERIC(12,2)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_agreements (
      id                    BIGSERIAL PRIMARY KEY,
      creator_id            BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      engagement_id         BIGINT REFERENCES creator_engagements(id) ON DELETE SET NULL,
      title                 TEXT NOT NULL,
      agreement_body        TEXT NOT NULL,
      version               INTEGER NOT NULL DEFAULT 1,
      status                TEXT NOT NULL DEFAULT 'draft',
      token_hash            TEXT UNIQUE,
      expires_at            TIMESTAMPTZ,
      sent_to               TEXT,
      sent_at               TIMESTAMPTZ,
      viewed_at             TIMESTAMPTZ,
      accepted_name         TEXT,
      accepted_email        TEXT,
      accepted_at           TIMESTAMPTZ,
      accepted_ip           TEXT,
      accepted_user_agent   TEXT,
      revoked_at            TIMESTAMPTZ,
      created_by            TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_agreements_creator ON creator_agreements(creator_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_agreements_status ON creator_agreements(status, expires_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_briefs (
      id                BIGSERIAL PRIMARY KEY,
      creator_id        BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      title             TEXT NOT NULL,
      product           TEXT,
      objective         TEXT,
      angle             TEXT,
      deliverables      JSONB NOT NULL DEFAULT '[]'::jsonb,
      brief             TEXT,
      script            TEXT,
      status            TEXT NOT NULL DEFAULT 'draft',
      generation_source TEXT,
      created_by        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_briefs_creator ON creator_briefs(creator_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_deliverables (
      id              BIGSERIAL PRIMARY KEY,
      creator_id      BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      brief_id        BIGINT REFERENCES creator_briefs(id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'requested',
      source_url      TEXT,
      drive_file_id   TEXT,
      ugc_session_id  BIGINT,
      creative_asset_id BIGINT,
      due_at          TIMESTAMPTZ,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_deliverables_creator ON creator_deliverables(creator_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_submission_links (
      id            BIGSERIAL PRIMARY KEY,
      token_hash    TEXT NOT NULL UNIQUE,
      creator_id    BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      brief_id      BIGINT REFERENCES creator_briefs(id) ON DELETE SET NULL,
      title         TEXT NOT NULL,
      due_at        TIMESTAMPTZ,
      status        TEXT NOT NULL DEFAULT 'active',
      upload_count  INTEGER NOT NULL DEFAULT 0,
      token_issue_count INTEGER NOT NULL DEFAULT 0,
      expires_at    TIMESTAMPTZ NOT NULL,
      last_used_at  TIMESTAMPTZ,
      created_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_submission_links_creator ON creator_submission_links(creator_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_submission_links_status ON creator_submission_links(status, expires_at)`;
  await sql`ALTER TABLE creator_submission_links ADD COLUMN IF NOT EXISTS token_issue_count INTEGER NOT NULL DEFAULT 0`;

  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_creator_id ON launch_history(creator_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_brief_id ON launch_history(brief_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_deliverable_id ON launch_history(deliverable_id)`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_creator_id ON creative_assets(creator_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_brief_id ON creative_assets(brief_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_deliverable_id ON creative_assets(deliverable_id)`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS rendered_url TEXT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS last_error TEXT`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS output_url TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ugc_sessions_creator_id ON ugc_sessions(creator_id)`;
}

export async function ensureCreatorOpsTables(sql) {
  if (!creatorOpsTablesReady) creatorOpsTablesReady = createCreatorOpsTables(sql);
  try {
    await creatorOpsTablesReady;
  } catch (err) {
    creatorOpsTablesReady = null;
    throw err;
  }
}
