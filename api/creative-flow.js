import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { listAnalyzedWinners } from './_lib/meta/creative-analysis.js';

export const STAGES = ['ideate', 'match', 'brief', 'produce', 'launch', 'analyze', 'iterate'];

function text(value, max = 2000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

// Enriched view of a flow card: joins creator name and live status of the
// linked brief / deliverable so the board reflects reality without forking data.
async function loadCards(sql) {
  const rows = await sql`
    SELECT
      f.*,
      c.name AS creator_name,
      c.stage AS creator_stage,
      b.title AS brief_title,
      b.status AS brief_status,
      d.id AS resolved_deliverable_id,
      d.title AS deliverable_title,
      d.status AS deliverable_status,
      d.expected_asset_count,
      d.received_asset_count,
      d.completed_asset_count,
      d.shipped_asset_count,
      launched.ad_id AS launched_ad_id,
      launched.launched_at AS launched_at
    FROM flow_cards f
    LEFT JOIN creators c ON c.id = f.creator_id
    LEFT JOIN creator_briefs b ON b.id = f.brief_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM creator_deliverables d
      WHERE d.id = f.deliverable_id
        OR (
          f.deliverable_id IS NULL
          AND f.brief_id IS NOT NULL
          AND d.brief_id = f.brief_id
        )
      ORDER BY
        CASE WHEN d.id = f.deliverable_id THEN 0 ELSE 1 END,
        d.updated_at DESC
      LIMIT 1
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT l.ad_id, l.launched_at
      FROM launch_history l
      WHERE (f.ad_id IS NOT NULL AND l.ad_id = f.ad_id)
        OR (d.id IS NOT NULL AND l.deliverable_id = d.id)
        OR (f.brief_id IS NOT NULL AND l.brief_id = f.brief_id)
        OR (
          f.group_key IS NOT NULL
          AND l.ad_id IN (SELECT cp.ad_id FROM creative_performance cp WHERE cp.group_key = f.group_key)
        )
      ORDER BY l.launched_at DESC
      LIMIT 1
    ) launched ON true
    WHERE NOT f.archived
    ORDER BY f.updated_at DESC
  `;
  return rows.map(card => {
    const delivered = card.resolved_deliverable_id ? Number(card.resolved_deliverable_id) : null;
    const shipped = Number(card.shipped_asset_count || 0) > 0;
    const completed = Number(card.completed_asset_count || 0) > 0;
    const deliverableStatus = card.deliverable_status;
    let computedStage = card.stage;
    let stageReason = 'Manual stage';
    if (card.launched_ad_id || shipped || deliverableStatus === 'launched') {
      computedStage = 'analyze';
      stageReason = card.launched_ad_id ? `Launched as ${card.launched_ad_id}` : 'Deliverable shipped';
    } else if (delivered && (completed || ['approved', 'complete'].includes(deliverableStatus))) {
      computedStage = 'launch';
      stageReason = 'Finished creator asset is ready to launch';
    } else if (delivered || card.brief_status === 'approved') {
      computedStage = 'produce';
      stageReason = delivered ? `Deliverable ${deliverableStatus || 'created'}` : 'Approved brief is ready for production';
    } else if (card.brief_id || card.brief_status) {
      computedStage = 'brief';
      stageReason = card.brief_status ? `Brief ${card.brief_status}` : 'Brief linked';
    } else if (card.creator_id) {
      computedStage = 'brief';
      stageReason = 'Creator matched';
    }
    return {
      ...card,
      manual_stage: card.stage,
      stage: computedStage,
      stage_reason: stageReason,
      deliverable_id: card.deliverable_id || delivered,
    };
  });
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql, userId } = access;

  try {
    await ensureCreatorOpsTables(sql);

    if (req.method === 'GET') {
      const cards = await loadCards(sql);
      const byStage = Object.fromEntries(STAGES.map(s => [s, []]));
      for (const card of cards) {
        (byStage[card.stage] || byStage.ideate).push(card);
      }

      // Analyzed winners not yet pulled into the flow — available to iterate from.
      let availableWinners = [];
      try {
        const won = await listAnalyzedWinners({ sinceDays: 60 });
        const claimed = new Set(cards.map(c => c.source_winner_group_key).filter(Boolean));
        availableWinners = (won.body?.winners || [])
          .filter(w => !claimed.has(w.group_key))
          .slice(0, 24)
          .map(w => ({
            group_key: w.group_key, name: w.name, angle: w.angle, format: w.format,
            hook_type: w.hook_type, why_it_worked: w.why_it_worked, thumbnail_url: w.thumbnail_url,
            spend: w.spend, purchase_value: w.purchase_value, purchases: w.purchases,
          }));
      } catch (err) {
        console.error('flow winners load failed', err.message);
      }

      const counts = Object.fromEntries(STAGES.map(s => [s, byStage[s].length]));
      return res.json({ stages: STAGES, columns: byStage, availableWinners, counts });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const stage = STAGES.includes(body.stage) ? body.stage : 'ideate';
      const [card] = await sql`
        INSERT INTO flow_cards (
          stage, title, product_label, angle, format, objective, concept_json,
          creator_id, brief_id, group_key, source_winner_group_key, created_by
        ) VALUES (
          ${stage}, ${text(body.title, 300)}, ${text(body.product_label, 200)},
          ${text(body.angle, 200)}, ${text(body.format, 60)}, ${text(body.objective, 200)},
          ${body.concept_json ? JSON.stringify(body.concept_json) : null}::jsonb,
          ${body.creator_id ? Number(body.creator_id) : null},
          ${body.brief_id ? Number(body.brief_id) : null},
          ${text(body.group_key, 200)}, ${text(body.source_winner_group_key, 200)}, ${userId}
        )
        RETURNING id
      `;
      const [created] = await loadCards(sql).then(rows => rows.filter(r => r.id === card.id));
      return res.status(201).json({ card: created });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const id = Number(body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const [current] = await sql`SELECT * FROM flow_cards WHERE id = ${id}`;
      if (!current) return res.status(404).json({ error: 'Card not found' });
      const stage = body.stage !== undefined && STAGES.includes(body.stage) ? body.stage : current.stage;
      const u = (key, parse) => body[key] === undefined ? current[key] : parse(body[key]);
      await sql`
        UPDATE flow_cards SET
          stage = ${stage},
          title = ${u('title', v => text(v, 300))},
          product_label = ${u('product_label', v => text(v, 200))},
          angle = ${u('angle', v => text(v, 200))},
          format = ${u('format', v => text(v, 60))},
          objective = ${u('objective', v => text(v, 200))},
          creator_id = ${u('creator_id', v => v ? Number(v) : null)},
          brief_id = ${u('brief_id', v => v ? Number(v) : null)},
          deliverable_id = ${u('deliverable_id', v => v ? Number(v) : null)},
          ad_id = ${u('ad_id', v => text(v, 100))},
          group_key = ${u('group_key', v => text(v, 200))},
          archived = ${body.archived === undefined ? current.archived : !!body.archived},
          updated_at = now()
        WHERE id = ${id}
      `;
      const [updated] = await loadCards(sql).then(rows => rows.filter(r => r.id === id));
      return res.json({ card: updated || { id, stage, archived: !!body.archived } });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || req.body?.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE flow_cards SET archived = true, updated_at = now() WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('creative-flow error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
