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
