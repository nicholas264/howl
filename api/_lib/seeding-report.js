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
  let performance = [], attribution = [], performance_error = null;
  try {
    attribution = await getSeedingAttribution(sql, clock.as_of);
    performance = attribution.filter(row => row.attribution === 'creator');
  } catch (err) {
    console.error('Seeding performance unavailable', err);
    performance_error = 'Ad performance could not be loaded. Refresh to try again.';
  }
  return { as_of: clock.as_of, monthly, budgets, performance, attribution, performance_error };
}
