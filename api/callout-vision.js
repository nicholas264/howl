// Calls Claude Sonnet (vision) to locate product features inside a callout
// base image. Returns normalized anchor coordinates so the editor can place
// callouts automatically.
//
// Input  (POST JSON): { imageUrl, productName, features: string[] }
// Output (200 JSON):  { placements: [{ feature, anchorX, anchorY, side }] }
import { requireAuth } from './_lib/auth.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are placing leader-line callouts on a product photo for an ad.
For each feature in the user's list, identify where on the image that feature
is visually located and return its center as normalized coordinates.
- anchorX is 0 (left edge) to 1 (right edge).
- anchorY is 0 (top edge) to 1 (bottom edge).
- side is "left" or "right" — choose the side of the image where the text
  block should sit so the leader line is short and does NOT cross the
  product. Generally pick the opposite side from the anchor when the anchor
  is far from the centerline; pick the closer side when the anchor is near
  the edge.
If a feature is not visible, omit it from the output. Be precise — anchors
should land on the actual feature, not in empty space.
Respond with ONLY a JSON object matching this schema, no prose:
{ "placements": [{ "feature": string, "anchorX": number, "anchorY": number, "side": "left"|"right" }] }`;

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { imageUrl, productName, features } = req.body || {};
  if (!imageUrl || !Array.isArray(features) || !features.length) {
    return res.status(400).json({ error: 'imageUrl and features[] required' });
  }

  try {
    // Pull the image and base64-encode for Claude (avoids URL-fetch quirks).
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return res.status(400).json({ error: `Could not load image: ${imgRes.status}` });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mediaType = imgRes.headers.get('content-type') || 'image/jpeg';
    const base64 = buf.toString('base64');

    const userText = `Product: ${productName || 'unknown'}\nFeatures to locate:\n${features.map(f => `- ${f}`).join('\n')}`;

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
