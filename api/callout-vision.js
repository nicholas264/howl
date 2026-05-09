// Calls Claude Sonnet (vision) to locate product features inside a callout
// base image. When productId is supplied, the per-feature specs from the
// callout_feature_specs table are loaded and used to ground placement so
// the model has a precise description of what each feature looks like and
// roughly where it should appear.
//
// Input  (POST JSON): { imageUrl, productId?, productName?, features: string[] }
// Output (200 JSON):  { placements: [{ feature, anchorX, anchorY, side }] }
import { neon } from '@neondatabase/serverless';
import { requireAuth } from './_lib/auth.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are placing leader-line callouts on a product photo for an ad.

For each feature in the user's list, locate its visual center in the image and
return normalized coordinates plus a side recommendation.

RULES:
- anchorX is 0 (left edge) to 1 (right edge); anchorY is 0 (top edge) to 1 (bottom edge).
- side is "left" or "right" — the side of the image where the text label sits.
- Be precise: anchors must land on the actual feature, not in empty space or on a different element.
- Spread sides across the layout — do not stack every label on one side. As a heuristic, features whose anchorX is in the LEFT half of the image generally get side="left" (label sits to the left); RIGHT half gets side="right". When two features sit close together vertically, place them on OPPOSITE sides so their text blocks do not collide.
- If a feature is not visible or cannot be confidently located, omit it.
- When the user provides a "Visual description" or "Typical location", trust those hints — they describe what the feature actually looks like on this product.

Respond with ONLY a JSON object matching this schema, no prose:
{ "placements": [{ "feature": string, "anchorX": number, "anchorY": number, "side": "left"|"right" }] }`;

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { imageUrl, productId, productName, features } = req.body || {};
  if (!imageUrl || !Array.isArray(features) || !features.length) {
    return res.status(400).json({ error: 'imageUrl and features[] required' });
  }

  try {
    // Load per-feature grounding specs if productId is supplied.
    let specs = [];
    if (productId && process.env.DATABASE_URL) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        specs = await sql`
          SELECT feature_name, visual_description, typical_location
          FROM callout_feature_specs
          WHERE product_id = ${productId}
        `;
      } catch (err) {
        console.error('feature spec load failed', err);
      }
    }
    const specByName = new Map(specs.map(s => [s.feature_name.toLowerCase(), s]));

    // Pull the image and base64-encode for Claude.
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return res.status(400).json({ error: `Could not load image: ${imgRes.status}` });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mediaType = imgRes.headers.get('content-type') || 'image/jpeg';
    const base64 = buf.toString('base64');

    const featureBlock = features.map(f => {
      const s = specByName.get(f.toLowerCase());
      const lines = [`- ${f}`];
      if (s?.visual_description) lines.push(`  Visual description: ${s.visual_description}`);
      if (s?.typical_location) lines.push(`  Typical location: ${s.typical_location}`);
      return lines.join('\n');
    }).join('\n');
    const userText = `Product: ${productName || productId || 'unknown'}\nFeatures to locate:\n${featureBlock}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: userText },
          ],
        }],
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Claude API error' });
    const text = (data.content || []).map(b => b.text || '').join('').trim();

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(502).json({ error: 'Could not parse vision response', raw: text });
    }

    const placements = (parsed.placements || []).map(p => ({
      feature: String(p.feature || ''),
      anchorX: Math.max(0.02, Math.min(0.98, Number(p.anchorX))),
      anchorY: Math.max(0.05, Math.min(0.95, Number(p.anchorY))),
      side: p.side === 'right' ? 'right' : 'left',
    })).filter(p => p.feature && Number.isFinite(p.anchorX) && Number.isFinite(p.anchorY));

    return res.json({ placements });
  } catch (err) {
    console.error('callout-vision error', err);
    return res.status(500).json({ error: err.message });
  }
}
