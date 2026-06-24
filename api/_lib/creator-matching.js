// Shared creator-matching engine. Extracted verbatim from creator-campaign-planner
// so both the campaign planner and the Creative Flow matcher score creators the
// same way. Pure scoring helpers + the evidence loader (creator performance +
// account patterns) used to rank the roster against a product.

export function creatorScore(creator, productTitle) {
  const spend = Number(creator.spend || 0);
  const revenue = Number(creator.revenue || 0);
  const purchases = Number(creator.purchases || 0);
  const roas = spend > 0 ? revenue / spend : 0;
  const productSpend = Number(creator.product_spend || 0);
  const productRevenue = Number(creator.product_revenue || 0);
  const productRoas = productSpend > 0 ? productRevenue / productSpend : 0;
  const profileFields = [
    creator.niche, creator.strengths, creator.audience_demographics,
    creator.audience_psychographics, creator.activities?.length,
  ].filter(Boolean).length;
  const proven = spend >= 100 || purchases >= 2;
  return {
    ...creator,
    proven,
    roas,
    cpa: purchases > 0 ? spend / purchases : null,
    product_roas: productRoas,
    score: (proven ? 30 : 0)
      + Math.min(spend / 100, 20)
      + Math.min(roas * 8, 24)
      + Math.min(productRoas * 10, 20)
      + profileFields * 3
      + (productTitle && creator.product_titles?.some(title => title?.toLowerCase().includes(productTitle.toLowerCase())) ? 10 : 0),
  };
}

export function creatorFitSignals(creator) {
  const signals = [];
  const spend = Number(creator.spend || 0);
  const revenue = Number(creator.revenue || 0);
  const purchases = Number(creator.purchases || 0);
  const roas = spend > 0 ? revenue / spend : 0;
  const productSpend = Number(creator.product_spend || 0);
  const productRevenue = Number(creator.product_revenue || 0);
  const productRoas = productSpend > 0 ? productRevenue / productSpend : 0;
  if (spend > 0) {
    signals.push(`Creator history: $${Math.round(spend).toLocaleString()} spend, ${roas.toFixed(2)}x ROAS${purchases ? `, ${purchases} purchases` : ''}.`);
  }
  if (productSpend > 0) {
    signals.push(`Product-adjacent history: $${Math.round(productSpend).toLocaleString()} spend, ${productRoas.toFixed(2)}x ROAS.`);
  }
  if (creator.niche) signals.push(`Niche: ${creator.niche}.`);
  if (creator.strengths) signals.push(`Creator strengths: ${creator.strengths}.`);
  if (creator.audience_demographics) signals.push(`Audience: ${creator.audience_demographics}.`);
  if (creator.audience_psychographics) signals.push(`Audience mindset: ${creator.audience_psychographics}.`);
  if (Array.isArray(creator.activities) && creator.activities.length) {
    signals.push(`Native activities: ${creator.activities.slice(0, 6).join(', ')}.`);
  }
  if (creator.source_metadata?.application_why_howl) {
    signals.push(`Inbound intent: ${creator.source_metadata.application_why_howl}`);
  }
  const social = Array.isArray(creator.socials) ? creator.socials.find(item => Number(item.followers) > 0) : null;
  if (social) {
    signals.push(`${social.platform}: ${Number(social.followers).toLocaleString()} followers${social.engagement_rate ? `, ${Number(social.engagement_rate).toFixed(1)}% engagement` : ''}.`);
  }
  return signals.slice(0, 8);
}

export function creatorSnapshot(creator) {
  return {
    niche: creator.niche || null,
    strengths: creator.strengths || null,
    audience_demographics: creator.audience_demographics || null,
    audience_psychographics: creator.audience_psychographics || null,
    activities: Array.isArray(creator.activities) ? creator.activities.slice(0, 8) : [],
    rate_notes: creator.rate_notes || null,
    spend: Number(creator.spend || 0),
    revenue: Number(creator.revenue || 0),
    purchases: Number(creator.purchases || 0),
    roas: Number(creator.roas || 0),
    product_roas: Number(creator.product_roas || 0),
    fit_signals: creatorFitSignals(creator),
  };
}

export async function loadEvidence(sql, windowDays, productTitle) {
  const creators = await sql`
    SELECT
      c.id, c.name, c.stage, c.status, c.niche, c.strengths,
      c.audience_demographics, c.audience_psychographics, c.activities,
      c.rate_notes, c.location, c.bio, c.source_metadata,
      COALESCE(metrics.spend, 0)::float AS spend,
      COALESCE(metrics.revenue, 0)::float AS revenue,
      COALESCE(metrics.purchases, 0)::int AS purchases,
      COALESCE(metrics.impressions, 0)::bigint AS impressions,
      COALESCE(metrics.product_spend, 0)::float AS product_spend,
      COALESCE(metrics.product_revenue, 0)::float AS product_revenue,
      COALESCE(metrics.product_titles, ARRAY[]::text[]) AS product_titles,
      COALESCE((
        SELECT json_agg(json_build_object(
          'platform', s.platform, 'handle', s.handle, 'followers', s.followers,
          'avg_views', s.avg_views, 'engagement_rate', s.engagement_rate
        ))
        FROM creator_social_accounts s WHERE s.creator_id = c.id
      ), '[]'::json) AS socials
    FROM creators c
    LEFT JOIN LATERAL (
      SELECT
        sum(i.spend) AS spend,
        sum(i.purchase_value) AS revenue,
        sum(i.purchases) AS purchases,
        sum(i.impressions) AS impressions,
        sum(i.spend) FILTER (
          WHERE ${productTitle}::text IS NOT NULL
            AND (lower(COALESCE(l.product_id, '')) LIKE ${productTitle ? `%${productTitle.toLowerCase()}%` : null}
              OR lower(COALESCE(l.ad_name, '')) LIKE ${productTitle ? `%${productTitle.toLowerCase()}%` : null})
        ) AS product_spend,
        sum(i.purchase_value) FILTER (
          WHERE ${productTitle}::text IS NOT NULL
            AND (lower(COALESCE(l.product_id, '')) LIKE ${productTitle ? `%${productTitle.toLowerCase()}%` : null}
              OR lower(COALESCE(l.ad_name, '')) LIKE ${productTitle ? `%${productTitle.toLowerCase()}%` : null})
        ) AS product_revenue,
        array_agg(DISTINCT l.product_id) FILTER (WHERE l.product_id IS NOT NULL) AS product_titles
      FROM launch_history l
      JOIN creative_insights_daily i ON i.ad_id = l.ad_id
      WHERE (l.creator_id = c.id OR lower(l.creator) = lower(c.name))
        AND i.date >= current_date - (${windowDays}::int * interval '1 day')
    ) metrics ON true
    WHERE c.status IN ('qualified', 'contracted')
      AND c.stage NOT IN ('alumni')
    ORDER BY COALESCE(metrics.revenue, 0) DESC, c.updated_at DESC
    LIMIT 150
  `;

  const patterns = await sql`
    WITH pattern_ads AS (
      SELECT DISTINCT cp.group_key, ca.format, ca.hook_type, ca.angle, ca.talent_description
      FROM creative_performance cp
      JOIN creative_analysis ca ON ca.group_key = cp.group_key
    )
    SELECT
      COALESCE(p.format, 'unknown') AS format,
      COALESCE(p.hook_type, 'unknown') AS hook_type,
      COALESCE(p.angle, 'unknown') AS angle,
      COALESCE(p.talent_description, 'unknown') AS talent_description,
      count(DISTINCT cp.group_key)::int AS assets,
      COALESCE(sum(i.spend), 0)::float AS spend,
      COALESCE(sum(i.purchase_value), 0)::float AS revenue,
      COALESCE(sum(i.purchases), 0)::int AS purchases,
      COALESCE(sum(i.impressions), 0)::bigint AS impressions,
      COALESCE(sum(i.clicks), 0)::bigint AS clicks,
      COALESCE(sum(i.video_3s_views), 0)::bigint AS video_3s_views
    FROM pattern_ads p
    JOIN creative_performance cp ON cp.group_key = p.group_key
    JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
    WHERE i.date >= current_date - (${windowDays}::int * interval '1 day')
    GROUP BY p.format, p.hook_type, p.angle, p.talent_description
    HAVING sum(i.spend) >= 50
    ORDER BY sum(i.purchase_value) DESC, sum(i.spend) DESC
    LIMIT 35
  `;

  return {
    creators: creators.map(creator => creatorScore(creator, productTitle)),
    patterns: patterns.map(pattern => {
      const spend = Number(pattern.spend || 0);
      const revenue = Number(pattern.revenue || 0);
      const purchases = Number(pattern.purchases || 0);
      const impressions = Number(pattern.impressions || 0);
      return {
        ...pattern,
        roas: spend > 0 ? revenue / spend : 0,
        cpa: purchases > 0 ? spend / purchases : null,
        hook_rate: impressions > 0 ? Number(pattern.video_3s_views || 0) / impressions : 0,
        ctr: impressions > 0 ? Number(pattern.clicks || 0) / impressions : 0,
      };
    }),
  };
}
