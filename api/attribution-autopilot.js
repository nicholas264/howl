import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

// Tokens that appear in ad names but are not creator-identifying.
const STOP = new Set([
  'howl', 'ugc', 'copy', 'internal', 'white', 'monster', 'black', 'video', 'vid',
  'static', 'final', 'draft', 'test', 'new', 'old', 'the', 'and', 'for', 'with',
  'r1', 'r4', 'mkii', 'mk', 'mki', 'bag', 'haul', 'rally', 'mount', 'wl', 'trd',
  'v1', 'v2', 'v3', 'v4', 'a1', 'b1', 'carousel', 'image', 'photo', 'reel', 'ad',
]);

function tokenize(s) {
  return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

// Extract the creator-name field from the "HOWL | UGC | {name} | ..." convention.
function pipeNameField(adName) {
  if (!/\|\s*ugc\s*\|/i.test(adName)) return null;
  const parts = adName.split('|').map(p => p.trim());
  const idx = parts.findIndex(p => /^ugc$/i.test(p));
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

// Word-boundary match an ad name against the roster. Full-name match (>=2 name
// tokens present) is high confidence; a single distinctive token is medium.
// Substrings inside a word never match (so "Alex" never matches creator "Lex").
function matchCreator(adName, creators) {
  const field = pipeNameField(adName);
  const hay = new Set(tokenize(field || adName));
  if (!hay.size) return null;

  const hits = [];
  for (const c of creators) {
    const nameTokens = c.tokens.filter(t => !STOP.has(t));
    if (!nameTokens.length) continue;
    const present = nameTokens.filter(t => hay.has(t));
    if (!present.length) continue;
    let confidence;
    if (nameTokens.length >= 2 && present.length >= 2) confidence = 'high';
    else if (nameTokens.length === 1 && present[0].length >= 4) confidence = 'high';
    else if (present.some(t => t.length >= 4)) confidence = 'medium';
    else confidence = 'low';
    const score = present.reduce((a, t) => a + t.length, 0)
      + (confidence === 'high' ? 100 : confidence === 'medium' ? 20 : 0);
    hits.push({ creator: c, confidence, score, matched_on: present });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  const best = hits[0];
  // Ambiguity: more than one distinct creator at the top confidence -> needs review.
  const topConf = best.confidence;
  const distinct = new Set(hits.filter(h => h.confidence === topConf).map(h => h.creator.id));
  const ambiguous = distinct.size > 1;
  return {
    creator_id: best.creator.id,
    creator_name: best.creator.name,
    confidence: ambiguous ? 'review' : best.confidence,
    matched_on: best.matched_on,
    ambiguous,
  };
}

// Mirrors the assign_creative_creator cascade in api/meta.js so attribution
// writes the same three sources of truth + activity log.
async function assignGroup(sql, groupKey, creatorId, creatorName, userId) {
  await sql`
    INSERT INTO creative_creator_assignments (group_key, creator_id, source_type, source_label, assigned_by)
    VALUES (${groupKey}, ${creatorId}, 'external_creator', ${creatorName}, ${userId})
    ON CONFLICT (group_key) DO UPDATE SET
      creator_id = EXCLUDED.creator_id, source_type = EXCLUDED.source_type,
      source_label = EXCLUDED.source_label, assigned_by = EXCLUDED.assigned_by, updated_at = now()
  `;
  await sql`
    UPDATE creative_assets SET creator_id = ${creatorId}, creator = ${creatorName},
      source_type = 'external_creator', source_label = ${creatorName}, updated_at = now()
    WHERE group_key = ${groupKey}
  `;
  await sql`
    UPDATE launch_history SET creator_id = ${creatorId}, creator = ${creatorName},
      source_type = 'external_creator', source_label = ${creatorName}
    WHERE ad_id IN (SELECT ad_id FROM creative_performance WHERE group_key = ${groupKey})
  `;
  await sql`
    INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
    VALUES (${creatorId}, 'creative_performance_linked',
      ${`Auto-attributed creative group "${groupKey}"`},
      ${JSON.stringify({ group_key: groupKey, source: 'attribution_autopilot' })}::jsonb, ${userId})
  `;
}

async function unattributedGroups(sql) {
  return sql`
    SELECT cp.group_key, min(cp.ad_name) AS ad_name, min(cp.thumbnail_url) AS thumbnail_url,
      COALESCE(SUM(i.spend), 0)::float AS spend,
      COALESCE(SUM(i.purchases), 0)::int AS purchases,
      COALESCE(SUM(i.purchase_value), 0)::float AS revenue
    FROM creative_performance cp
    LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
    WHERE NOT EXISTS (SELECT 1 FROM creative_creator_assignments a WHERE a.group_key = cp.group_key)
    GROUP BY cp.group_key
    HAVING COALESCE(SUM(i.spend), 0) > 0
    ORDER BY spend DESC
    LIMIT 400
  `;
}

async function loadRoster(sql) {
  const creators = await sql`SELECT id, name FROM creators WHERE name IS NOT NULL AND stage <> 'alumni'`;
  return creators.map(c => ({ id: c.id, name: c.name, tokens: tokenize(c.name) }));
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql, userId } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const roster = await loadRoster(sql);

    if (req.method === 'GET') {
      const groups = await unattributedGroups(sql);
      const suggestions = groups.map(g => ({
        group_key: g.group_key, ad_name: g.ad_name, thumbnail_url: g.thumbnail_url,
        spend: g.spend, purchases: g.purchases, revenue: g.revenue,
        match: matchCreator(g.ad_name, roster),
      }));
      const summary = {
        groups: suggestions.length,
        spend: Math.round(suggestions.reduce((a, s) => a + s.spend, 0)),
        high: suggestions.filter(s => s.match?.confidence === 'high').length,
        high_spend: Math.round(suggestions.filter(s => s.match?.confidence === 'high').reduce((a, s) => a + s.spend, 0)),
        review: suggestions.filter(s => s.match && s.match.confidence !== 'high').length,
        unmatched: suggestions.filter(s => !s.match).length,
      };
      return res.json({ suggestions, summary, creators: roster.map(c => ({ id: c.id, name: c.name })) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const nameById = new Map(roster.map(c => [c.id, c.name]));

      // Recompute and apply every non-ambiguous high-confidence match.
      if (body.apply_high_confidence) {
        const groups = await unattributedGroups(sql);
        let applied = 0;
        for (const g of groups) {
          const m = matchCreator(g.ad_name, roster);
          if (m && m.confidence === 'high') {
            await assignGroup(sql, g.group_key, m.creator_id, m.creator_name, userId);
            applied++;
          }
        }
        return res.json({ applied });
      }

      // Apply an explicit list of {group_key, creator_id}.
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      let applied = 0;
      for (const a of assignments) {
        const creatorId = Number(a.creator_id);
        const groupKey = (a.group_key || '').toString().trim();
        if (!creatorId || !groupKey || !nameById.has(creatorId)) continue;
        await assignGroup(sql, groupKey, creatorId, nameById.get(creatorId), userId);
        applied++;
      }
      return res.json({ applied });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('attribution-autopilot error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
