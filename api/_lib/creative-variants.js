import { digest } from './operation-journal.js';

export function creativeVariant(ad) {
  const creative = ad.creative || {};
  // Preserve every carousel card/dynamic alternative, copy and destination.
  // Thumbnail URLs are ephemeral and do not define a creative revision.
  const { thumbnail_url, ...definition } = creative;
  return { key: `variant:${digest(creative.id ? definition : { ad_id: ad.id, ...definition })}`,
    creativeId: creative.id || null, definition };
}

export async function ensureCreativeVariants(sql) {
  await sql`CREATE TABLE IF NOT EXISTS creative_variants (
    variant_key TEXT PRIMARY KEY, creative_id TEXT, definition JSONB NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE creative_performance ADD COLUMN IF NOT EXISTS variant_key TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_performance_variant ON creative_performance(variant_key)`;
}

// Release migration only: keep trigger installation out of runtime request paths.
export async function ensureVariantObservations(sql) {
  await sql`CREATE TABLE IF NOT EXISTS creative_variant_observations (
    id BIGSERIAL PRIMARY KEY, ad_id TEXT NOT NULL, variant_key TEXT,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_variant_observations_ad_time
    ON creative_variant_observations(ad_id, observed_at)`;
  // Record changes in the same transaction as metadata writes, including writes
  // outside the scheduled sync. Observation time is not a historical effective date.
  await sql`CREATE OR REPLACE FUNCTION record_creative_variant_observation() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' OR OLD.variant_key IS DISTINCT FROM NEW.variant_key THEN
        INSERT INTO creative_variant_observations(ad_id,variant_key)
          VALUES(NEW.ad_id,NEW.variant_key);
      END IF;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`;
  await sql`CREATE OR REPLACE TRIGGER creative_variant_observation
    AFTER INSERT OR UPDATE OF variant_key ON creative_performance
    FOR EACH ROW EXECUTE FUNCTION record_creative_variant_observation()`;
  await sql`INSERT INTO creative_variant_observations(ad_id,variant_key)
    SELECT cp.ad_id,cp.variant_key FROM creative_performance cp
    WHERE NOT EXISTS(SELECT 1 FROM creative_variant_observations o WHERE o.ad_id=cp.ad_id)`;

}

export async function readCreativeVariants(sql, days = 30) {
  return sql`
    SELECT COALESCE(cp.variant_key, 'creative:' || cp.creative_id, 'ad:' || cp.ad_id) AS variant_key,
      MAX(cp.ad_name) AS name, MAX(cp.creative_id) AS creative_id,
      array_agg(DISTINCT cp.ad_id) AS ad_ids, array_agg(DISTINCT cp.group_key) AS media_keys,
      array_agg(DISTINCT cp.adset_id) AS adset_ids,
      COUNT(DISTINCT i.date)::int AS observed_days,
      COALESCE(SUM(i.spend),0)::float AS spend,
      COALESCE(SUM(i.impressions),0)::float AS impressions,
      COALESCE(SUM(i.purchases),0)::float AS purchases,
      COALESCE(SUM(i.purchase_value),0)::float AS purchase_value,
      MAX(v.first_seen_at) AS definition_observed_at,
      (array_agg(v.definition) FILTER (WHERE v.definition IS NOT NULL))[1] AS definition
    FROM creative_performance cp
    LEFT JOIN creative_variants v ON v.variant_key = cp.variant_key
    LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id AND i.date >= current_date-(${days}::int-1)
    GROUP BY COALESCE(cp.variant_key, 'creative:' || cp.creative_id, 'ad:' || cp.ad_id)
    ORDER BY spend DESC LIMIT 500
  `;
}
