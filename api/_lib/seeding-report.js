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
  let performance = [], performance_error = null;
  try {
    // EXISTS counts each ad/day once, even when multiple assets or creators link to it.
    performance = await sql`
      SELECT to_char(i.date, 'YYYY-MM') AS month,
        sum(i.spend)::float AS spend, sum(i.purchase_value)::float AS revenue,
        count(*)::int AS observations, max(i.date)::text AS through
      FROM creative_insights_daily i
      WHERE i.date <= ${clock.as_of}::date AND (
        EXISTS (SELECT 1 FROM launch_history l WHERE l.ad_id = i.ad_id AND
          (l.creator_id IS NOT NULL OR EXISTS (SELECT 1 FROM creators c WHERE lower(c.name) = lower(l.creator))))
        OR EXISTS (SELECT 1 FROM creative_performance cp WHERE cp.ad_id = i.ad_id AND (
          EXISTS (SELECT 1 FROM creative_creator_assignments a WHERE a.group_key = cp.group_key AND a.creator_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM creative_assets a WHERE a.group_key = cp.group_key AND a.creator_id IS NOT NULL)
        ))
      ) GROUP BY 1 ORDER BY 1`;
  } catch (err) {
    console.error('Seeding performance unavailable', err);
    performance_error = 'Ad performance could not be loaded. Refresh to try again.';
  }
  return { as_of: clock.as_of, monthly, budgets, performance, performance_error };
}
