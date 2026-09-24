import { studioRequest, validateStudioBrief, parseStudioOutput, STUDIO_OUTPUT_CONFIG, breakdownRequest, parseBreakdown, BREAKDOWN_SCHEMA, STUDIO_MODEL, STUDIO_EFFORT, STUDIO_TOKEN_BUDGET, studioEditorialRequest } from './_lib/script-studio.js';
import { loadBrandGuidelines, validateBrandCopy } from './_lib/brand-guardrails.js';
import { scriptwritingRequest, SCRIPTWRITING_VERSION } from './_lib/howl-scriptwriting.js';
import { meteredFetch } from './_lib/metered-fetch.js';
import { checkWorkLimit } from './_lib/work-limits.js';
// Hardened proxy to Anthropic. The browser cannot pass arbitrary fields:
// only model (whitelisted), max_tokens (capped), system, messages,
// temperature pass through. Tool calls and other features are not exposed.
import { requirePermission } from './_lib/app-access.js';

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 8192;

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'briefs.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await checkWorkLimit(access, res, 'generation'))) return;
  const isStudio = ['script_studio', 'script_studio_breakdown'].includes(req.body?.task);
  const fetch=meteredFetch(access, globalThis.fetch, {timeoutMs:isStudio?180000:55000});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const body = req.body || {};
  const requested = typeof body.model === 'string' ? body.model : '';
  const model = ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL;

  const reqTokens = Number(body.max_tokens);
  const max_tokens = Number.isFinite(reqTokens) && reqTokens > 0
    ? Math.min(reqTokens, MAX_TOKENS_CAP)
    : 1024;

  if (body.system && typeof body.system !== 'string') {
    return res.status(400).json({ error: 'system must be a string' });
  }

  if (JSON.stringify(body).length > 200000) return res.status(413).json({error:'Generation input exceeds the 200,000-character limit.'});

  let generation, studioGuidelines;
  try {
    if (body.task === 'script_studio_breakdown') {
      generation = breakdownRequest(body.script);
    } else if (body.task === 'script_studio') {
      const brief = validateStudioBrief(body.brief);
      let creator = null;
      if (brief.creatorId) {
        [creator] = await access.sql`SELECT id, name, bio, niche, strengths, activities, audience_demographics, audience_psychographics FROM creators WHERE id = ${brief.creatorId}`;
      }
      studioGuidelines = await loadBrandGuidelines(access.sql);
      generation = studioRequest(brief, { creator, guidelines: studioGuidelines });
    } else generation = scriptwritingRequest(body);
  }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (!Array.isArray(generation.messages) || !generation.messages.length) {
    return res.status(400).json({ error: 'messages[] required' });
  }
  if (body.task) res.setHeader('X-HOWL-Scriptwriting-Version', SCRIPTWRITING_VERSION);

  // Server-controlled allowlist. Browser-supplied tools / tool_choice /
  // anthropic_version / metadata / etc are dropped here on purpose.
  const safeBody = {
    model: isStudio ? STUDIO_MODEL : model,
    max_tokens: isStudio ? STUDIO_TOKEN_BUDGET : max_tokens,
    ...(body.task === 'script_studio' ? { output_config: { ...STUDIO_OUTPUT_CONFIG, effort: STUDIO_EFFORT } } : body.task === 'script_studio_breakdown' ? { output_config: { effort: STUDIO_EFFORT, format: { type: 'json_schema', schema: BREAKDOWN_SCHEMA } } } : {}),
    messages: generation.messages,
    ...(generation.system ? { system: generation.system } : {}),
    ...(!isStudio && typeof body.temperature === 'number' ? { temperature: Math.max(0, Math.min(1, body.temperature)) } : {}),
  };

  try {
    const deadline = isStudio ? AbortSignal.timeout(240000) : undefined;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
      ...(deadline ? {signal:deadline} : {}),
    });
    const data = await r.json();
    if (isStudio && r.ok && data.stop_reason === 'max_tokens') return res.status(502).json({error:'The writer reached its response limit before finishing. Please generate again.'});
    if (body.task === 'script_studio_breakdown' && r.ok) {
      try {
        const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
        return res.json({ breakdown: parseBreakdown(JSON.parse(raw), body.script), breakdown_script: body.script });
      } catch (error) { return res.status(502).json({ error: 'Could not label the exact script. Please refresh the breakdown.' }); }
    }
    if (body.task === 'script_studio' && r.ok) {
      try {
        const draft = parseStudioOutput(data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '', { requireBreakdown: true });
        const edit = studioEditorialRequest(generation, draft);
        const edited = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST', headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
          body:JSON.stringify({...safeBody,...edit}), signal:deadline,
        });
        const final = await edited.json();
        if (!edited.ok) return res.status(edited.status).json({error:final.error?.message || 'The editorial pass failed. Please generate again.'});
        if (final.stop_reason === 'max_tokens') return res.status(502).json({error:'The editorial pass reached its response limit. Please generate again.'});
        const script = parseStudioOutput(final.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '', {requireBreakdown:true});
        const violations = validateBrandCopy(JSON.stringify(script), studioGuidelines);
        if (violations.length) return res.status(422).json({ error: `Revise your direction and try again. Brand checks flagged: ${violations.join(', ')}` });
        return res.json({ script, version: SCRIPTWRITING_VERSION });
      } catch (error) { return res.status(502).json({ error: error.message }); }
    }
    return res.status(r.status).json(data);
  } catch (err) {
    console.error('generate error', err);
    return res.status(500).json({ error: 'Failed to call Anthropic API' });
  }
}
