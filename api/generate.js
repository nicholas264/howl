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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const body = req.body || {};
  const requested = typeof body.model === 'string' ? body.model : '';
  const model = ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL;

  const reqTokens = Number(body.max_tokens);
  const max_tokens = Number.isFinite(reqTokens) && reqTokens > 0
    ? Math.min(reqTokens, MAX_TOKENS_CAP)
    : 1024;

  if (!Array.isArray(body.messages) || !body.messages.length) {
    return res.status(400).json({ error: 'messages[] required' });
  }
  if (body.system && typeof body.system !== 'string') {
    return res.status(400).json({ error: 'system must be a string' });
  }

  // Server-controlled allowlist. Browser-supplied tools / tool_choice /
  // anthropic_version / metadata / etc are dropped here on purpose.
  const safeBody = {
    model,
    max_tokens,
    messages: body.messages,
    ...(body.system ? { system: body.system } : {}),
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
    return res.status(r.status).json(data);
  } catch (err) {
    console.error('generate error', err);
    return res.status(500).json({ error: 'Failed to call Anthropic API' });
  }
}
