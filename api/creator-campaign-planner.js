import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

const FORMATS = new Set([
  'talking_head', 'yap', 'skit', 'high_production', 'demonstration',
  'comparison', 'day_in_the_life', 'customer_story',
]);

function clean(value, max = 5000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function parseJsonObject(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Strategy response was not valid JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function creatorScore(creator, productTitle) {
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

async function loadEvidence(sql, windowDays, productTitle) {
  const creators = await sql`
    SELECT
      c.id, c.name, c.stage, c.status, c.niche, c.strengths,
      c.audience_demographics, c.audience_psychographics, c.activities,
      c.rate_notes, c.location, c.bio,
      COALESCE(metrics.spend, 0)::float AS spend,
      COALESCE(metrics.revenue, 0)::float AS revenue,
      COALESCE(metrics.purchases, 0)::int AS purchases,
      COALESCE(metrics.impressions, 0)::bigint AS impressions,
      COALESCE(metrics.product_spend, 0)::float AS product_spend,
      COALESCE(metrics.product_revenue, 0)::float AS product_revenue,
      COALESCE(metrics.product_titles, ARRAY[]::text[]) AS product_titles,
      COALESCE((
        SELECT json_agg(json_build_object(
          'platform', s.platform, 'followers', s.followers,
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

function sanitizeAssignments(assignments, creators, count) {
  const creatorMap = new Map(creators.map(creator => [Number(creator.id), creator]));
  return (Array.isArray(assignments) ? assignments : []).slice(0, count).flatMap((assignment, index) => {
    const creator = creatorMap.get(Number(assignment.creator_id));
    if (!creator) return [];
    const format = FORMATS.has(assignment.format) ? assignment.format : 'talking_head';
    return [{
      slot: index + 1,
      creator_id: Number(creator.id),
      creator_name: creator.name,
      cohort: creator.proven ? 'proven' : 'net_new',
      format,
      concept_name: clean(assignment.concept_name, 200) || `${creator.name} ${format.replaceAll('_', ' ')}`,
      angle: clean(assignment.angle, 500),
      hypothesis: clean(assignment.hypothesis, 1500),
      creator_match: clean(assignment.creator_match, 1500),
      performance_logic: clean(assignment.performance_logic, 2000),
      evidence: Array.isArray(assignment.evidence) ? assignment.evidence.slice(0, 4).map(item => clean(item, 500)).filter(Boolean) : [],
      opening_visual: clean(assignment.opening_visual, 1500),
      hooks: Array.isArray(assignment.hooks) ? assignment.hooks.slice(0, 5).map(item => clean(item, 500)).filter(Boolean) : [],
      body_beats: Array.isArray(assignment.body_beats) ? assignment.body_beats.slice(0, 8).map(item => clean(item, 1000)).filter(Boolean) : [],
      full_script: clean(assignment.full_script, 8000),
      shot_list: Array.isArray(assignment.shot_list) ? assignment.shot_list.slice(0, 12).map(item => clean(item, 1000)).filter(Boolean) : [],
      ctas: Array.isArray(assignment.ctas) ? assignment.ctas.slice(0, 4).map(item => clean(item, 500)).filter(Boolean) : [],
      guardrails: Array.isArray(assignment.guardrails) ? assignment.guardrails.slice(0, 6).map(item => clean(item, 500)).filter(Boolean) : [],
    }];
  });
}

function validateAssignments(assignments, { assetCount, provenSlots, netNewSlots }) {
  const proven = assignments.filter(item => item.cohort === 'proven').length;
  const netNew = assignments.filter(item => item.cohort === 'net_new').length;
  if (assignments.length !== assetCount) {
    throw new Error(`Planner returned ${assignments.length} valid assignments instead of ${assetCount}`);
  }
  if (proven !== provenSlots || netNew !== netNewSlots) {
    throw new Error(`Planner allocation drifted to ${proven} proven and ${netNew} net-new assignments`);
  }
  const uses = new Map();
  for (const assignment of assignments) {
    uses.set(assignment.creator_id, (uses.get(assignment.creator_id) || 0) + 1);
    if ((assignment.hooks || []).length < 3 || !assignment.full_script || (assignment.body_beats || []).length < 4) {
      throw new Error(`Planner returned an incomplete creative package for ${assignment.creator_name}`);
    }
  }
  if ([...uses.values()].some(count => count > 2)) {
    throw new Error('Planner assigned one creator more than twice');
  }
  const distinctFormats = new Set(assignments.map(item => item.format)).size;
  if (distinctFormats < Math.min(3, assetCount)) {
    throw new Error('Planner did not create enough format diversity');
  }
}

async function generatePlan(sql, access, input) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const assetCount = integer(input.asset_count, 6, 2, 16);
  const provenPercent = integer(input.proven_percent, 60, 0, 100);
  const windowDays = integer(input.window_days, 90, 30, 365);
  const product = input.product_context || {};
  const productTitle = clean(product.title, 300);
  if (!productTitle) throw new Error('Choose a product first');
  const evidence = await loadEvidence(sql, windowDays, productTitle);
  if (!evidence.creators.length) throw new Error('No qualified creators are available for planning');

  const provenCreators = evidence.creators.filter(creator => creator.proven);
  const netNewCreators = evidence.creators.filter(creator => !creator.proven);
  if ((provenCreators.length + netNewCreators.length) * 2 < assetCount) {
    throw new Error('Not enough qualified creators are available to build this many distinct assignments');
  }
  const desiredProvenSlots = Math.round(assetCount * (provenPercent / 100));
  let provenSlots = Math.min(desiredProvenSlots, provenCreators.length * 2);
  let netNewSlots = assetCount - provenSlots;
  if (netNewSlots > netNewCreators.length * 2) {
    const shift = netNewSlots - (netNewCreators.length * 2);
    provenSlots += shift;
    netNewSlots -= shift;
  }
  const creatorCandidates = [
    ...provenCreators.sort((a, b) => b.score - a.score).slice(0, Math.max(provenSlots * 3, 8)),
    ...netNewCreators.sort((a, b) => b.score - a.score).slice(0, Math.max(netNewSlots * 3, 8)),
  ];

  const system = `You are HOWL's senior performance creative strategist and direct-response UGC director.
Build a portfolio, not a pile of similar scripts. Match creators to concepts using only the supplied profile and account evidence.

Creative quality rules:
- Use specific, spoken language. No generic "game changer", "you need this", fake testimonials, or invented personal facts.
- Every concept needs a visually arresting first three seconds, a clear persuasion mechanism, filmable product proof, and an explicit CTA.
- Use varied formats across the plan: talking_head, yap, skit, high_production, demonstration, comparison, day_in_the_life, customer_story.
- "Yap" means an opinionated, lightly structured creator monologue that feels native and conversational, not sloppy.
- "High production" still needs direct-response clarity. Cinematic footage is support, not the idea.
- Hooks, body, and CTA must work as one argument. Do not write interchangeable hook lists.
- Explain every creator and concept choice with concrete supplied metrics. State limitations when evidence is thin.
- Preserve proven mechanisms while allocating net-new slots to genuinely informative tests.
- Return only valid JSON.`;

  const prompt = `Build a ${assetCount}-asset creator campaign plan.

PRODUCT
${JSON.stringify(product, null, 2)}

OBJECTIVE
${clean(input.objective, 2000) || 'Acquire new customers efficiently with credible product proof.'}

PORTFOLIO ALLOCATION
Requested: ${provenPercent}% proven creators / ${100 - provenPercent}% net new creators.
Available allocation: ${provenSlots} proven slots / ${netNewSlots} net-new slots.

CREATOR CANDIDATES
${JSON.stringify(creatorCandidates, null, 2)}

ACCOUNT CREATIVE PATTERNS, LAST ${windowDays} DAYS
${JSON.stringify(evidence.patterns, null, 2)}

Return:
{
  "strategy_summary": "short portfolio strategy",
  "allocation_logic": "why this split is sensible given available evidence",
  "assignments": [{
    "creator_id": 123,
    "format": "talking_head",
    "concept_name": "short name",
    "angle": "specific persuasion angle",
    "hypothesis": "falsifiable expected result",
    "creator_match": "why this creator is right",
    "performance_logic": "plain-English explanation of the account evidence",
    "evidence": ["metric statement with timeframe and sample size"],
    "opening_visual": "exact first 0-3 second visual",
    "hooks": ["3 distinct but strategically consistent spoken hooks"],
    "body_beats": ["ordered argument beat 1", "beat 2", "proof", "objection handling"],
    "full_script": "natural 25-50 second script including visual direction in brackets",
    "shot_list": ["specific shot"],
    "ctas": ["2 CTA options"],
    "guardrails": ["claim or execution to avoid"]
  }]
}

Use each creator at most twice. Return exactly ${assetCount} assignments and honor the available proven/net-new slot counts.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 18000,
      temperature: 0.45,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Campaign planning failed');
  const raw = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  const generated = parseJsonObject(raw);
  const assignments = sanitizeAssignments(generated.assignments, evidence.creators, assetCount);
  validateAssignments(assignments, { assetCount, provenSlots, netNewSlots });

  const [plan] = await sql`
    INSERT INTO creator_campaign_plans (
      product_id, product_title, objective, asset_count, proven_percent,
      evidence_window_days, strategy_summary, evidence, assignments, created_by
    ) VALUES (
      ${clean(product.id, 500)}, ${productTitle}, ${clean(input.objective, 2000)},
      ${assetCount}, ${provenPercent}, ${windowDays},
      ${clean(generated.strategy_summary, 3000)},
      ${JSON.stringify({
        allocation_logic: clean(generated.allocation_logic, 3000),
        patterns: evidence.patterns.slice(0, 20),
      })}::jsonb,
      ${JSON.stringify(assignments)}::jsonb, ${access.userId}
    )
    RETURNING *
  `;
  return plan;
}

async function saveBriefs(sql, access, planId) {
  const [plan] = await sql`SELECT * FROM creator_campaign_plans WHERE id = ${planId}`;
  if (!plan) throw new Error('Campaign plan not found');
  if (plan.status === 'briefed') {
    return sql`SELECT * FROM creator_briefs WHERE generation_source = ${`campaign_plan:${planId}`} ORDER BY id`;
  }
  const briefs = [];
  for (const assignment of plan.assignments || []) {
    const briefText = [
      `FORMAT\n${assignment.format?.replaceAll('_', ' ')}`,
      `WHY THIS CREATOR\n${assignment.creator_match}`,
      `PERFORMANCE LOGIC\n${assignment.performance_logic}`,
      `HYPOTHESIS\n${assignment.hypothesis}`,
      `OPENING VISUAL\n${assignment.opening_visual}`,
      `HOOK OPTIONS\n${(assignment.hooks || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
      `BODY BEATS\n${(assignment.body_beats || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
      `CTA OPTIONS\n${(assignment.ctas || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
      `SHOT LIST\n${(assignment.shot_list || []).map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
      assignment.guardrails?.length ? `GUARDRAILS\n${assignment.guardrails.join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
    const [brief] = await sql`
      INSERT INTO creator_briefs (
        creator_id, title, product, objective, angle, deliverables,
        brief, script, status, generation_source, created_by
      ) VALUES (
        ${assignment.creator_id}, ${assignment.concept_name}, ${plan.product_title},
        ${plan.objective}, ${assignment.angle},
        ${JSON.stringify([`${assignment.format?.replaceAll('_', ' ')} video`, 'Raw footage', 'Three hook variations'])}::jsonb,
        ${briefText}, ${assignment.full_script}, 'draft', ${`campaign_plan:${planId}`}, ${access.userId}
      )
      RETURNING *
    `;
    briefs.push(brief);
    await sql`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      VALUES (
        ${assignment.creator_id}, 'campaign_brief_created',
        ${`Campaign brief created: ${assignment.concept_name}`},
        ${JSON.stringify({ plan_id: Number(planId), brief_id: Number(brief.id), format: assignment.format })}::jsonb,
        ${access.userId}
      )
    `;
  }
  await sql`UPDATE creator_campaign_plans SET status = 'briefed', updated_at = now() WHERE id = ${planId}`;
  return briefs;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') {
      const [plans, creators, coverage, unlinkedLabels] = await Promise.all([
        sql`
          SELECT id, product_title, objective, asset_count, proven_percent, status,
            strategy_summary, assignments, created_at
          FROM creator_campaign_plans
          ORDER BY created_at DESC
          LIMIT 20
        `,
        sql`
          SELECT id, name, stage
          FROM creators
          WHERE status IN ('qualified', 'contracted') AND stage <> 'alumni'
          ORDER BY name
          LIMIT 500
        `,
        sql`
          SELECT
            count(*)::int AS total_launches,
            count(*) FILTER (WHERE creator_id IS NOT NULL)::int AS attributed_launches,
            count(DISTINCT creator_id) FILTER (WHERE creator_id IS NOT NULL)::int AS attributed_creators
          FROM launch_history
        `,
        sql`
          SELECT creator AS label, count(*)::int AS launches
          FROM launch_history
          WHERE creator_id IS NULL AND creator IS NOT NULL AND btrim(creator) <> ''
          GROUP BY creator
          ORDER BY launches DESC, creator
        `,
      ]);
      return res.json({
        plans,
        creators,
        attribution: {
          ...(coverage[0] || {}),
          unlinked_labels: unlinkedLabels,
        },
      });
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (req.body?.action === 'link_creator_label') {
      const creatorId = Number(req.body?.creator_id);
      const label = clean(req.body?.label, 300);
      if (!creatorId || !label) return res.status(400).json({ error: 'creator_id and label required' });
      const [creator] = await sql`SELECT id, name FROM creators WHERE id = ${creatorId}`;
      if (!creator) return res.status(404).json({ error: 'Creator not found' });
      const launches = await sql`
        UPDATE launch_history
        SET creator_id = ${creatorId}
        WHERE creator_id IS NULL AND lower(creator) = lower(${label})
        RETURNING id
      `;
      await sql`
        UPDATE creative_assets
        SET creator_id = ${creatorId}, updated_at = now()
        WHERE creator_id IS NULL AND lower(creator) = lower(${label})
      `;
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        VALUES (
          ${creatorId}, 'performance_history_linked',
          ${`Linked ${launches.length} historical launch${launches.length === 1 ? '' : 'es'} from "${label}"`},
          ${JSON.stringify({ source_label: label, launches: launches.length })}::jsonb,
          ${access.userId}
        )
      `;
      return res.json({ linked: launches.length, creator });
    }
    if (req.body?.action === 'generate') {
      const plan = await generatePlan(sql, access, req.body);
      return res.status(201).json({ plan });
    }
    if (req.body?.action === 'save_briefs') {
      const planId = Number(req.body?.plan_id);
      if (!planId) return res.status(400).json({ error: 'plan_id required' });
      const briefs = await saveBriefs(sql, access, planId);
      return res.json({ briefs });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
