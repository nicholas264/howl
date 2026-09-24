import { getSeedingAttribution } from './seeding-attribution.js';
export async function ensureSeedingBudgets(sql) {
  await sql`CREATE TABLE IF NOT EXISTS creator_monthly_budgets (
    month TEXT PRIMARY KEY CHECK (month ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
    seeding NUMERIC(14,2) NOT NULL CHECK (seeding >= 0),
    creator NUMERIC(14,2) NOT NULL CHECK (creator >= 0),
    updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

export async function getSeedingReport(sql) {
  const [clock] = await sql`SELECT to_char(now() AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS as_of`;
  const monthly = await sql`
    SELECT COALESCE(to_char(seeded_on, 'YYYY-MM'), 'undated') AS month,
      COALESCE(sum(unit_cogs * quantity + shipping_cost) FILTER (WHERE seeded_on <= ${clock.as_of}::date OR seeded_on IS NULL), 0)::float AS seeding,
      COALESCE(sum(creator_fee) FILTER (WHERE seeded_on <= ${clock.as_of}::date OR seeded_on IS NULL), 0)::float AS creator,
      COALESCE(sum(unit_cogs * quantity + shipping_cost + creator_fee) FILTER (WHERE seeded_on > ${clock.as_of}::date), 0)::float AS scheduled
    FROM creator_seeding_log GROUP BY 1 ORDER BY 1`;
  const budgets = await sql`SELECT month, seeding::float, creator::float FROM creator_monthly_budgets ORDER BY month`;
  const commitments = await sql`
    WITH agreements AS (
      SELECT e.*, COALESCE(e.starts_on, e.approval_date,
        (e.created_at AT TIME ZONE 'America/Chicago')::date) AS fee_start
      FROM creator_engagements e
      WHERE e.status IN ('approved', 'active', 'completed')
        AND e.fee_currency = 'USD' AND e.fee_amount > 0
    ), periods AS (
      SELECT e.*, m.month::date AS fee_month
      FROM agreements e CROSS JOIN LATERAL generate_series(
        date_trunc('month', e.fee_start)::timestamp,
        date_trunc('month', CASE WHEN e.engagement_type = 'retainer'
          THEN COALESCE(e.ends_on, CASE WHEN e.status = 'completed'
            THEN (e.updated_at AT TIME ZONE 'America/Chicago')::date END,
            GREATEST(${clock.as_of}::date, e.fee_start,
              (SELECT max((month || '-01')::date) FROM creator_monthly_budgets)))
          ELSE e.fee_start END)::timestamp,
        interval '1 month'
      ) m(month)
      WHERE e.ends_on IS NULL OR e.ends_on >= e.fee_start
    ), linked_ledger AS (
      SELECT l.*, COALESCE(l.engagement_id::text, legacy.engagement_id) AS linked_engagement
      FROM creator_seeding_log l
      LEFT JOIN LATERAL (
        SELECT f.concept_json->>'engagement_id' AS engagement_id FROM flow_cards f
        WHERE f.creator_id = l.creator_id AND f.concept_json->>'engagement_id' IS NOT NULL
          AND (f.concept_json->>'seeding_id' = l.id::text
            OR f.concept_json->'seeding_ids' @> to_jsonb(l.id))
        ORDER BY f.id LIMIT 1
      ) legacy ON l.engagement_id IS NULL
    )
    SELECT e.id AS engagement_id, e.creator_id, c.name AS creator_name, e.engagement_type,
      to_char(e.fee_month, 'YYYY-MM') AS month, e.fee_amount::float AS amount,
      GREATEST(0, e.fee_amount - COALESCE((
        SELECT sum(l.creator_fee) FROM linked_ledger l
        WHERE l.linked_engagement = e.id::text AND l.creator_id = e.creator_id
          AND l.seeded_on <= ${clock.as_of}::date
          AND (e.engagement_type <> 'retainer'
            OR date_trunc('month', COALESCE(l.seeded_on, e.fee_start))::date = e.fee_month)
      ), 0))::float AS additional
    FROM periods e JOIN creators c ON c.id = e.creator_id
    ORDER BY e.fee_month, c.name, e.id`;
  let performance = [], attribution = [], performance_error = null;
  try {
    attribution = await getSeedingAttribution(sql, clock.as_of);
    performance = attribution.filter(row => row.attribution === 'creator');
  } catch (err) {
    console.error('Seeding performance unavailable', err);
    performance_error = 'Ad performance could not be loaded. Refresh to try again.';
  }
  return { as_of: clock.as_of, monthly, budgets, commitments, performance, attribution, performance_error };
}
