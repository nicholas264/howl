export async function ensureExperiments(sql) {
  await sql`CREATE TABLE IF NOT EXISTS creative_experiments (
    id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, hypothesis TEXT NOT NULL, protocol JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'running', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decision JSONB, decided_by TEXT, decided_at TIMESTAMPTZ
  )`;
}

export function validateProtocol(input) {
  if (!Array.isArray(input.variants)) throw new Error('Choose creative variants');
  const variants=[...new Set(input.variants)];
  if (variants.length < 2 || variants.length > 10 || variants.some(id=>typeof id !== 'string' || !id.trim() || id.length>100)) throw new Error('Choose 2–10 distinct creative variants');
  if (!['roas','cpa','purchase_rate'].includes(input.metric)) throw new Error('Select a primary metric');
  const days=Number(input.days),minPurchases=Number(input.minPurchases),minImpressions=Number(input.minImpressions);
  if (!Number.isInteger(days) || days<7 || days>90 || !Number.isSafeInteger(minPurchases) || minPurchases<20 || minPurchases>1000000 || !Number.isSafeInteger(minImpressions) || minImpressions<1000 || minImpressions>1000000000) throw new Error('Require 7–90 days, 20–1,000,000 purchases, and 1,000–1,000,000,000 impressions per variant');
  const start=new Date(); start.setUTCHours(0,0,0,0); start.setUTCDate(start.getUTCDate()+1);
  const end=new Date(start.getTime()+days*86400000);
  return {variants,metric:input.metric,days,minPurchases,minImpressions,since:start.toISOString().slice(0,10),until:end.toISOString().slice(0,10),
    design:'observational',attribution:'Meta ad-attributed performance; not randomized causal lift',timezone:'UTC reporting boundary; provider day definitions retained'};
}

export async function bindExperimentAds(sql, protocol) {
  const assignments=await sql`SELECT ad_id,variant_key FROM creative_performance WHERE variant_key IN
    (SELECT jsonb_array_elements_text(${JSON.stringify(protocol.variants)}::jsonb)) ORDER BY ad_id`;
  if (new Set(assignments.map(row=>row.variant_key)).size!==protocol.variants.length) throw new Error('Every selected variant must have an ingested ad');
  return {...protocol,assignments};
}

export async function experimentEvidence(sql,experiment,now=new Date()) {
  const protocol=experiment.protocol;
  if (!protocol.assignments?.length) return {sufficient:false,ended:false,rows:[],conclusion:'Inconclusive: protocol has no frozen ad assignments'};
  const rows=await sql`
    SELECT assignment.variant_key,
      bool_and(cp.variant_key IS NOT DISTINCT FROM assignment.variant_key) AS definitions_unchanged,
      COALESCE(SUM(i.spend),0)::float AS spend,COALESCE(SUM(i.purchases),0)::float AS purchases,
      COALESCE(SUM(i.impressions),0)::float AS impressions,COALESCE(SUM(i.purchase_value),0)::float AS purchase_value
    FROM jsonb_to_recordset(${JSON.stringify(protocol.assignments)}::jsonb) AS assignment(ad_id text,variant_key text)
    LEFT JOIN creative_performance cp ON cp.ad_id=assignment.ad_id
    LEFT JOIN creative_insights_daily i ON i.ad_id=assignment.ad_id AND i.date >= ${protocol.since}::date AND i.date < ${protocol.until}::date
    GROUP BY assignment.variant_key
  `;
  const ended=now.getTime() >= Date.parse(protocol.until+'T00:00:00Z');
  const sufficient=ended && rows.length===protocol.variants.length && rows.every(row=>row.definitions_unchanged && row.purchases>=protocol.minPurchases && row.impressions>=protocol.minImpressions);
  return {sufficient,ended,rows,conclusion:sufficient?'Eligible for a descriptive decision; causal lift remains unproven':'Inconclusive: observation window or minimum evidence is incomplete'};
}
