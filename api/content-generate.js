import { requirePermission } from './_lib/app-access.js';
import { loadBrandGuidelines, validateBrandCopy } from './_lib/brand-guardrails.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import {
  cleanText,
  ensureContentStudioTables,
  markdownToHtml,
  parseModelJson,
  selectedSourceIds,
} from './_lib/content-studio.js';

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1';

const SEO_AEO_PLAYBOOK = `
HOWL SEO/AEO PLAYBOOK
Principles:
- People-first before search-first. The article must help a real buyer make a better decision, not chase word count or keyword stuffing.
- Answer-first structure. Each major question section should open with a concise direct answer in 1-3 sentences, then expand with nuance, examples, and HOWL-specific guidance.
- Intent match. Identify whether the topic is informational, comparison, commercial investigation, or post-purchase support, then structure the article around that job.
- Search and AI surfaces. Make key answers easy to extract: short answer blocks, descriptive H2s, scannable lists, comparison tables in Markdown, and clear definitions.
- E-E-A-T. Show practical product/category knowledge, first-hand-style experience, limitations, safety caveats, and verifiable claims. Do not invent specs, test data, certifications, prices, discounts, or testimonials.
- Entity coverage. Include relevant product/category entities, adjacent concepts, fuel type, safety, setup, portability, weather, maintenance, and decision criteria where they fit the topic.
- Internal linking. Include placeholders like [internal link: R4 MKII product page], [internal link: propane fire pit comparison], or [internal link: safety guide] where a real HOWL link should go.
- Schema readiness. Suggest Article schema for all posts, FAQPage when visible FAQs are present, HowTo only for actual step-by-step instructions, and Product only when the page visibly discusses a specific product with supported product data.
- Snippet readiness. Include a direct answer near the top, concise definitions, FAQ answers under 60 words where possible, and no vague filler intros.

Required article package:
- SEO title/title tag option, meta description, slug, H1.
- A 40-70 word intro that states the answer or decision frame quickly.
- H2s phrased around real questions or decision criteria.
- At least 3 snippet-ready answer blocks labeled "Short answer:" or naturally written as the first paragraph under a heading.
- FAQ section with 3-6 questions if the topic has question intent.
- Proof gaps and claim cautions when verified data is missing.
- Structured data suggestions with a one-line reason for each.
- SEO/AEO checklist with pass/fail style notes.
`;

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'briefs.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !openaiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY or OPENAI_API_KEY required' });

  const { sql } = access;
  await ensureCreatorOpsTables(sql);
  await ensureContentStudioTables(sql);

  try {
    const action = cleanText(req.body?.action || 'outline', 40);
    if (!['outline', 'draft', 'rewrite', 'faq', 'metadata', 'export'].includes(action)) {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const project = await loadProject(sql, req.body);
    if (!project) return res.status(400).json({ error: 'project or brief payload required' });
    const sourceIds = selectedSourceIds(req.body?.selectedSourceIds || req.body?.selected_source_ids || project.selected_source_ids);
    const sources = await loadSourceContext(sql, sourceIds, project);
    const feedback = await loadFeedbackContext(sql, project.id);
    const guidelines = await loadBrandGuidelines(sql);
    const model = ALLOWED_MODELS.has(req.body?.model) ? req.body.model : DEFAULT_MODEL;

    if (action === 'export') {
      const markdown = cleanText(req.body?.bodyMarkdown || req.body?.body_markdown, 200000);
      const violations = validateBrandCopy(markdown, guidelines);
      return res.json({ markdown, html: markdownToHtml(markdown), guardrailViolations: violations, seoAeo: evaluateSeoAeo(markdown, {}, project) });
    }

    const outline = cleanText(req.body?.outline, 80000);
    const draft = cleanText(req.body?.draft, 200000);
    const system = buildSystemPrompt(guidelines);
    const user = buildUserPrompt({ action, project, sources, feedback, outline, draft });

    const generated = await generateContentText({ action, apiKey, openaiKey, model, system, user });
    if (!generated.ok) {
      return res.status(generated.status || 500).json({
        error: generated.error,
        detail: generated.detail,
      });
    }
    const text = generated.text;
    const parsed = parseModelJson(text);
    const markdown = cleanText(parsed.markdown || parsed.outline_markdown || parsed.draft_markdown || '', 200000);
    const guardrailViolations = validateBrandCopy(markdown, guidelines);
    const sourceInfluence = normalizeSourceInfluence(parsed.source_influence, sources);
    const seoAeo = evaluateSeoAeo(markdown, parsed, project);
    return res.json({
      action,
      model: generated.model,
      provider: generated.provider,
      fallback_reason: generated.fallbackReason || null,
      result: {
        ...parsed,
        markdown,
        html: markdown ? markdownToHtml(markdown) : '',
        source_influence: sourceInfluence,
        guardrail_violations: guardrailViolations,
        seo_aeo: seoAeo,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function normalizeSourceInfluence(value, sources) {
  if (Array.isArray(value) && value.length) return value;
  return (sources || []).slice(0, 8).map(source => ({
    source_id: source.id,
    source_title: source.title,
    used_for: 'voice reference',
  }));
}

function evaluateSeoAeo(markdown, parsed = {}, project = {}) {
  const text = cleanText(markdown, 200000);
  const lower = text.toLowerCase();
  const headings = text.match(/^#{1,3}\s+.+$/gm) || [];
  const h1Count = (text.match(/^#\s+.+$/gm) || []).length;
  const h2Count = (text.match(/^##\s+.+$/gm) || []).length;
  const wordCount = (text.match(/\b[\w'-]+\b/g) || []).length;
  const hasFaq = /\bfaq\b|frequently asked questions|\n##\s+.*questions?/i.test(text);
  const hasShortAnswers = /short answer:|quick answer:|the short version:/i.test(text);
  const hasInternalLinks = /\[internal link:/i.test(text);
  const hasMeta = Boolean(parsed.meta_description);
  const hasSchema = Array.isArray(parsed.schema_suggestions) && parsed.schema_suggestions.length > 0;
  const hasProofGaps = Array.isArray(parsed.proof_gaps) ? parsed.proof_gaps.length > 0 : /proof gap|claim caution|verify/i.test(text);
  const hasTitle = Boolean(parsed.title || parsed.title_options?.length || project.title);
  const hasQuestionHeading = headings.some(heading => /\?/.test(heading) || /\b(how|what|why|when|where|which|can|should|is|are|best|vs)\b/i.test(heading));
  const intro = text.replace(/^#\s+.+\n+/, '').trim().split(/\n{2,}/)[0] || '';
  const introWordCount = (intro.match(/\b[\w'-]+\b/g) || []).length;
  const hasComparison = /\|.+\|.+\||\bvs\.?\b|\bcompare|\bcomparison|\bpros and cons\b/i.test(text);
  const hasDecisionCriteria = /\bchoose|consider|best for|tradeoff|criteria|depends on|look for\b/i.test(lower);
  const hasUnsupportedRisk = /\bguaranteed|best ever|certified|approved by|100% safe|fireproof\b/i.test(lower);

  const checks = [
    ['title_meta', hasTitle && hasMeta, 'Title/meta package is present.'],
    ['single_h1', h1Count === 1, 'Exactly one H1.'],
    ['scannable_h2s', h2Count >= 4, 'At least four H2 sections for scan depth.'],
    ['answer_blocks', hasShortAnswers, 'Includes snippet-ready short answer blocks.'],
    ['question_headings', hasQuestionHeading, 'Headings map to questions or decision criteria.'],
    ['faq', hasFaq, 'Includes FAQ section when question intent is likely.'],
    ['internal_links', hasInternalLinks, 'Includes internal link placeholders.'],
    ['schema', hasSchema, 'Includes structured data suggestions.'],
    ['proof_gaps', hasProofGaps, 'Calls out proof gaps or claim cautions.'],
    ['decision_help', hasDecisionCriteria || hasComparison, 'Helps a buyer decide, compare, or choose.'],
    ['tight_intro', introWordCount > 0 && introWordCount <= 90, 'Intro gets to the point quickly.'],
    ['depth', wordCount >= 700, 'Draft has enough depth for a useful article.'],
    ['claim_safety', !hasUnsupportedRisk, 'Avoids risky unsupported absolute claims.'],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    word_count: wordCount,
    h1_count: h1Count,
    h2_count: h2Count,
    checks: checks.map(([id, ok, label]) => ({ id, ok, label })),
  };
}

async function generateContentText({ action, apiKey, openaiKey, model, system, user }) {
  const maxTokens = action === 'draft' ? 12000 : 6000;
  const temperature = action === 'draft' ? 0.45 : 0.35;
  if (apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const data = await response.json();
    if (response.ok) {
      return {
        ok: true,
        provider: 'anthropic',
        model,
        text: (data.content || []).filter(block => block.type === 'text').map(block => block.text).join(''),
      };
    }
    const error = anthropicErrorMessage(data) || `Anthropic request failed (${response.status})`;
    if (!openaiKey) return { ok: false, status: response.status, error, detail: data?.error || data };
    const fallback = await generateOpenAiContent({ action, apiKey: openaiKey, system, user, maxTokens, temperature });
    return {
      ...fallback,
      fallbackReason: error,
      detail: fallback.ok ? undefined : { anthropic: data?.error || data, openai: fallback.detail },
    };
  }
  return generateOpenAiContent({ action, apiKey: openaiKey, system, user, maxTokens, temperature });
}

async function generateOpenAiContent({ apiKey, system, user, maxTokens, temperature }) {
  if (!apiKey) return { ok: false, status: 500, error: 'OPENAI_API_KEY not configured' };
  const model = process.env.OPENAI_CONTENT_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = data?.error?.message || data?.error?.type || `OpenAI request failed (${response.status})`;
    return { ok: false, status: response.status, error, detail: data?.error || data, provider: 'openai', model };
  }
  return {
    ok: true,
    provider: 'openai',
    model,
    text: data?.choices?.[0]?.message?.content || '',
  };
}

function anthropicErrorMessage(data) {
  const error = data?.error || data;
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  if (typeof error.detail === 'string') return error.detail;
  if (typeof error.type === 'string') return error.type;
  try { return JSON.stringify(error); }
  catch { return String(error); }
}

async function loadProject(sql, body) {
  const projectId = Number(body?.projectId || body?.project_id);
  if (Number.isFinite(projectId)) {
    const [project] = await sql`SELECT * FROM content_projects WHERE id = ${projectId}`;
    return project || null;
  }
  const brief = body?.brief || body?.project;
  if (!brief) return null;
  return {
    id: null,
    title: cleanText(brief.title || brief.topic, 240),
    topic: cleanText(brief.topic, 500),
    target_query: cleanText(brief.target_query || brief.targetQuery, 300),
    audience: cleanText(brief.audience, 500),
    product: cleanText(brief.product, 240),
    search_intent: cleanText(brief.search_intent || brief.searchIntent, 240),
    desired_cta: cleanText(brief.desired_cta || brief.desiredCta, 500),
    must_include: cleanText(brief.must_include || brief.mustInclude, 3000),
    avoid: cleanText(brief.avoid, 3000),
    selected_source_ids: selectedSourceIds(brief.selectedSourceIds || brief.selected_source_ids),
  };
}

async function loadSourceContext(sql, ids, project) {
  let sourceRows = [];
  if (ids.length) {
    sourceRows = await sql`
      SELECT id, title, source_type, body, url, tags
      FROM content_sources
      WHERE id = ANY(${ids}::bigint[])
      ORDER BY array_position(${ids}::bigint[], id)
      LIMIT 30
    `;
  } else {
    sourceRows = await sql`
      SELECT id, title, source_type, body, url, tags
      FROM content_sources
      WHERE source_type IN ('email', 'blog', 'landing_page')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 60
    `;
  }
  return sourceRows.map(source => ({
    id: source.id,
    title: source.title,
    type: source.source_type,
    url: source.url,
    tags: source.tags || [],
    excerpt: cleanText(source.body, 4500),
  }));
}

async function loadFeedbackContext(sql, projectId) {
  if (!Number.isFinite(Number(projectId))) return [];
  const rows = await sql`
    SELECT project_id, applies_to, note, rating, created_at
    FROM content_feedback
    WHERE project_id = ${Number(projectId)}
       OR project_id IN (
         SELECT id
         FROM content_projects
         WHERE status <> 'archived'
         ORDER BY updated_at DESC
         LIMIT 20
       )
    ORDER BY
      CASE WHEN project_id = ${Number(projectId)} THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 30
  `;
  return rows.map(row => ({
    applies_to: row.applies_to || 'general',
    note: cleanText(row.note, 1200),
    rating: row.rating || '',
  })).filter(item => item.note);
}

function buildSystemPrompt(guidelines) {
  return `You are HOWL Campfires' senior content strategist and SEO/AEO editor.

Voice:
${guidelines.voice_guidance || 'Direct, practical, specific, outdoor-literate, and confident. Write like a real person explaining something useful.'}

Approved claims:
${(guidelines.approved_claims || []).join('\n') || 'No approved claims provided.'}

Required disclosures:
${(guidelines.required_disclosures || []).join('\n') || 'No required disclosures provided.'}

${SEO_AEO_PLAYBOOK}

Prohibited phrases and claims:
${[...(guidelines.prohibited_phrases || []), ...(guidelines.prohibited_claims || [])].join('\n') || 'Avoid unsupported claims and generic AI phrasing.'}

Rules:
- Build for SEO and answer-engine usefulness, but keep the article human and useful.
- Use selected source examples only for voice, rhythm, structure, and claim discipline. Do not use them to choose the article topic.
- Do not invent product specs, certifications, discounts, prices, or comparative claims.
- Include snippet-ready direct answers where the user intent calls for them.
- Avoid em dashes, vague superlatives, fake testimonials, and invented citations.
- Follow the HOWL SEO/AEO playbook exactly. Prefer clear answers, decision usefulness, and extractable structure over long generic prose.
- Return only valid JSON.`;
}

function buildUserPrompt({ action, project, sources, feedback, outline, draft }) {
  const brief = `CONTENT BRIEF
Title: ${project.title || 'Untitled'}
Topic: ${project.topic || 'Not specified'}
Target query: ${project.target_query || 'Not specified'}
Audience: ${project.audience || 'Not specified'}
Product/category: ${project.product || 'Not specified'}
Search intent: ${project.search_intent || 'Not specified'}
Desired CTA: ${project.desired_cta || 'Not specified'}
Must include: ${project.must_include || 'None'}
Avoid: ${project.avoid || 'None'}`;

  const sourceText = sources.length
    ? sources.map((source, index) => `VOICE SOURCE ${index + 1} [id=${source.id}; ${source.type}; ${source.title}]
Tags: ${(source.tags || []).join(', ') || 'none'}
URL: ${source.url || 'n/a'}
Excerpt:
${source.excerpt}`).join('\n\n-----\n\n')
    : 'No voice examples were selected. Use the brand guidelines, brief, and learned editorial feedback only.';

  const feedbackText = feedback?.length
    ? feedback.map((item, index) => `${index + 1}. [${item.applies_to}${item.rating ? `; ${item.rating}` : ''}] ${item.note}`).join('\n')
    : 'No learned editorial feedback has been saved yet.';

  const shapes = {
    outline: `Generate an SEO/AEO outline before drafting.
Return JSON with:
{
  "title_options": ["..."],
  "meta_description": "...",
  "search_intent_summary": "...",
  "outline_markdown": "Markdown outline with H1/H2/H3, answer blocks, FAQ ideas, internal-link placeholders, and proof gaps",
  "source_influence": [{"source_id": 1, "source_title": "...", "used_for": "voice|structure|claim caution"}],
  "seo_checks": ["pass/fail notes from the HOWL SEO/AEO playbook"],
  "proof_gaps": ["claims or data that must be verified before publishing"],
  "schema_suggestions": [{"type": "Article|FAQPage|HowTo|Product", "reason": "..."}]
}`,
    draft: `Write the full blog draft from the approved outline.
Return JSON with:
{
  "title": "...",
  "meta_description": "...",
  "slug": "...",
  "markdown": "Complete article in Markdown, with H1/H2/H3 structure, answer blocks, FAQ, CTA, and internal-link placeholders",
  "schema_suggestions": [{"type": "Article|FAQPage|HowTo|Product", "reason": "..."}],
  "source_influence": [{"source_id": 1, "source_title": "...", "used_for": "voice|structure|claim caution"}],
  "seo_checks": ["pass/fail notes from the HOWL SEO/AEO playbook"],
  "proof_gaps": ["claims or data that must be verified before publishing"]
}`,
    rewrite: `Rewrite the supplied draft for clarity, brand voice, SEO/AEO structure, and factual restraint.
Return JSON with the same shape as draft.`,
    faq: `Generate FAQ entries for this article.
Return JSON with:
{
  "markdown": "FAQ section in Markdown",
  "source_influence": [{"source_id": 1, "source_title": "...", "used_for": "..."}],
  "seo_checks": ["..."]
}`,
    metadata: `Generate title-tag options, meta description, slug, social title, and excerpt.
Return JSON with:
{
  "markdown": "A compact metadata package in Markdown",
  "title_options": ["..."],
  "meta_description": "...",
  "slug": "...",
  "source_influence": [],
  "seo_checks": ["..."]
}`,
  };

  return `${brief}

APPROVED OUTLINE OR CURRENT OUTLINE:
${outline || 'No outline supplied.'}

CURRENT DRAFT, IF ANY:
${draft || 'No draft supplied.'}

LEARNED EDITORIAL FEEDBACK:
${feedbackText}

VOICE SOURCES:
${sourceText}

TASK:
${shapes[action] || shapes.outline}`;
}
