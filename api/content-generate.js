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

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'briefs.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

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
    const guidelines = await loadBrandGuidelines(sql);
    const model = ALLOWED_MODELS.has(req.body?.model) ? req.body.model : DEFAULT_MODEL;

    if (action === 'export') {
      const markdown = cleanText(req.body?.bodyMarkdown || req.body?.body_markdown, 200000);
      const violations = validateBrandCopy(markdown, guidelines);
      return res.json({ markdown, html: markdownToHtml(markdown), guardrailViolations: violations });
    }

    const outline = cleanText(req.body?.outline, 80000);
    const draft = cleanText(req.body?.draft, 200000);
    const system = buildSystemPrompt(guidelines);
    const user = buildUserPrompt({ action, project, sources, outline, draft });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: action === 'draft' ? 12000 : 6000,
        temperature: action === 'draft' ? 0.45 : 0.35,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: anthropicErrorMessage(data) || `Anthropic request failed (${response.status})`,
        detail: data?.error || data,
      });
    }
    const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
    const parsed = parseModelJson(text);
    const markdown = cleanText(parsed.markdown || parsed.outline_markdown || parsed.draft_markdown || '', 200000);
    const guardrailViolations = validateBrandCopy(markdown, guidelines);
    return res.json({
      action,
      model,
      result: {
        ...parsed,
        markdown,
        html: markdown ? markdownToHtml(markdown) : '',
        source_influence: Array.isArray(parsed.source_influence) ? parsed.source_influence : [],
        guardrail_violations: guardrailViolations,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
  }
  if (!sourceRows.length) {
    const query = [
      project.topic,
      project.target_query,
      project.product,
      project.search_intent,
    ].filter(Boolean).join(' ');
    const terms = keywordTerms(query);
    if (terms.length) {
      sourceRows = await sql`
        SELECT DISTINCT s.id, s.title, s.source_type, s.body, s.url, s.tags
        FROM content_sources s
        LEFT JOIN content_source_chunks c ON c.source_id = s.id
        WHERE c.keywords && ${terms}::text[]
           OR s.tags && ${terms}::text[]
           OR s.title ILIKE ${`%${terms[0]}%`}
        ORDER BY s.created_at DESC
        LIMIT 8
      `;
    }
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

function keywordTerms(text) {
  const stop = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'could', 'every', 'from', 'have', 'into', 'just', 'like', 'more', 'that', 'their', 'there', 'they', 'this', 'with', 'would', 'your']);
  return [...new Set((cleanText(text, 2000).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])
    .filter(word => !stop.has(word)))].slice(0, 12);
}

function buildSystemPrompt(guidelines) {
  return `You are HOWL Campfires' senior content strategist and SEO/AEO editor.

Voice:
${guidelines.voice_guidance || 'Direct, practical, specific, outdoor-literate, and confident. Write like a real person explaining something useful.'}

Approved claims:
${(guidelines.approved_claims || []).join('\n') || 'No approved claims provided.'}

Required disclosures:
${(guidelines.required_disclosures || []).join('\n') || 'No required disclosures provided.'}

Prohibited phrases and claims:
${[...(guidelines.prohibited_phrases || []), ...(guidelines.prohibited_claims || [])].join('\n') || 'Avoid unsupported claims and generic AI phrasing.'}

Rules:
- Build for SEO and answer-engine usefulness, but keep the article human and useful.
- Use source examples as voice and structure references, not as text to copy.
- Do not invent product specs, certifications, discounts, prices, or comparative claims.
- Include snippet-ready direct answers where the user intent calls for them.
- Avoid em dashes, vague superlatives, fake testimonials, and invented citations.
- Return only valid JSON.`;
}

function buildUserPrompt({ action, project, sources, outline, draft }) {
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
    ? sources.map((source, index) => `SOURCE ${index + 1} [id=${source.id}; ${source.type}; ${source.title}]
Tags: ${(source.tags || []).join(', ') || 'none'}
URL: ${source.url || 'n/a'}
Excerpt:
${source.excerpt}`).join('\n\n-----\n\n')
    : 'No imported source examples were selected. Use the brand guidelines and brief only.';

  const shapes = {
    outline: `Generate an SEO/AEO outline before drafting.
Return JSON with:
{
  "title_options": ["..."],
  "meta_description": "...",
  "search_intent_summary": "...",
  "outline_markdown": "Markdown outline with H1/H2/H3, answer blocks, FAQ ideas, internal-link placeholders, and proof gaps",
  "source_influence": [{"source_id": 1, "source_title": "...", "used_for": "voice|structure|claim caution|angle"}],
  "seo_checks": ["..."],
  "proof_gaps": ["..."]
}`,
    draft: `Write the full blog draft from the approved outline.
Return JSON with:
{
  "title": "...",
  "meta_description": "...",
  "slug": "...",
  "markdown": "Complete article in Markdown, with H1/H2/H3 structure, answer blocks, FAQ, CTA, and internal-link placeholders",
  "schema_suggestions": ["FAQPage", "Article"],
  "source_influence": [{"source_id": 1, "source_title": "...", "used_for": "voice|structure|claim caution|angle"}],
  "seo_checks": ["..."]
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

SOURCE EXAMPLES:
${sourceText}

TASK:
${shapes[action] || shapes.outline}`;
}
