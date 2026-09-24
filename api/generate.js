import { studioRequest, validateStudioBrief, parseStudioOutput, STUDIO_OUTPUT_CONFIG } from './_lib/script-studio.js';
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
  const fetch=meteredFetch(access);

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
    if (body.task === 'script_studio') {
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
    model: body.task === 'script_studio' ? DEFAULT_MODEL : model,
    max_tokens,
    ...(body.task === 'script_studio' ? { output_config: STUDIO_OUTPUT_CONFIG } : {}),
    messages: generation.messages,
    ...(generation.system ? { system: generation.system } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: Math.max(0, Math.min(1, body.temperature)) } : {}),
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });
    const data = await r.json();
    if (body.task === 'script_studio' && r.ok) {
      try {
        const script = parseStudioOutput(data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '');
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
