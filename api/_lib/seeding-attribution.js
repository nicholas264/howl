// Account coverage is separate from creator ROI: a known non-creator ad is not
// an attribution gap. Aggregate by ad/month before classifying to avoid fan-out.
export async function getSeedingAttribution(sql, asOf) {
  return sql`
    WITH monthly_ads AS (
      SELECT ad_id, to_char(date, 'YYYY-MM') AS month,
        sum(spend) AS spend, sum(purchase_value) AS revenue,
        count(*) AS observations, max(date) AS through, max(synced_at) AS synced_at
      FROM creative_insights_daily WHERE date <= ${asOf}::date
      GROUP BY ad_id, to_char(date, 'YYYY-MM')
    ), classified AS (
      SELECT i.*, CASE WHEN
        EXISTS (SELECT 1 FROM launch_history l WHERE l.ad_id = i.ad_id AND
          (l.creator_id IS NOT NULL OR EXISTS (SELECT 1 FROM creators c WHERE lower(c.name) = lower(l.creator))))
        OR EXISTS (SELECT 1 FROM creative_performance cp WHERE cp.ad_id = i.ad_id AND (
          EXISTS (SELECT 1 FROM creative_creator_assignments a WHERE a.group_key = cp.group_key AND a.creator_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM creative_assets a WHERE a.group_key = cp.group_key AND a.creator_id IS NOT NULL)
        )) THEN 'creator'
        WHEN EXISTS (SELECT 1 FROM launch_history l WHERE l.ad_id = i.ad_id AND l.source_type IN ('tool_generated','founder','internal_employee'))
        OR EXISTS (SELECT 1 FROM creative_performance cp WHERE cp.ad_id = i.ad_id AND (
          EXISTS (SELECT 1 FROM creative_creator_assignments a WHERE a.group_key = cp.group_key AND a.source_type IN ('tool_generated','founder','internal_employee'))
          OR EXISTS (SELECT 1 FROM creative_assets a WHERE a.group_key = cp.group_key AND a.source_type IN ('tool_generated','founder','internal_employee'))
        )) THEN 'non_creator' ELSE 'unreviewed' END AS attribution
      FROM monthly_ads i
    )
    SELECT month, attribution, sum(spend)::float AS spend, sum(revenue)::float AS revenue,
      count(*) FILTER (WHERE spend > 0)::int AS spending_ads,
      sum(observations)::int AS observations, max(through)::text AS through,
      max(synced_at)::text AS synced_at
    FROM classified GROUP BY month, attribution ORDER BY month, attribution
  `;
}
