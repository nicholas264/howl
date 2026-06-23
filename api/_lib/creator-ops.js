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
      niche               TEXT,
      strengths           TEXT,
      audience_demographics TEXT,
      audience_psychographics TEXT,
      activities          TEXT[] NOT NULL DEFAULT '{}',
      tags                TEXT[] NOT NULL DEFAULT '{}',
      rate_notes          TEXT,
      notes               TEXT,
      source_metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
      avatar_url          TEXT,
      owner_user_id       TEXT,
      shipping_address1   TEXT,
      shipping_address2   TEXT,
      shipping_city       TEXT,
      shipping_region     TEXT,
      shipping_postal_code TEXT,
      shipping_country_code TEXT NOT NULL DEFAULT 'US',
      product_seeding_required BOOLEAN NOT NULL DEFAULT true,
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_stage ON creators(stage)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creators_name ON creators(lower(name))`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS niche TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS strengths TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS audience_demographics TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS audience_psychographics TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_address1 TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_address2 TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_city TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_region TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS shipping_country_code TEXT NOT NULL DEFAULT 'US'`;
  await sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS product_seeding_required BOOLEAN NOT NULL DEFAULT true`;
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
    CREATE TABLE IF NOT EXISTS creator_applications (
      id                  BIGSERIAL PRIMARY KEY,
      application_code    TEXT NOT NULL UNIQUE,
      status              TEXT NOT NULL DEFAULT 'new',
      name                TEXT NOT NULL,
      email               TEXT NOT NULL,
      phone               TEXT,
      location            TEXT,
      timezone            TEXT,
      niche               TEXT,
      strengths           TEXT,
      activities          TEXT[] NOT NULL DEFAULT '{}',
      audience_description TEXT,
      audience_psychographics TEXT,
      creator_experience  TEXT,
      why_howl            TEXT,
      rate_expectations   TEXT,
      availability        TEXT,
      referral_source     TEXT,
      socials             JSONB NOT NULL DEFAULT '[]'::jsonb,
      enrichment          JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_scorecard     JSONB NOT NULL DEFAULT '{}'::jsonb,
      sample_urls         TEXT[] NOT NULL DEFAULT '{}',
      age_confirmed       BOOLEAN NOT NULL DEFAULT false,
      consent_confirmed   BOOLEAN NOT NULL DEFAULT false,
      review_notes        TEXT,
      reviewed_by         TEXT,
      reviewed_at         TIMESTAMPTZ,
      promoted_creator_id BIGINT REFERENCES creators(id) ON DELETE SET NULL,
      ip_hash             TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_applications_status ON creator_applications(status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_applications_email ON creator_applications(lower(email))`;
  await sql`ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS enrichment JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS review_scorecard JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS audience_psychographics TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_candidates (
      id                  BIGSERIAL PRIMARY KEY,
      status              TEXT NOT NULL DEFAULT 'new',
      source              TEXT NOT NULL DEFAULT 'manual',
      name                TEXT,
      email               TEXT,
      location            TEXT,
      niche               TEXT,
      strengths           TEXT,
      audience_description TEXT,
      audience_psychographics TEXT,
      rate_expectations   TEXT,
      activities          TEXT[] NOT NULL DEFAULT '{}',
      fit_notes           TEXT,
      avatar_url          TEXT,
      socials             JSONB NOT NULL DEFAULT '[]'::jsonb,
      enrichment          JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_scorecard     JSONB NOT NULL DEFAULT '{}'::jsonb,
      review_notes        TEXT,
      reviewed_by         TEXT,
      reviewed_at         TIMESTAMPTZ,
      promoted_creator_id BIGINT REFERENCES creators(id) ON DELETE SET NULL,
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_candidates_status ON creator_candidates(status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_candidates_source ON creator_candidates(source, created_at DESC)`;
  await sql`ALTER TABLE creator_candidates ADD COLUMN IF NOT EXISTS audience_description TEXT`;
  await sql`ALTER TABLE creator_candidates ADD COLUMN IF NOT EXISTS audience_psychographics TEXT`;
  await sql`ALTER TABLE creator_candidates ADD COLUMN IF NOT EXISTS rate_expectations TEXT`;
  await sql`ALTER TABLE creator_candidates ADD COLUMN IF NOT EXISTS activities TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE creator_candidates ADD COLUMN IF NOT EXISTS review_scorecard JSONB NOT NULL DEFAULT '{}'::jsonb`;

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
      external_thread_id TEXT,
      recipient     TEXT,
      sent_at       TIMESTAMPTZ,
      replied_at    TIMESTAMPTZ,
      next_follow_up_at TIMESTAMPTZ,
      outcome       TEXT,
      last_synced_at TIMESTAMPTZ,
      created_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_outreach_creator ON creator_outreach(creator_id, created_at DESC)`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS external_thread_id TEXT`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS recipient TEXT`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS outcome TEXT`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_outreach_follow_up ON creator_outreach(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL`;

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
      commitment_period     TEXT NOT NULL DEFAULT 'total',
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
  await sql`ALTER TABLE creator_engagements ADD COLUMN IF NOT EXISTS commitment_period TEXT NOT NULL DEFAULT 'total'`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_agreement_templates (
      id            BIGSERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      title         TEXT NOT NULL,
      agreement_body TEXT NOT NULL,
      version       INTEGER NOT NULL DEFAULT 1,
      status        TEXT NOT NULL DEFAULT 'active',
      created_by    TEXT,
      updated_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_agreement_templates_status ON creator_agreement_templates(status, lower(name))`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_agreements (
      id                    BIGSERIAL PRIMARY KEY,
      creator_id            BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      engagement_id         BIGINT REFERENCES creator_engagements(id) ON DELETE SET NULL,
      template_id           BIGINT REFERENCES creator_agreement_templates(id) ON DELETE SET NULL,
      template_version      INTEGER,
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
  await sql`ALTER TABLE creator_agreements ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES creator_agreement_templates(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE creator_agreements ADD COLUMN IF NOT EXISTS template_version INTEGER`;

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
    CREATE TABLE IF NOT EXISTS creator_campaign_plans (
      id                  BIGSERIAL PRIMARY KEY,
      product_id          TEXT,
      product_title       TEXT NOT NULL,
      objective           TEXT,
      asset_count         INTEGER NOT NULL,
      proven_percent      INTEGER NOT NULL,
      total_budget        NUMERIC(14,2),
      evidence_window_days INTEGER NOT NULL DEFAULT 90,
      status              TEXT NOT NULL DEFAULT 'draft',
      strategy_summary    TEXT,
      evidence            JSONB NOT NULL DEFAULT '[]'::jsonb,
      assignments         JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE creator_campaign_plans ADD COLUMN IF NOT EXISTS total_budget NUMERIC(14,2)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_campaign_plans_created ON creator_campaign_plans(created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS brand_guidelines (
      id                    BIGSERIAL PRIMARY KEY,
      brand_name            TEXT NOT NULL DEFAULT 'HOWL Campfires',
      voice_guidance        TEXT,
      approved_claims       TEXT[] NOT NULL DEFAULT '{}',
      prohibited_phrases    TEXT[] NOT NULL DEFAULT '{}',
      prohibited_claims     TEXT[] NOT NULL DEFAULT '{}',
      required_disclosures  TEXT[] NOT NULL DEFAULT '{}',
      updated_by            TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_product_seeds (
      id                    BIGSERIAL PRIMARY KEY,
      creator_id            BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      shop_domain           TEXT NOT NULL,
      shopify_product_id    TEXT,
      shopify_variant_id    TEXT NOT NULL,
      product_title         TEXT NOT NULL,
      variant_title         TEXT,
      sku                   TEXT,
      quantity              INTEGER NOT NULL DEFAULT 1,
      status                TEXT NOT NULL DEFAULT 'planned',
      shopify_draft_order_id TEXT,
      shopify_order_id      TEXT,
      shopify_order_name    TEXT,
      request_key           TEXT,
      tracking_url          TEXT,
      notes                 TEXT,
      requested_by          TEXT,
      requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      ordered_at            TIMESTAMPTZ,
      delivered_at          TIMESTAMPTZ,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE creator_product_seeds ADD COLUMN IF NOT EXISTS request_key TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_product_seeds_creator ON creator_product_seeds(creator_id, requested_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_product_seeds_status ON creator_product_seeds(status, requested_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_product_seeds_request_key ON creator_product_seeds(request_key) WHERE request_key IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS creator_deliverables (
      id              BIGSERIAL PRIMARY KEY,
      creator_id      BIGINT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      brief_id        BIGINT REFERENCES creator_briefs(id) ON DELETE SET NULL,
      engagement_id   BIGINT REFERENCES creator_engagements(id) ON DELETE SET NULL,
      title           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'requested',
      expected_asset_count INTEGER NOT NULL DEFAULT 1,
      received_asset_count INTEGER NOT NULL DEFAULT 0,
      approved_asset_count INTEGER NOT NULL DEFAULT 0,
      completed_asset_count INTEGER NOT NULL DEFAULT 0,
      shipped_asset_count INTEGER NOT NULL DEFAULT 0,
      source_url      TEXT,
      drive_file_id   TEXT,
      ugc_session_id  BIGINT,
      creative_asset_id BIGINT,
      due_at          TIMESTAMPTZ,
      received_at     TIMESTAMPTZ,
      approved_at     TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      shipped_at      TIMESTAMPTZ,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_deliverables_creator ON creator_deliverables(creator_id, created_at DESC)`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS engagement_id BIGINT REFERENCES creator_engagements(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS expected_asset_count INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS received_asset_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS approved_asset_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS completed_asset_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS shipped_asset_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE creator_deliverables ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_deliverables_engagement ON creator_deliverables(engagement_id, due_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creator_deliverables_due ON creator_deliverables(due_at, status)`;

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
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_label TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_creator_id ON launch_history(creator_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_brief_id ON launch_history(brief_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_launch_history_deliverable_id ON launch_history(deliverable_id)`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS source_label TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_creator_id ON creative_assets(creator_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_brief_id ON creative_assets(brief_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_deliverable_id ON creative_assets(deliverable_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS creative_creator_assignments (
      group_key    TEXT PRIMARY KEY,
      creator_id   BIGINT REFERENCES creators(id) ON DELETE CASCADE,
      source_type  TEXT,
      source_label TEXT,
      assigned_by  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE creative_creator_assignments ALTER COLUMN creator_id DROP NOT NULL`;
  await sql`ALTER TABLE creative_creator_assignments ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`ALTER TABLE creative_creator_assignments ADD COLUMN IF NOT EXISTS source_label TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_creator_assignments_creator ON creative_creator_assignments(creator_id)`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS creator_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS brief_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS deliverable_id BIGINT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS source_label TEXT`;
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
