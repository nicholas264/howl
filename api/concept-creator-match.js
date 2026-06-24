import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { loadEvidence, creatorFitSignals } from './_lib/creator-matching.js';

function clean(value, max = 600) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

// Deterministic, concept-aware "why this creator" line. Reliable and free —
// references the concept's angle against the creator's proof + profile.
function rationale(creator, { angle, format }) {
  const parts = [];
  if (creator.proven) {
    parts.push(`Proven on the account ($${Math.round(creator.spend).toLocaleString()} spend, ${creator.roas.toFixed(2)}x ROAS)`);
  } else if (Number(creator.spend) > 0) {
    parts.push(`Some account history ($${Math.round(creator.spend).toLocaleString()} spend)`);
  } else {
    parts.push('Net-new creator (no spend history yet)');
  }
  if (Number(creator.product_roas) > 0) parts.push(`${Number(creator.product_roas).toFixed(2)}x on this product line`);
  if (creator.niche) parts.push(`${creator.niche} niche`);
  if (creator.strengths) parts.push(`strengths in ${String(creator.strengths).toLowerCase()}`);
  let line = parts.join(' · ');
  if (angle) line += ` — fit for the "${angle}" angle`;
  if (format) line += ` in ${String(format).replace(/_/g, ' ')}`;
  return line + '.';
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const product = clean(body.product, 200);
    const angle = clean(body.angle, 200);
    const format = clean(body.format, 60);
    const objective = clean(body.objective, 200);
    const windowDays = [7, 14, 30, 90, 180].includes(Number(body.window_days)) ? Number(body.window_days) : 90;
    const limit = Math.max(3, Math.min(20, Number(body.limit) || 10));

    const { creators, patterns } = await loadEvidence(sql, windowDays, product);

    const ranked = creators
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(c => ({
        creator_id: c.id,
        name: c.name,
        stage: c.stage,
        status: c.status,
        score: Math.round(c.score * 10) / 10,
        proven: c.proven,
        spend: Number(c.spend || 0),
        roas: Number(c.roas || 0),
        product_roas: Number(c.product_roas || 0),
        purchases: Number(c.purchases || 0),
        niche: c.niche || null,
        fit_signals: creatorFitSignals(c),
        rationale: rationale(c, { angle, format }),
      }));

    // Top account patterns that match the requested angle/format, as supporting evidence.
    const relevantPatterns = patterns
      .filter(p => {
        if (angle && p.angle && p.angle.toLowerCase().includes(angle.toLowerCase())) return true;
        if (format && p.format && p.format.toLowerCase().includes(format.toLowerCase())) return true;
        return false;
      })
      .slice(0, 5);

    return res.json({
      query: { product, angle, format, objective, window_days: windowDays },
      creators: ranked,
      patterns: relevantPatterns.length ? relevantPatterns : patterns.slice(0, 5),
    });
  } catch (err) {
    console.error('concept-creator-match error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
