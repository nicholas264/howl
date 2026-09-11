// Match creative browsing: anchor the window to the latest ingested account day,
// and aggregate every ad sharing this creative's group key.
export async function loadCreativePerformanceSnapshot(sql, groupKey, sinceDays = 30) {
  const days = Math.max(1, Math.min(365, Number.parseInt(sinceDays, 10) || 30));
  const [row] = await sql`
    WITH reporting AS (
      SELECT COALESCE(max(date), current_date) AS until FROM creative_insights_daily
    )
    SELECT reporting.until::text AS until,
      (reporting.until - ${days}::integer)::text AS since,
      COALESCE(sum(i.spend), 0)::float AS spend,
      COALESCE(sum(i.purchase_value), 0)::float AS purchase_value,
      COALESCE(sum(i.purchases), 0)::int AS purchases,
      COALESCE(sum(i.impressions), 0)::float AS impressions,
      COALESCE(sum(i.clicks), 0)::float AS clicks
    FROM reporting
    LEFT JOIN creative_performance cp ON cp.group_key = ${groupKey}
    LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
      AND i.date BETWEEN reporting.until - ${days}::integer AND reporting.until
    GROUP BY reporting.until
  `;
  const spend = Number(row.spend), purchases = Number(row.purchases), purchaseValue = Number(row.purchase_value);
  return { since: row.since, until: row.until, spend, purchases, purchaseValue,
    impressions: Number(row.impressions), clicks: Number(row.clicks),
    roas: spend > 0 ? purchaseValue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : null };
}
