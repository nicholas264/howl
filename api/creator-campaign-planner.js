import { requirePermission } from './_lib/app-access.js';
import { loadBrandGuidelines, validateBrandCopy } from './_lib/brand-guardrails.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { creatorFitSignals, creatorSnapshot, loadEvidence } from './_lib/creator-matching.js';

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

function decimal(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function parseJsonObject(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Strategy response was not valid JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitizeAssignments(assignments, creators, count) {
  const creatorMap = new Map(creators.map(creator => [Number(creator.id), creator]));
  return (Array.isArray(assignments) ? assignments : []).slice(0, count).flatMap((assignment, index) => {
    const creator = creatorMap.get(Number(assignment.creator_id));
    if (!creator) return [];
    const format = FORMATS.has(assignment.format) ? assignment.format : 'talking_head';
    const generatedSignals = Array.isArray(assignment.creator_fit_signals)
      ? assignment.creator_fit_signals.slice(0, 5).map(item => clean(item, 500)).filter(Boolean)
      : [];
    const fitSignals = generatedSignals.length ? generatedSignals : creatorFitSignals(creator).slice(0, 5);
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
      creator_fit_signals: fitSignals,
      creator_snapshot: creatorSnapshot(creator),
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

function allocateBudget(assignments, totalBudget, provenPercent) {
  if (!totalBudget) return assignments.map(item => ({ ...item, allocated_budget: null }));
  const cohorts = {
    proven: assignments.filter(item => item.cohort === 'proven'),
    net_new: assignments.filter(item => item.cohort === 'net_new'),
  };
  const bothAvailable = cohorts.proven.length && cohorts.net_new.length;
  const cohortBudgets = {
    proven: cohorts.proven.length
      ? (bothAvailable ? totalBudget * (provenPercent / 100) : totalBudget)
      : 0,
    net_new: cohorts.net_new.length
      ? (bothAvailable ? totalBudget * ((100 - provenPercent) / 100) : totalBudget)
      : 0,
  };
  const allocation = new Map();
  for (const cohort of ['proven', 'net_new']) {
    let distributed = 0;
    cohorts[cohort].forEach((item, index) => {
      const amount = index === cohorts[cohort].length - 1
        ? Math.round((cohortBudgets[cohort] - distributed) * 100) / 100
        : Math.round((cohortBudgets[cohort] / cohorts[cohort].length) * 100) / 100;
      distributed += amount;
      allocation.set(item, amount);
    });
  }
  return assignments.map(item => ({ ...item, allocated_budget: allocation.get(item) || 0 }));
}

function guidelineViolations(assignments, guidelines) {
  const violations = [];
  for (const assignment of assignments) {
    const content = [
      assignment.concept_name, assignment.angle, assignment.hypothesis,
      assignment.opening_visual, assignment.full_script,
      ...(assignment.hooks || []), ...(assignment.ctas || []),
    ].filter(Boolean).join('\n');
    for (const violation of validateBrandCopy(content, guidelines)) {
      violations.push(`${assignment.creator_name}: ${violation}`);
    }
  }
  return [...new Set(violations)];
}

function assignmentApprovalProblems(assignments) {
  const problems = [];
  for (const assignment of assignments) {
    const label = assignment.creator_name || assignment.concept_name || `Assignment ${assignment.slot || ''}`.trim() || 'Assignment';
    const hooks = Array.isArray(assignment.hooks) ? assignment.hooks.filter(Boolean) : [];
    const ctas = Array.isArray(assignment.ctas) ? assignment.ctas.filter(Boolean) : [];
    const shots = Array.isArray(assignment.shot_list) ? assignment.shot_list.filter(Boolean) : [];
    if (!assignment.approved_for_brief) problems.push(`${label}: approve the final concept before creating a creator brief`);
    if (!assignment.creator_id) problems.push(`${label}: missing creator`);
    if (!clean(assignment.concept_name, 200)) problems.push(`${label}: missing concept name`);
    if (!clean(assignment.creator_match, 500)) problems.push(`${label}: missing creator match logic`);
    if (!clean(assignment.performance_logic, 500)) problems.push(`${label}: missing performance logic`);
    if (!clean(assignment.opening_visual, 500)) problems.push(`${label}: missing opening visual`);
    if (hooks.length < 3) problems.push(`${label}: needs at least 3 hook options`);
    if (!clean(assignment.full_script, 5000) || clean(assignment.full_script, 5000).length < 120) problems.push(`${label}: script is too thin`);
    if (ctas.length < 1) problems.push(`${label}: needs at least 1 CTA`);
    if (shots.length < 2) problems.push(`${label}: needs at least 2 shots`);
  }
  return problems;
}

function validateAssignments(assignments, { assetCount, provenSlots, netNewSlots, totalBudget, guidelines }) {
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
  const violations = guidelineViolations(assignments, guidelines);
  if (violations.length) {
    throw new Error(`Brand guardrails blocked generated language: ${violations.slice(0, 5).join(', ')}`);
  }
  if (totalBudget) {
    const allocated = assignments.reduce((sum, item) => sum + Number(item.allocated_budget || 0), 0);
    if (Math.abs(allocated - totalBudget) > 0.02) throw new Error('Planner budget allocation did not reconcile');
  }
}

async function generatePlan(sql, access, input) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const assetCount = integer(input.asset_count, 6, 2, 16);
  const provenPercent = integer(input.proven_percent, 60, 0, 100);
  const totalBudget = decimal(input.total_budget, 0, 0, 100000000);
  const windowDays = integer(input.window_days, 90, 30, 365);
  const product = input.product_context || {};
  const productTitle = clean(product.title, 300);
  if (!productTitle) throw new Error('Choose a product first');
  const [evidence, guidelinesRows] = await Promise.all([
    loadEvidence(sql, windowDays, productTitle),
    sql`SELECT * FROM brand_guidelines ORDER BY updated_at DESC LIMIT 1`,
  ]);
  const guidelines = guidelinesRows[0] || {
    brand_name: 'HOWL Campfires',
    voice_guidance: 'Direct, practical, specific, outdoor-literate, and confident.',
    approved_claims: [],
    prohibited_phrases: ['game changer', 'you need this', 'must-have', 'obsessed'],
    prohibited_claims: [],
    required_disclosures: [],
  };
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
- Creator fit must use the supplied creator intelligence: strengths, niche, audience demographics, audience psychographics, activities, social metrics, application intent, and prior attributed performance.
- If audience psychographics are supplied, use them to shape the hook/body/CTA argument. Do not ignore them.
- Every assignment must include creator_fit_signals: short bullets that explain why this creator should be matched to this concept.
- Preserve proven mechanisms while allocating net-new slots to genuinely informative tests.
- Treat the supplied brand guidelines as hard constraints. Never use prohibited language or unsupported claims.
- Return only valid JSON.`;

  const prompt = `Build a ${assetCount}-asset creator campaign plan.

PRODUCT
${JSON.stringify(product, null, 2)}

OBJECTIVE
${clean(input.objective, 2000) || 'Acquire new customers efficiently with credible product proof.'}

BRAND GUIDELINES
${JSON.stringify(guidelines, null, 2)}

PORTFOLIO ALLOCATION
Requested: ${provenPercent}% proven creators / ${100 - provenPercent}% net new creators.
Available allocation: ${provenSlots} proven slots / ${netNewSlots} net-new slots.
Paid media budget: ${totalBudget ? `$${totalBudget.toFixed(2)}` : 'Not supplied; allocate assets only.'}

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
    "creator_fit_signals": ["creator-specific signal used in this decision"],
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
  const assignments = allocateBudget(
    sanitizeAssignments(generated.assignments, evidence.creators, assetCount),
    totalBudget,
    provenPercent,
  );
  validateAssignments(assignments, { assetCount, provenSlots, netNewSlots, totalBudget, guidelines });

  const [plan] = await sql`
    INSERT INTO creator_campaign_plans (
      product_id, product_title, objective, asset_count, proven_percent, total_budget,
      evidence_window_days, strategy_summary, evidence, assignments, created_by
    ) VALUES (
      ${clean(product.id, 500)}, ${productTitle}, ${clean(input.objective, 2000)},
      ${assetCount}, ${provenPercent}, ${totalBudget || null}, ${windowDays},
      ${clean(generated.strategy_summary, 3000)},
      ${JSON.stringify({
        allocation_logic: clean(generated.allocation_logic, 3000),
        patterns: evidence.patterns.slice(0, 20),
        brand_guidelines_version: guidelines.updated_at || null,
      })}::jsonb,
      ${JSON.stringify(assignments)}::jsonb, ${access.userId}
    )
    RETURNING *
  `;
  return plan;
}

async function saveBriefs(sql, access, planId, assignmentOverride = null) {
  const [plan] = await sql`SELECT * FROM creator_campaign_plans WHERE id = ${planId}`;
  if (!plan) throw new Error('Campaign plan not found');
  if (plan.status === 'briefed') {
    return sql`SELECT * FROM creator_briefs WHERE generation_source = ${`campaign_plan:${planId}`} ORDER BY id`;
  }
  const assignments = Array.isArray(assignmentOverride) && assignmentOverride.length
    ? assignmentOverride.map((assignment, index) => ({ ...assignment, slot: index + 1 }))
    : plan.assignments || [];
  const approvalProblems = assignmentApprovalProblems(assignments);
  if (approvalProblems.length) {
    throw new Error(`Approve complete final scripts before creating briefs: ${approvalProblems.slice(0, 6).join(', ')}`);
  }
  const guidelines = await loadBrandGuidelines(sql);
  const violations = guidelineViolations(assignments, guidelines);
  if (violations.length) {
    throw new Error(`Brand guardrails blocked approved scripts: ${violations.slice(0, 5).join(', ')}`);
  }
  const briefs = [];
  const updatedAssignments = [];
  for (const assignment of assignments) {
    const briefText = [
      `FORMAT\n${assignment.format?.replaceAll('_', ' ')}`,
      `WHY THIS CREATOR\n${assignment.creator_match}`,
      assignment.creator_fit_signals?.length
        ? `CREATOR FIT SIGNALS\n${assignment.creator_fit_signals.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
        : null,
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
    updatedAssignments.push({ ...assignment, brief_id: Number(brief.id) });
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
  await sql`
    UPDATE creator_campaign_plans
    SET status = 'briefed', assignments = ${JSON.stringify(updatedAssignments)}::jsonb, updated_at = now()
    WHERE id = ${planId}
  `;
  return briefs;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') {
      const [plans, assignmentOutcomes, creators, coverage, unlinkedLabels] = await Promise.all([
        sql`
          SELECT p.id, p.product_title, p.objective, p.asset_count, p.proven_percent,
            p.total_budget::float, p.status, p.strategy_summary, p.evidence_window_days,
            p.assignments, p.created_at,
            COALESCE(outcomes.spend, 0)::float AS outcome_spend,
            COALESCE(outcomes.revenue, 0)::float AS outcome_revenue,
            COALESCE(outcomes.purchases, 0)::int AS outcome_purchases,
            COALESCE(outcomes.attributed_assignments, 0)::int AS attributed_assignments
          FROM creator_campaign_plans p
          LEFT JOIN LATERAL (
            SELECT
              sum(i.spend) AS spend,
              sum(i.purchase_value) AS revenue,
              sum(i.purchases) AS purchases,
              count(DISTINCT l.brief_id) AS attributed_assignments
            FROM launch_history l
            JOIN creative_insights_daily i ON i.ad_id = l.ad_id
            WHERE l.brief_id IN (
              SELECT (assignment->>'brief_id')::bigint
              FROM jsonb_array_elements(p.assignments) assignment
              WHERE assignment->>'brief_id' IS NOT NULL
            )
          ) outcomes ON true
          ORDER BY p.created_at DESC
          LIMIT 20
        `,
        sql`
          SELECT
            split_part(b.generation_source, ':', 2)::bigint AS plan_id,
            b.id AS brief_id,
            COALESCE(sum(i.spend), 0)::float AS spend,
            COALESCE(sum(i.purchase_value), 0)::float AS revenue,
            COALESCE(sum(i.purchases), 0)::int AS purchases,
            count(DISTINCT l.ad_id)::int AS ads
          FROM creator_briefs b
          JOIN launch_history l ON l.brief_id = b.id
          JOIN creative_insights_daily i ON i.ad_id = l.ad_id
          WHERE b.generation_source LIKE 'campaign_plan:%'
          GROUP BY b.generation_source, b.id
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
            count(*) FILTER (
              WHERE creator_id IS NOT NULL
                OR source_type IN ('internal_employee', 'founder', 'tool_generated')
            )::int AS attributed_launches,
            count(DISTINCT creator_id) FILTER (WHERE creator_id IS NOT NULL)::int AS attributed_creators
          FROM launch_history
        `,
        sql`
          WITH repairable_labels AS (
            SELECT COALESCE(NULLIF(btrim(creator), ''), NULLIF(btrim(source_label), '')) AS label
            FROM launch_history
            WHERE creator_id IS NULL
              AND (source_type IS NULL OR source_type = 'external_creator')
          )
          SELECT label, count(*)::int AS launches
          FROM repairable_labels
          WHERE label IS NOT NULL
          GROUP BY label
          ORDER BY launches DESC, label
        `,
      ]);
      const outcomesByBrief = new Map(assignmentOutcomes.map(item => [Number(item.brief_id), item]));
      const plansWithOutcomes = plans.map(plan => ({
        ...plan,
        assignments: (plan.assignments || []).map(assignment => ({
          ...assignment,
          outcome: outcomesByBrief.get(Number(assignment.brief_id)) || null,
        })),
      }));
      return res.json({
        plans: plansWithOutcomes,
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
        WHERE creator_id IS NULL
          AND (source_type IS NULL OR source_type = 'external_creator')
          AND lower(COALESCE(NULLIF(btrim(creator), ''), NULLIF(btrim(source_label), ''))) = lower(${label})
        RETURNING id
      `;
      await sql`
        UPDATE creative_assets
        SET creator_id = ${creatorId}, updated_at = now()
        WHERE creator_id IS NULL
          AND (source_type IS NULL OR source_type = 'external_creator')
          AND lower(COALESCE(NULLIF(btrim(creator), ''), NULLIF(btrim(source_label), ''))) = lower(${label})
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
      const briefs = await saveBriefs(sql, access, planId, req.body?.assignments);
      return res.json({ briefs });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
