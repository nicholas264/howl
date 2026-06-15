import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

const DEFAULTS = {
  brand_name: 'HOWL Campfires',
  voice_guidance: 'Direct, practical, specific, outdoor-literate, and confident. Write like a real person explaining something useful, never like a brand performing enthusiasm.',
  approved_claims: [],
  prohibited_phrases: ['game changer', 'you need this', 'must-have', 'obsessed'],
  prohibited_claims: [],
  required_disclosures: [],
};

function clean(value, max = 5000) {
  return (value ?? '').toString().trim().slice(0, max);
}

function list(value, maxItems = 100) {
  const source = Array.isArray(value) ? value : clean(value).split('\n');
  return [...new Set(source.map(item => clean(item, 500)).filter(Boolean))].slice(0, maxItems);
}

async function getGuidelines(sql) {
  const [row] = await sql`SELECT * FROM brand_guidelines ORDER BY updated_at DESC LIMIT 1`;
  return row || DEFAULTS;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') return res.json({ guidelines: await getGuidelines(sql) });
    if (req.method !== 'PUT') return res.status(405).end();

    const current = await getGuidelines(sql);
    const payload = {
      brand_name: clean(req.body?.brand_name, 200) || current.brand_name || DEFAULTS.brand_name,
      voice_guidance: clean(req.body?.voice_guidance, 5000),
      approved_claims: list(req.body?.approved_claims),
      prohibited_phrases: list(req.body?.prohibited_phrases),
      prohibited_claims: list(req.body?.prohibited_claims),
      required_disclosures: list(req.body?.required_disclosures),
    };
    const [guidelines] = await sql`
      INSERT INTO brand_guidelines (
        brand_name, voice_guidance, approved_claims, prohibited_phrases,
        prohibited_claims, required_disclosures, updated_by
      ) VALUES (
        ${payload.brand_name}, ${payload.voice_guidance}, ${payload.approved_claims},
        ${payload.prohibited_phrases}, ${payload.prohibited_claims},
        ${payload.required_disclosures}, ${access.userId}
      )
      RETURNING *
    `;
    return res.json({ guidelines });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
