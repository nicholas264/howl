import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { del } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { submissionTokenHash } from './_lib/creator-submissions.js';
import { agreementTokenHash, renderAgreementTemplate } from './_lib/creator-agreements.js';
import { loadBrandGuidelines, validateBrandCopy } from './_lib/brand-guardrails.js';

function clean(value, max = 10000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function guidelineText(guidelines = {}) {
  return [
    `Brand: ${guidelines.brand_name || 'HOWL Campfires'}`,
    guidelines.voice_guidance ? `Voice: ${guidelines.voice_guidance}` : null,
    guidelines.approved_claims?.length ? `Approved claims:\n- ${guidelines.approved_claims.join('\n- ')}` : null,
    guidelines.prohibited_phrases?.length ? `Never use these phrases:\n- ${guidelines.prohibited_phrases.join('\n- ')}` : null,
    guidelines.prohibited_claims?.length ? `Never make these claims:\n- ${guidelines.prohibited_claims.join('\n- ')}` : null,
    guidelines.required_disclosures?.length ? `Required disclosures:\n- ${guidelines.required_disclosures.join('\n- ')}` : null,
  ].filter(Boolean).join('\n\n');
}

function assertBriefBrandSafe(candidate, guidelines) {
  const content = [
    candidate?.title,
    candidate?.objective,
    candidate?.angle,
    candidate?.brief,
    candidate?.script,
    ...(Array.isArray(candidate?.deliverables) ? candidate.deliverables : []),
  ].filter(Boolean).join('\n');
  const violations = validateBrandCopy(content, guidelines);
  if (violations.length) {
    const error = new Error(`Brand guardrails blocked creator script: ${violations.slice(0, 5).join(', ')}`);
    error.code = 'BRAND_GUARDRAIL';
    error.violations = violations;
    throw error;
  }
}

function buildWorkflowGuidance({
  creator, outreach, engagements, agreements, briefs, seeds, deliverables, submissionLinks,
}) {
  const outbound = outreach.filter(item => item.direction === 'outbound');
  const hasSentOutreach = outbound.some(item => ['sent', 'follow_up', 'replied', 'closed'].includes(item.status));
  const hasReply = outreach.some(item => item.direction === 'inbound' || item.replied_at || item.status === 'replied');
  const hasInterest = outbound.some(item => ['interested', 'contracted'].includes(item.outcome))
    || ['interested', 'briefing', 'producing', 'active'].includes(creator.stage);
  const openFollowUp = outbound.find(item => (
    item.next_follow_up_at
    && !item.outcome
    && !item.replied_at
    && ['sent', 'follow_up'].includes(item.status)
  ));
  const followUpDue = openFollowUp && new Date(openFollowUp.next_follow_up_at).getTime() <= Date.now();
  const liveEngagement = engagements.find(item => ['approved', 'active'].includes(item.status));
  const anyEngagement = liveEngagement || engagements.find(item => item.status === 'draft');
  const acceptedAgreement = agreements.find(item => item.status === 'accepted');
  const openAgreement = agreements.find(item => ['draft', 'sent'].includes(item.status));
  const activeSubmission = submissionLinks.find(item => item.status === 'active');
  const productSeeded = creator.product_seeding_required === false
    || seeds.some(item => ['ordered', 'shipped', 'delivered'].includes(item.status))
    || deliverables.length > 0
    || Number(creator.launch_count || 0) > 0;
  const shippingReady = Boolean(
    creator.shipping_address1
    && creator.shipping_city
    && creator.shipping_region
    && creator.shipping_postal_code
    && creator.shipping_country_code
  );
  const overdueDeliverable = deliverables
    .filter(item => (
      item.due_at
      && new Date(item.due_at).getTime() < Date.now()
      && !['complete', 'launched', 'cancelled'].includes(item.status)
      && Number(item.completed_asset_count || 0) < Number(item.expected_asset_count || 1)
    ))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
  const received = deliverables.some(item => (
    Number(item.received_asset_count || 0) > 0
    || ['received', 'editing', 'edited', 'approved', 'complete', 'launched'].includes(item.status)
  ));
  const completed = deliverables.some(item => (
    Number(item.completed_asset_count || 0) > 0
    || ['complete', 'launched'].includes(item.status)
  ));
  const launched = Number(creator.launch_count || 0) > 0
    || deliverables.some(item => item.status === 'launched' || Number(item.shipped_asset_count || 0) > 0);

  const milestones = [
    { key: 'relationship', label: 'Relationship', complete: hasReply || hasInterest },
    { key: 'terms', label: 'Terms', complete: Boolean(liveEngagement) },
    { key: 'agreement', label: 'Agreement', complete: Boolean(acceptedAgreement) },
    { key: 'creative', label: 'Creative', complete: briefs.length > 0 },
    { key: 'product', label: 'Product', complete: productSeeded },
    { key: 'production', label: 'Production', complete: completed },
    { key: 'launch', label: 'Launch', complete: launched },
  ];

  let nextAction;
  if (!creator.email) {
    nextAction = {
      key: 'add_contact', label: 'Add creator email',
      description: 'A valid email unlocks outreach, agreements, and assignment delivery.',
      tab: 'profile', blocker: true, recommended_stage: 'sourced',
    };
  } else if (!hasSentOutreach && !hasInterest) {
    nextAction = {
      key: 'start_outreach', label: 'Start creator outreach',
      description: 'Draft a specific introduction grounded in this creator profile.',
      tab: 'outreach', recommended_stage: 'sourced',
    };
  } else if (followUpDue) {
    nextAction = {
      key: 'follow_up', label: 'Follow up now',
      description: `The next action was due ${new Date(openFollowUp.next_follow_up_at).toLocaleDateString('en-US')}.`,
      tab: 'outreach', urgent: true, recommended_stage: 'contacted',
    };
  } else if (!hasReply && !hasInterest) {
    nextAction = {
      key: 'await_reply', label: 'Await creator reply',
      description: openFollowUp
        ? `Follow-up is scheduled for ${new Date(openFollowUp.next_follow_up_at).toLocaleDateString('en-US')}.`
        : 'Outreach is sent. Add a follow-up date so this relationship stays visible.',
      tab: 'outreach', waiting: true, recommended_stage: 'contacted',
    };
  } else if (!anyEngagement) {
    nextAction = {
      key: 'define_terms', label: 'Define commercial terms',
      description: 'Capture rates, asset commitment, usage rights, and payment terms.',
      tab: 'agreements', recommended_stage: 'interested',
    };
  } else if (!liveEngagement) {
    nextAction = {
      key: 'approve_terms', label: 'Approve commercial terms',
      description: 'The engagement is still a draft. Confirm the relationship before contracting.',
      tab: 'agreements', recommended_stage: 'interested',
    };
  } else if (!acceptedAgreement) {
    nextAction = {
      key: openAgreement?.status === 'sent' ? 'await_agreement' : 'send_agreement',
      label: openAgreement?.status === 'sent' ? 'Await agreement acceptance' : 'Prepare and send agreement',
      description: openAgreement?.status === 'sent'
        ? 'The usage agreement is with the creator. Its view and acceptance status will update here.'
        : 'Send the approved usage agreement tied to these commercial terms.',
      tab: 'agreements', waiting: openAgreement?.status === 'sent', recommended_stage: 'interested',
    };
  } else if (!briefs.length) {
    nextAction = {
      key: 'build_brief', label: 'Build creator brief',
      description: 'Generate a product-grounded concept and script from this creator’s actual strengths.',
      tab: 'briefs', recommended_stage: 'briefing',
    };
  } else if (!productSeeded && !shippingReady) {
    nextAction = {
      key: 'add_shipping', label: 'Add shipping address',
      description: 'A complete shipping address is required before the creator product can be ordered.',
      tab: 'profile', blocker: true, recommended_stage: 'briefing',
    };
  } else if (!productSeeded) {
    nextAction = {
      key: 'seed_product', label: 'Seed the creator product',
      description: 'Order the briefed product through Shopify before sending the creator into production.',
      tab: 'products', recommended_stage: 'briefing',
    };
  } else if (!deliverables.length && !activeSubmission) {
    nextAction = {
      key: 'send_assignment', label: 'Send creator assignment',
      description: 'Send the brief and a secure footage upload link to the creator.',
      tab: 'briefs', recommended_stage: 'briefing',
    };
  } else if (overdueDeliverable) {
    nextAction = {
      key: 'production_overdue', label: 'Resolve overdue deliverable',
      description: `${overdueDeliverable.title} was due ${new Date(overdueDeliverable.due_at).toLocaleDateString('en-US')}.`,
      tab: 'deliverables', urgent: true, recommended_stage: 'producing',
    };
  } else if (!received) {
    nextAction = {
      key: 'await_footage', label: 'Await creator footage',
      description: activeSubmission
        ? `The upload link is active until ${new Date(activeSubmission.expires_at).toLocaleDateString('en-US')}.`
        : 'A deliverable is requested, but no footage has been received yet.',
      tab: 'deliverables', waiting: true, recommended_stage: 'producing',
    };
  } else if (!completed) {
    nextAction = {
      key: 'finish_edit', label: 'Edit and approve footage',
      description: 'Footage is in. Move it through editing, approval, and completion.',
      tab: 'deliverables', recommended_stage: 'producing',
    };
  } else if (!launched) {
    nextAction = {
      key: 'launch_asset', label: 'Ready for launch',
      description: 'Approved creative is complete and ready to move into the ad launcher.',
      tab: 'deliverables', recommended_stage: 'active',
    };
  } else {
    nextAction = {
      key: 'review_performance', label: 'Review creator performance',
      description: 'Use attributed spend and revenue to shape the next brief.',
      tab: 'performance', recommended_stage: 'active',
    };
  }

  const activeIndex = Math.min(
    milestones.findIndex(item => !item.complete),
    milestones.length - 1,
  );
  return {
    next_action: nextAction,
    milestones: milestones.map((item, index) => ({
      ...item,
      status: item.complete ? 'complete' : index === activeIndex ? 'active' : 'pending',
    })),
  };
}

async function getWorkflow(sql, creatorId) {
  const [creatorRows, outreach, engagements, agreements, briefs, seeds, deliverables, submissionLinks, productionSummary] = await Promise.all([
    sql`
      SELECT c.id, c.email, c.stage, c.product_seeding_required,
        c.shipping_address1, c.shipping_city, c.shipping_region,
        c.shipping_postal_code, c.shipping_country_code,
        (SELECT count(*)::int FROM launch_history l WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)) AS launch_count
      FROM creators c
      WHERE c.id = ${creatorId}
    `,
    sql`
      SELECT * FROM creator_outreach
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_engagements
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT id, creator_id, engagement_id, template_id, template_version, title, version, status, expires_at,
        sent_to, sent_at, viewed_at, accepted_name, accepted_email, accepted_at,
        revoked_at, created_at, updated_at
      FROM creator_agreements
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_briefs
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT id, status, product_title, requested_at, ordered_at, delivered_at
      FROM creator_product_seeds
      WHERE creator_id = ${creatorId}
      ORDER BY requested_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_deliverables
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT id, creator_id, brief_id, title, due_at,
        CASE WHEN status = 'active' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
        upload_count,
        expires_at, last_used_at, created_at
      FROM creator_submission_links
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT
        COALESCE(sum(expected_asset_count), 0)::int AS expected,
        COALESCE(sum(received_asset_count), 0)::int AS received,
        COALESCE(sum(approved_asset_count), 0)::int AS approved,
        COALESCE(sum(completed_asset_count), 0)::int AS completed,
        COALESCE(sum(shipped_asset_count), 0)::int AS shipped,
        COALESCE(sum(expected_asset_count) FILTER (
          WHERE due_at >= date_trunc('month', now())
            AND due_at < date_trunc('month', now()) + interval '1 month'
        ), 0)::int AS due_this_month,
        COALESCE(sum(GREATEST(expected_asset_count - completed_asset_count, 0)) FILTER (
          WHERE due_at < now() AND status NOT IN ('launched', 'complete', 'cancelled')
        ), 0)::int AS overdue,
        count(*) FILTER (
          WHERE due_at >= date_trunc('month', now())
            AND due_at < date_trunc('month', now()) + interval '1 month'
        )::int AS deliverables_this_month
      FROM creator_deliverables
      WHERE creator_id = ${creatorId}
    `,
  ]);
  const creator = creatorRows[0];
  const guidance = creator
    ? buildWorkflowGuidance({ creator, outreach, engagements, agreements, briefs, seeds, deliverables, submissionLinks })
    : { next_action: null, milestones: [] };
  return {
    outreach, engagements, agreements, briefs, seeds, deliverables,
    submission_links: submissionLinks,
    production_summary: productionSummary[0] || {},
    guidance,
  };
}

async function generateBrief(sql, creatorId, input) {
  const guidelines = await loadBrandGuidelines(sql);
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((SELECT json_agg(s) FROM creator_social_accounts s WHERE s.creator_id = c.id), '[]'::json) AS social_accounts,
      COALESCE((SELECT json_agg(a) FROM (
        SELECT kind, summary, created_at FROM creator_activity
        WHERE creator_id = c.id ORDER BY created_at DESC LIMIT 15
      ) a), '[]'::json) AS recent_activity,
      COALESCE((SELECT json_agg(l) FROM (
        SELECT
          lh.ad_id, lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at,
          COALESCE(sum(i.spend), 0) AS spend,
          COALESCE(sum(i.purchase_value), 0) AS revenue,
          COALESCE(sum(i.purchases), 0) AS purchases,
          max(ca.hook_text_verbatim) AS hook,
          max(ca.hook_type) AS hook_type,
          max(ca.format) AS format,
          max(ca.why_it_worked) AS why_it_worked
        FROM launch_history lh
        LEFT JOIN creative_insights_daily i ON i.ad_id = lh.ad_id
          AND i.date >= current_date - interval '180 days'
        LEFT JOIN creative_performance cp ON cp.ad_id = lh.ad_id
        LEFT JOIN creative_analysis ca ON ca.group_key = cp.group_key
        WHERE lh.creator_id = c.id OR lower(lh.creator) = lower(c.name)
        GROUP BY lh.ad_id, lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at
        ORDER BY COALESCE(sum(i.purchase_value), 0) DESC, lh.launched_at DESC
        LIMIT 15
      ) l), '[]'::json) AS past_launches
    FROM creators c WHERE c.id = ${creatorId}
  `;
  if (!creator) throw new Error('Creator not found');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const system = `You are the creator strategist for HOWL Campfires. Write practical, filmable UGC briefs and scripts.
Use the creator's real activities, audience, and history. Do not invent personal facts. Keep the concept direct and product-grounded.
Treat the supplied brand guidelines as hard constraints. Never use prohibited language, unsupported claims, or missing required disclosures.
Return only valid JSON with: title, objective, angle, brief, script, deliverables (array of strings).`;
  const prompt = `CREATOR
${JSON.stringify(creator, null, 2)}

BRAND GUIDELINES
${guidelineText(guidelines) || 'No additional guidelines saved.'}

REQUEST
Product: ${clean(input.product, 200) || 'Choose the strongest HOWL product fit'}
Objective: ${clean(input.objective, 1000) || 'Create a direct-response paid social asset'}
Angle: ${clean(input.angle, 500) || 'Choose an authentic angle based on this creator'}
Additional direction: ${clean(input.direction, 3000) || 'None'}
Strategy mode: ${input.strategy_mode === 'net_new' ? 'NET NEW - build a fresh concept from the creator profile and activities' : 'PAST PERFORMERS - preserve proven patterns when useful, without copying'}

The brief must explain the premise, filming environment, hook, proof, product moments, CTA, and exact deliverables.
The script should sound natural for this creator and be usable as a shot-by-shot production guide.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      temperature: 0.5,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Brief generation failed');
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  assertBriefBrandSafe(parsed, guidelines);
  return parsed;
}

async function generateConceptSet(sql, creatorId, input) {
  const guidelines = await loadBrandGuidelines(sql);
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((SELECT json_agg(s) FROM creator_social_accounts s WHERE s.creator_id = c.id), '[]'::json) AS social_accounts,
      COALESCE((SELECT json_agg(l) FROM (
        SELECT
          lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at,
          COALESCE(sum(i.spend), 0) AS spend,
          COALESCE(sum(i.purchase_value), 0) AS revenue,
          max(ca.hook_text_verbatim) AS hook,
          max(ca.format) AS format,
          max(ca.why_it_worked) AS why_it_worked
        FROM launch_history lh
        LEFT JOIN creative_insights_daily i ON i.ad_id = lh.ad_id
          AND i.date >= current_date - interval '180 days'
        LEFT JOIN creative_performance cp ON cp.ad_id = lh.ad_id
        LEFT JOIN creative_analysis ca ON ca.group_key = cp.group_key
        WHERE lh.creator_id = c.id OR lower(lh.creator) = lower(c.name)
        GROUP BY lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at
        ORDER BY COALESCE(sum(i.purchase_value), 0) DESC
        LIMIT 12
      ) l), '[]'::json) AS past_launches
    FROM creators c WHERE c.id = ${creatorId}
  `;
  if (!creator) throw new Error('Creator not found');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const count = Math.max(1, Math.min(Number(input.count) || 4, 8));
  const product = input.product_context || { title: clean(input.product, 300) };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 10000,
      temperature: 0.65,
      system: `You are HOWL Campfires' senior creator strategist. Build distinct, filmable direct-response UGC concepts grounded in the creator's real niche, strengths, audience demographics, audience psychographics, activities, social metrics, and performance history. Never invent personal facts or product claims. Treat the supplied brand guidelines as hard constraints. Return only a valid JSON array.`,
      messages: [{
        role: 'user',
        content: `Create exactly ${count} net-new UGC video concepts for this creator.

CREATOR
${JSON.stringify(creator, null, 2)}

BRAND GUIDELINES
${guidelineText(guidelines) || 'No additional guidelines saved.'}

SHOPIFY PRODUCT
${JSON.stringify(product, null, 2)}

ANGLE DIRECTION
${clean(input.angle, 2000) || 'Choose distinct angles that fit the product and creator.'}

OBJECTIVE
${clean(input.objective, 2000) || 'Acquire new customers efficiently with credible product proof.'}

ADDITIONAL DIRECTION
${clean(input.direction, 4000) || 'None.'}

Each concept must fit this creator specifically, use a distinct persuasion mechanism, show what happens in the first three seconds, contain filmable proof, and provide a natural spoken script.
Return an array where each item has exactly:
{
  "concept_name": "short title",
  "product": "product title",
  "objective": "business objective",
  "angle": "specific angle",
  "format": "ugc-demo | comparison | problem-solution | customer-story | day-in-the-life | myth-bust",
  "creator_fit": "why this fits this creator and audience",
  "hypothesis": "falsifiable test hypothesis",
  "opening_visual": "frame 0-3 seconds",
  "hook": "spoken opening",
  "proof_sequence": ["beat 1", "beat 2", "beat 3"],
  "brief": "production-ready creative brief with premise, environment, product moments, proof, CTA, and guardrails",
  "script": "complete natural 20-45 second spoken script",
  "shot_list": ["shot 1", "shot 2", "shot 3", "shot 4"],
  "deliverables": ["deliverable 1"],
  "cta": "specific CTA"
}`,
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Concept generation failed');
  const raw = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Concept response was not a JSON array');
  const concepts = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(concepts)) throw new Error('Concept response was not an array');
  const selected = concepts.slice(0, count);
  selected.forEach(concept => assertBriefBrandSafe({
    title: concept.concept_name,
    objective: concept.objective,
    angle: concept.angle,
    brief: concept.brief,
    script: concept.script,
    deliverables: concept.deliverables,
  }, guidelines));
  return selected;
}

async function generateOutreach(sql, creatorId, input) {
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((SELECT json_agg(s) FROM creator_social_accounts s WHERE s.creator_id = c.id), '[]'::json) AS social_accounts,
      COALESCE((SELECT json_agg(b) FROM (
        SELECT title, product, objective, angle, status
        FROM creator_briefs WHERE creator_id = c.id
        ORDER BY created_at DESC LIMIT 5
      ) b), '[]'::json) AS recent_briefs
    FROM creators c WHERE c.id = ${creatorId}
  `;
  if (!creator) throw new Error('Creator not found');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      temperature: 0.6,
      system: `Write concise creator outreach for HOWL Campfires. Be specific, human, and direct. Never invent personal facts. Return only JSON with subject and body.`,
      messages: [{
        role: 'user',
        content: `Creator context:\n${JSON.stringify(creator, null, 2)}\n\nPurpose: ${clean(input.purpose, 1000) || 'Introduce HOWL and explore a paid creator partnership'}\nTone: ${clean(input.tone, 100) || 'warm and direct'}\nInclude a clear, low-friction next step.`,
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Outreach generation failed');
  const raw = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

export default async function handler(req, res) {
  const body = req.body || {};
  const permission = req.method === 'GET'
    ? 'briefs.read'
    : ((body.action === 'deliverable'
      || body.action === 'ingest_footage'
      || body.action === 'create_submission_link'
      || body.action === 'revoke_submission_link'
      || body.resource === 'deliverable')
      ? 'assets.write'
      : 'briefs.write');
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.query?.creator_id || req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id required' });

    if (req.method === 'GET') return res.json(await getWorkflow(sql, creatorId));

    if (req.method === 'POST') {
      if (body.action === 'generate_brief') {
        const generated = await generateBrief(sql, creatorId, body);
        const [brief] = await sql`
          INSERT INTO creator_briefs (
            creator_id, title, product, objective, angle, deliverables,
            brief, script, status, generation_source, created_by
          ) VALUES (
            ${creatorId}, ${clean(generated.title, 300) || 'Creator brief'}, ${clean(body.product, 200)},
            ${clean(generated.objective, 2000)}, ${clean(generated.angle, 1000)},
            ${JSON.stringify(Array.isArray(generated.deliverables) ? generated.deliverables : [])}::jsonb,
            ${clean(generated.brief)}, ${clean(generated.script)}, 'draft', 'ai_creator_context', ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (${creatorId}, 'brief_created', ${`Brief created: ${brief.title}`}, ${JSON.stringify({ brief_id: brief.id })}::jsonb, ${access.userId})
        `;
        return res.status(201).json({ brief, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'generate_concepts') {
        const concepts = await generateConceptSet(sql, creatorId, body);
        const briefs = [];
        for (const concept of concepts) {
          const [brief] = await sql`
            INSERT INTO creator_briefs (
              creator_id, title, product, objective, angle, deliverables,
              brief, script, status, generation_source, created_by
            ) VALUES (
              ${creatorId}, ${clean(concept.concept_name, 300) || 'Creator concept'},
              ${clean(concept.product, 300) || clean(body.product, 300)},
              ${clean(concept.objective, 2000) || clean(body.objective, 2000)},
              ${clean(concept.angle, 1000)},
              ${JSON.stringify(Array.isArray(concept.deliverables) ? concept.deliverables : [])}::jsonb,
              ${clean(concept.brief)}, ${clean(concept.script)}, 'draft',
              'ai_net_new_creator_concept', ${access.userId}
            )
            RETURNING *
          `;
          briefs.push(brief);
        }
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'concepts_created', ${`${briefs.length} net-new creator concepts generated`},
            ${JSON.stringify({ brief_ids: briefs.map(brief => Number(brief.id)), product: clean(body.product, 300) })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({ concepts, briefs, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'generate_outreach') {
        const generated = await generateOutreach(sql, creatorId, body);
        const [message] = await sql`
          INSERT INTO creator_outreach (
            creator_id, channel, direction, subject, body, status, created_by
          ) VALUES (
            ${creatorId}, 'email', 'outbound', ${clean(generated.subject, 500)},
            ${clean(generated.body)}, 'draft', ${access.userId}
          )
          RETURNING *
        `;
        return res.status(201).json({ message, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'outreach') {
        const messageBody = clean(body.body);
        if (!messageBody) return res.status(400).json({ error: 'Message body required' });
        const followUpAt = timestamp(body.next_follow_up_at);
        if (followUpAt === undefined) return res.status(400).json({ error: 'Follow-up date is invalid' });
        const [message] = await sql`
          INSERT INTO creator_outreach (
            creator_id, channel, direction, subject, body, status, sent_at,
            next_follow_up_at, recipient, created_by
          ) VALUES (
            ${creatorId}, ${clean(body.channel, 30) || 'email'}, 'outbound',
            ${clean(body.subject, 500)}, ${messageBody}, ${body.status === 'sent' ? 'sent' : 'draft'},
            ${body.status === 'sent' ? new Date().toISOString() : null},
            ${body.status === 'sent' ? followUpAt : null}, ${clean(body.recipient, 500)}, ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'outreach', ${body.status === 'sent' ? 'Outreach marked sent' : 'Outreach draft created'},
            ${JSON.stringify({ outreach_id: message.id, channel: message.channel })}::jsonb, ${access.userId}
          )
        `;
        return res.status(201).json({ message, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'engagement') {
        const engagementType = body.engagement_type === 'retainer' ? 'retainer' : 'one_off';
        const status = ['draft', 'approved', 'active', 'completed', 'cancelled'].includes(body.status)
          ? body.status
          : 'draft';
        const date = value => {
          if (!value) return null;
          return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
        };
        const approvalDate = date(body.approval_date);
        const startsOn = date(body.starts_on);
        const endsOn = date(body.ends_on);
        if ([approvalDate, startsOn, endsOn].includes(undefined)) {
          return res.status(400).json({ error: 'Engagement dates must use YYYY-MM-DD' });
        }
        const assetCommitment = body.asset_commitment === '' || body.asset_commitment == null
          ? null
          : Math.max(0, Math.min(Number(body.asset_commitment) || 0, 10000));
        const commitmentPeriod = body.commitment_period === 'monthly' ? 'monthly' : 'total';
        const feeAmount = body.fee_amount === '' || body.fee_amount == null
          ? null
          : Math.max(0, Number(body.fee_amount) || 0);
        const rate = value => value === '' || value == null ? null : Math.max(0, Number(value) || 0);
        const usageTermMonths = body.usage_term_months === '' || body.usage_term_months == null
          ? null
          : Math.max(0, Math.min(Number(body.usage_term_months) || 0, 1200));
        const [engagement] = await sql`
          INSERT INTO creator_engagements (
            creator_id, engagement_type, status, approval_date, starts_on, ends_on,
            asset_commitment, commitment_period, cadence, fee_amount, fee_currency, usage_term_months,
            ugc_video_rate, raw_footage_rate, hook_rate, photo_rate, whitelisting_monthly_rate,
            paid_media_included, raw_footage_included, exclusivity_notes,
            payment_terms, notes, created_by
          ) VALUES (
            ${creatorId}, ${engagementType}, ${status}, ${approvalDate}, ${startsOn}, ${endsOn},
            ${assetCommitment}, ${commitmentPeriod}, ${clean(body.cadence, 100)}, ${feeAmount},
            ${clean(body.fee_currency, 10) || 'USD'}, ${usageTermMonths},
            ${rate(body.ugc_video_rate)}, ${rate(body.raw_footage_rate)}, ${rate(body.hook_rate)},
            ${rate(body.photo_rate)}, ${rate(body.whitelisting_monthly_rate)},
            ${body.paid_media_included !== false}, ${body.raw_footage_included === true},
            ${clean(body.exclusivity_notes, 3000)}, ${clean(body.payment_terms, 1000)},
            ${clean(body.notes, 5000)}, ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'engagement_created',
            ${`${engagementType === 'retainer' ? 'Retainer' : 'One-off'} engagement created`},
            ${JSON.stringify({ engagement_id: Number(engagement.id), engagement_type: engagementType })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({ engagement, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'create_agreement') {
        const engagementId = Number(body.engagement_id);
        const templateId = Number(body.template_id) || null;
        if (!engagementId) return res.status(400).json({ error: 'Engagement is required' });
        const [engagement] = await sql`
          SELECT * FROM creator_engagements
          WHERE id = ${engagementId} AND creator_id = ${creatorId}
        `;
        if (!engagement) return res.status(400).json({ error: 'Engagement does not belong to this creator' });
        const [creator] = await sql`SELECT id, name, email FROM creators WHERE id = ${creatorId}`;
        let title = clean(body.title, 300);
        let agreementBody = clean(body.agreement_body, 50000);
        let templateVersion = null;
        if (templateId) {
          const [template] = await sql`
            SELECT id, title, agreement_body, version
            FROM creator_agreement_templates
            WHERE id = ${templateId} AND status = 'active'
          `;
          if (!template) return res.status(400).json({ error: 'Approved agreement template not found' });
          const rendered = renderAgreementTemplate(template, creator, engagement);
          title = clean(rendered.title, 300);
          agreementBody = clean(rendered.agreement_body, 50000);
          templateVersion = template.version;
        }
        if (!title || !agreementBody) {
          return res.status(400).json({ error: 'Agreement title and approved agreement text are required' });
        }
        const expiresInDays = Math.min(Math.max(Number(body.expires_in_days) || 14, 1), 60);
        const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
        const token = randomBytes(32).toString('base64url');
        const [versionRow] = await sql`
          SELECT COALESCE(max(version), 0)::int + 1 AS version
          FROM creator_agreements
          WHERE creator_id = ${creatorId}
        `;
        const [agreement] = await sql`
          INSERT INTO creator_agreements (
            creator_id, engagement_id, template_id, template_version, title, agreement_body, version, status,
            token_hash, expires_at, created_by
          ) VALUES (
            ${creatorId}, ${engagementId}, ${templateId}, ${templateVersion}, ${title}, ${agreementBody}, ${versionRow.version},
            'draft', ${agreementTokenHash(token)}, ${expiresAt}, ${access.userId}
          )
          RETURNING id, creator_id, engagement_id, template_id, template_version, title, version, status, expires_at, created_at
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'agreement_created', ${`Agreement prepared: ${title}`},
            ${JSON.stringify({ agreement_id: Number(agreement.id), engagement_id: engagementId, version: versionRow.version })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({
          agreement,
          agreement_path: `/agreement?token=${encodeURIComponent(token)}`,
          workflow: await getWorkflow(sql, creatorId),
        });
      }

      if (body.action === 'revoke_agreement') {
        const agreementId = Number(body.id);
        if (!agreementId) return res.status(400).json({ error: 'Agreement id required' });
        const [agreement] = await sql`
          UPDATE creator_agreements
          SET status = 'revoked', revoked_at = now(), updated_at = now()
          WHERE id = ${agreementId} AND creator_id = ${creatorId}
            AND status IN ('draft', 'sent')
          RETURNING id, title
        `;
        if (!agreement) return res.status(404).json({ error: 'Revocable agreement not found' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'agreement_revoked', ${`Agreement revoked: ${agreement.title}`},
            ${JSON.stringify({ agreement_id: agreementId })}::jsonb, ${access.userId}
          )
        `;
        return res.json({ ok: true, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'deliverable') {
        const title = clean(body.title, 300);
        if (!title) return res.status(400).json({ error: 'Deliverable title required' });
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Deliverable due date is invalid' });
        const engagementId = Number(body.engagement_id) || null;
        if (engagementId) {
          const [engagement] = await sql`
            SELECT id FROM creator_engagements
            WHERE id = ${engagementId} AND creator_id = ${creatorId}
          `;
          if (!engagement) return res.status(400).json({ error: 'Selected engagement does not belong to this creator' });
        }
        const expectedAssetCount = Math.max(1, Math.min(Number(body.expected_asset_count) || 1, 10000));
        const [deliverable] = await sql`
          INSERT INTO creator_deliverables (
            creator_id, brief_id, engagement_id, title, status, expected_asset_count,
            source_url, drive_file_id, ugc_session_id, due_at, created_by
          ) VALUES (
            ${creatorId}, ${Number(body.brief_id) || null}, ${engagementId}, ${title},
            ${clean(body.status, 50) || 'requested'}, ${expectedAssetCount},
            ${clean(body.source_url, 3000)}, ${clean(body.drive_file_id, 300)},
            ${Number(body.ugc_session_id) || null}, ${dueAt}, ${access.userId}
          )
          RETURNING *
        `;
        if (deliverable.ugc_session_id) {
          await sql`
            UPDATE ugc_sessions
            SET creator_id = ${creatorId}, brief_id = ${deliverable.brief_id || null},
                deliverable_id = ${deliverable.id}, updated_at = now()
            WHERE id = ${deliverable.ugc_session_id}
          `;
        }
        return res.status(201).json({ deliverable, workflow: await getWorkflow(sql, creatorId) });
      }
      if (body.action === 'ingest_footage') {
        const title = clean(body.title, 300);
        const videoUrl = clean(body.video_url, 3000);
        if (!title || !videoUrl) return res.status(400).json({ error: 'Footage title and video_url required' });
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Footage due date is invalid' });
        let parsedUrl;
        try {
          parsedUrl = new URL(videoUrl);
        } catch {
          return res.status(400).json({ error: 'Footage URL is invalid' });
        }
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')) {
          return res.status(400).json({ error: 'Footage must be stored in HOWL Vercel Blob' });
        }
        const briefId = Number(body.brief_id) || null;
        if (briefId) {
          const [brief] = await sql`
            SELECT id FROM creator_briefs
            WHERE id = ${briefId} AND creator_id = ${creatorId}
          `;
          if (!brief) {
            await del(parsedUrl.toString()).catch(() => {});
            return res.status(400).json({ error: 'Selected brief does not belong to this creator' });
          }
        }
        const [ids] = await sql`
          SELECT
            nextval(pg_get_serial_sequence('ugc_sessions', 'id')) AS session_id,
            nextval(pg_get_serial_sequence('creator_deliverables', 'id')) AS deliverable_id
        `;
        const sessionId = Number(ids.session_id);
        const deliverableId = Number(ids.deliverable_id);
        try {
          await sql.transaction(transaction => [
            transaction`
              INSERT INTO ugc_sessions (
                id, user_id, title, file_name, file_size, video_url, settings, status,
                creator_id, brief_id, deliverable_id
              ) VALUES (
                ${sessionId}, ${access.userId}, ${title}, ${clean(body.file_name, 500)},
                ${Number(body.file_size) || null}, ${parsedUrl.toString()}, '{}'::jsonb, 'uploaded',
                ${creatorId}, ${briefId}, ${deliverableId}
              )
            `,
            transaction`
              INSERT INTO creator_deliverables (
                id, creator_id, brief_id, title, status, expected_asset_count,
                received_asset_count, source_url, ugc_session_id, due_at, received_at, created_by
              ) VALUES (
                ${deliverableId}, ${creatorId}, ${briefId}, ${title}, 'received', 1, 1,
                ${parsedUrl.toString()}, ${sessionId}, ${dueAt}, now(), ${access.userId}
              )
            `,
            transaction`
              INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
              VALUES (
                ${creatorId}, 'footage_received', ${`Footage received: ${title}`},
                ${JSON.stringify({ deliverable_id: deliverableId, ugc_session_id: sessionId, brief_id: briefId })}::jsonb,
                ${access.userId}
              )
            `,
          ]);
        } catch (err) {
          await del(parsedUrl.toString()).catch(() => {});
          throw err;
        }
        const [linked] = await sql`
          SELECT * FROM creator_deliverables
          WHERE id = ${deliverableId} AND creator_id = ${creatorId}
        `;
        return res.status(201).json({ deliverable: linked, workflow: await getWorkflow(sql, creatorId) });
      }
      if (body.action === 'create_submission_link') {
        const title = clean(body.title, 300);
        if (!title) return res.status(400).json({ error: 'Submission title required' });
        const briefId = Number(body.brief_id) || null;
        let existingDeliverable = null;
        if (briefId) {
          const [brief] = await sql`
            SELECT id, status FROM creator_briefs
            WHERE id = ${briefId} AND creator_id = ${creatorId}
          `;
          if (!brief) return res.status(400).json({ error: 'Selected brief does not belong to this creator' });
          if (brief.status !== 'approved') {
            return res.status(409).json({ error: 'Approve the brief before creating a creator upload link.' });
          }
          [existingDeliverable] = await sql`
            SELECT id FROM creator_deliverables
            WHERE creator_id = ${creatorId}
              AND brief_id = ${briefId}
              AND status NOT IN ('cancelled', 'launched')
            ORDER BY created_at DESC
            LIMIT 1
          `;
        }
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Submission due date is invalid' });
        const expiresInDays = Math.min(Math.max(Number(body.expires_in_days) || 14, 1), 60);
        const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
        const token = randomBytes(32).toString('base64url');
        let deliverable = existingDeliverable || null;
        if (briefId && !deliverable) {
          [deliverable] = await sql`
            INSERT INTO creator_deliverables (
              creator_id, brief_id, title, status, expected_asset_count, due_at, created_by
            ) VALUES (
              ${creatorId}, ${briefId}, ${title}, 'requested', 1, ${dueAt}, ${access.userId}
            )
            RETURNING id
          `;
        }
        const [link] = await sql`
          INSERT INTO creator_submission_links (
            token_hash, creator_id, brief_id, title, due_at, expires_at, created_by
          ) VALUES (
            ${submissionTokenHash(token)}, ${creatorId}, ${briefId}, ${title},
            ${dueAt}, ${expiresAt}, ${access.userId}
          )
          RETURNING id, creator_id, brief_id, title, due_at, status, upload_count,
            expires_at, last_used_at, created_at
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'submission_link_created', ${`Upload link created: ${title}`},
            ${JSON.stringify({
              submission_link_id: Number(link.id),
              brief_id: briefId,
              deliverable_id: deliverable?.id ? Number(deliverable.id) : null,
              expires_at: expiresAt,
            })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({
          link,
          submission_path: `/submit?token=${encodeURIComponent(token)}`,
          workflow: await getWorkflow(sql, creatorId),
        });
      }
      if (body.action === 'revoke_submission_link') {
        const linkId = Number(body.id);
        if (!linkId) return res.status(400).json({ error: 'Submission link id required' });
        const [link] = await sql`
          UPDATE creator_submission_links
          SET status = 'revoked', updated_at = now()
          WHERE id = ${linkId} AND creator_id = ${creatorId} AND status = 'active'
          RETURNING id, title
        `;
        if (!link) return res.status(404).json({ error: 'Active submission link not found' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'submission_link_revoked', ${`Upload link revoked: ${link.title}`},
            ${JSON.stringify({ submission_link_id: link.id })}::jsonb, ${access.userId}
          )
        `;
        return res.json({ ok: true, workflow: await getWorkflow(sql, creatorId) });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method === 'PATCH') {
      if (body.resource === 'brief') {
        const status = clean(body.status, 50);
        if (status && !['draft', 'approved', 'sent', 'archived'].includes(status)) {
          return res.status(400).json({ error: 'Unsupported brief status' });
        }
        const [existingBrief] = await sql`
          SELECT * FROM creator_briefs
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
        `;
        if (!existingBrief) return res.status(404).json({ error: 'Brief not found' });
        const candidate = {
          title: clean(body.title, 300) || existingBrief.title,
          objective: clean(body.objective, 2000) || existingBrief.objective,
          angle: clean(body.angle, 1000) || existingBrief.angle,
          brief: clean(body.brief) || existingBrief.brief,
          script: clean(body.script) || existingBrief.script,
          deliverables: existingBrief.deliverables,
        };
        assertBriefBrandSafe(candidate, await loadBrandGuidelines(sql));
        const [brief] = await sql`
          UPDATE creator_briefs SET
            title = COALESCE(${clean(body.title, 300)}, title),
            brief = COALESCE(${clean(body.brief)}, brief),
            script = COALESCE(${clean(body.script)}, script),
            status = COALESCE(${status}, status),
            updated_at = now()
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
          RETURNING *
        `;
        if (brief && status === 'approved') {
          await sql`
            INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
            VALUES (
              ${creatorId}, 'brief_approved', ${`Brief approved: ${brief.title}`},
              ${JSON.stringify({ brief_id: brief.id })}::jsonb, ${access.userId}
            )
          `;
        }
        return brief ? res.json({ brief }) : res.status(404).json({ error: 'Brief not found' });
      }
      if (body.resource === 'outreach') {
        const status = ['draft', 'sent', 'follow_up', 'replied', 'closed'].includes(body.status)
          ? body.status
          : null;
        const outcome = ['interested', 'not_interested', 'no_response', 'contracted'].includes(body.outcome)
          ? body.outcome
          : null;
        const followUpAt = body.next_follow_up_at === null ? null : timestamp(body.next_follow_up_at);
        if (followUpAt === undefined) return res.status(400).json({ error: 'Follow-up date is invalid' });
        const [message] = await sql`
          UPDATE creator_outreach SET
            status = COALESCE(${status}, status),
            outcome = CASE
              WHEN ${body.outcome === null} THEN NULL
              ELSE COALESCE(${outcome}, outcome)
            END,
            next_follow_up_at = CASE
              WHEN ${body.next_follow_up_at === null} THEN NULL
              ELSE COALESCE(${followUpAt}, next_follow_up_at)
            END,
            replied_at = CASE
              WHEN ${status} = 'replied' THEN COALESCE(replied_at, now())
              ELSE replied_at
            END,
            updated_at = now()
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
          RETURNING *
        `;
        if (!message) return res.status(404).json({ error: 'Outreach not found' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'outreach_updated', 'Outreach next action updated',
            ${JSON.stringify({ outreach_id: Number(body.id), status, outcome, next_follow_up_at: followUpAt })}::jsonb,
            ${access.userId}
          )
        `;
        return res.json({ message, workflow: await getWorkflow(sql, creatorId) });
      }
      if (body.resource === 'deliverable') {
        const status = clean(body.status, 50);
        const count = value => value === undefined
          ? null
          : Math.max(0, Math.min(Number(value) || 0, 10000));
        const [deliverable] = await sql`
          UPDATE creator_deliverables SET
            status = COALESCE(${status}, status),
            source_url = COALESCE(${clean(body.source_url, 3000)}, source_url),
            ugc_session_id = COALESCE(${Number(body.ugc_session_id) || null}, ugc_session_id),
            creative_asset_id = COALESCE(${Number(body.creative_asset_id) || null}, creative_asset_id),
            expected_asset_count = COALESCE(${count(body.expected_asset_count)}, expected_asset_count),
            received_asset_count = CASE
              WHEN ${status} IN ('received', 'editing', 'edited', 'approved', 'complete', 'launched')
                THEN GREATEST(COALESCE(${count(body.received_asset_count)}, received_asset_count), 1)
              ELSE COALESCE(${count(body.received_asset_count)}, received_asset_count)
            END,
            approved_asset_count = CASE
              WHEN ${status} IN ('approved', 'complete', 'launched')
                THEN GREATEST(COALESCE(${count(body.approved_asset_count)}, approved_asset_count), expected_asset_count)
              ELSE COALESCE(${count(body.approved_asset_count)}, approved_asset_count)
            END,
            completed_asset_count = CASE
              WHEN ${status} IN ('complete', 'launched')
                THEN GREATEST(COALESCE(${count(body.completed_asset_count)}, completed_asset_count), expected_asset_count)
              ELSE COALESCE(${count(body.completed_asset_count)}, completed_asset_count)
            END,
            shipped_asset_count = CASE
              WHEN ${status} = 'launched'
                THEN GREATEST(COALESCE(${count(body.shipped_asset_count)}, shipped_asset_count), expected_asset_count)
              ELSE COALESCE(${count(body.shipped_asset_count)}, shipped_asset_count)
            END,
            received_at = CASE WHEN ${status} IN ('received', 'editing', 'edited', 'approved', 'complete', 'launched') THEN COALESCE(received_at, now()) ELSE received_at END,
            approved_at = CASE WHEN ${status} IN ('approved', 'complete', 'launched') THEN COALESCE(approved_at, now()) ELSE approved_at END,
            completed_at = CASE WHEN ${status} IN ('complete', 'edited', 'launched') THEN COALESCE(completed_at, now()) ELSE completed_at END,
            shipped_at = CASE WHEN ${status} = 'launched' THEN COALESCE(shipped_at, now()) ELSE shipped_at END,
            updated_at = now()
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
          RETURNING *
        `;
        return deliverable ? res.json({ deliverable }) : res.status(404).json({ error: 'Deliverable not found' });
      }
      return res.status(400).json({ error: 'Unknown resource' });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
