import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function text(value, max = 1000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}
function num(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function dateOrNull(value) {
  const t = text(value, 40);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}
function status(value) {
  const allowed = new Set(['planned', 'ordered', 'in_transit', 'delivered', 'blocked']);
  const result = text(value, 40);
  return allowed.has(result) ? result : 'planned';
}

// Cost of a ledger row = unit COGS × qty + shipping + fee, computed on read.
function fetchRow(sql, id) {
  return sql`
    SELECT l.*, c.name AS creator_name,
      (l.unit_cogs * l.quantity)::float AS cogs_total,
      (l.unit_cogs * l.quantity + l.shipping_cost + l.creator_fee)::float AS total_cost
    FROM creator_seeding_log l JOIN creators c ON c.id = l.creator_id
    WHERE l.id = ${id}
  `.then(r => r[0]);
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql, userId } = access;

  try {
    await ensureCreatorOpsTables(sql);

    if (req.method === 'GET') {
      const units = await sql`SELECT unit_type, cogs::float AS cogs, active FROM seeding_units ORDER BY cogs DESC`;
      const rows = await sql`
        SELECT l.*, c.name AS creator_name,
          (l.unit_cogs * l.quantity)::float AS cogs_total,
          (l.unit_cogs * l.quantity + l.shipping_cost + l.creator_fee)::float AS total_cost
        FROM creator_seeding_log l
        JOIN creators c ON c.id = l.creator_id
        ORDER BY l.seeded_on DESC NULLS LAST, l.created_at DESC
        LIMIT 2000
      `;
      const rollup = await sql`
        SELECT
          to_char(date_trunc('month', seeded_on), 'YYYY-MM') AS month,
          count(DISTINCT creator_id)::int AS creators,
          COALESCE(SUM(quantity), 0)::int AS units,
          COALESCE(SUM(unit_cogs * quantity), 0)::float AS cogs,
          COALESCE(SUM(shipping_cost), 0)::float AS shipping,
          COALESCE(SUM(creator_fee), 0)::float AS fees,
          COALESCE(SUM(unit_cogs * quantity + shipping_cost + creator_fee), 0)::float AS total
        FROM creator_seeding_log
        WHERE seeded_on IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC
      `;
      return res.json({ rows, units, rollup });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const creatorId = Number(body.creator_id);
      if (!creatorId) return res.status(400).json({ error: 'creator_id required' });
      const unitType = text(body.unit_type, 60);
      const quantity = Math.max(1, num(body.quantity, 1));
      // Fall back to the catalog cost when no explicit unit_cogs is supplied.
      let unitCogs = num(body.unit_cogs);
      if (unitCogs === null && unitType) {
        const [u] = await sql`SELECT cogs::float AS cogs FROM seeding_units WHERE unit_type = ${unitType}`;
        unitCogs = u ? u.cogs : 0;
      }
      const [row] = await sql`
        INSERT INTO creator_seeding_log (
          creator_id, seeded_on, product_label, unit_type, quantity, unit_cogs,
          shipping_cost, creator_fee, seeding_status, agreed_deliverables, deliverable_due,
          usage_rights, notes, source, created_by
        ) VALUES (
          ${creatorId}, ${dateOrNull(body.seeded_on)}, ${text(body.product_label, 300)},
          ${unitType}, ${quantity}, ${unitCogs || 0},
          ${num(body.shipping_cost, 0)}, ${num(body.creator_fee, 0)}, ${status(body.seeding_status)},
          ${num(body.agreed_deliverables)}, ${dateOrNull(body.deliverable_due)},
          ${text(body.usage_rights, 500)}, ${text(body.notes, 2000)}, 'manual', ${userId}
        )
        RETURNING id
      `;
      return res.status(201).json({ row: await fetchRow(sql, row.id) });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      // Update a unit cost in the catalog.
      if (body.action === 'unit') {
        const unitType = text(body.unit_type, 60);
        if (!unitType) return res.status(400).json({ error: 'unit_type required' });
        await sql`
          INSERT INTO seeding_units (unit_type, cogs, active, updated_at)
          VALUES (${unitType}, ${num(body.cogs, 0)}, ${body.active !== false}, now())
          ON CONFLICT (unit_type) DO UPDATE SET cogs = EXCLUDED.cogs, active = EXCLUDED.active, updated_at = now()
        `;
        const units = await sql`SELECT unit_type, cogs::float AS cogs, active FROM seeding_units ORDER BY cogs DESC`;
        return res.json({ units });
      }
      // Edit a ledger row.
      const id = Number(body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const [current] = await sql`SELECT * FROM creator_seeding_log WHERE id = ${id}`;
      if (!current) return res.status(404).json({ error: 'Row not found' });
      const u = (key, parse) => body[key] === undefined ? current[key] : parse(body[key]);
      await sql`
        UPDATE creator_seeding_log SET
          seeded_on = ${u('seeded_on', dateOrNull)},
          product_label = ${u('product_label', v => text(v, 300))},
          unit_type = ${u('unit_type', v => text(v, 60))},
          quantity = ${u('quantity', v => Math.max(1, num(v, 1)))},
          unit_cogs = ${u('unit_cogs', v => num(v, 0))},
          shipping_cost = ${u('shipping_cost', v => num(v, 0))},
          creator_fee = ${u('creator_fee', v => num(v, 0))},
          seeding_status = ${u('seeding_status', status)},
          agreed_deliverables = ${u('agreed_deliverables', v => num(v))},
          deliverable_due = ${u('deliverable_due', dateOrNull)},
          usage_rights = ${u('usage_rights', v => text(v, 500))},
          notes = ${u('notes', v => text(v, 2000))},
          updated_at = now()
        WHERE id = ${id}
      `;
      return res.json({ row: await fetchRow(sql, id) });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || req.body?.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM creator_seeding_log WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('creator-seeding-log error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
