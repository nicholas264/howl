import { neon } from '@neondatabase/serverless';
import { requirePermission } from '../_lib/app-access.js';

let schemaReady = null;

function normalizeProductIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(id => String(id || '').trim()).filter(Boolean))];
}

function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = sql`ALTER TABLE copy_library ADD COLUMN IF NOT EXISTS product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`
      .catch(err => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write'))) return;
  const sql = neon(process.env.DATABASE_URL);

  try {
    await ensureSchema(sql);
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, label, headline, primary_text, product_ids, created_at FROM copy_library ORDER BY created_at DESC LIMIT 500`;
      return res.json({ rows });
    }

    if (req.method === 'POST') {
      const { action, id, label, headline, primaryText, productIds } = req.body || {};
      if (action === 'add') {
        if (!headline?.trim() && !primaryText?.trim()) return res.status(400).json({ error: 'headline or primaryText required' });
        const normalizedProductIds = normalizeProductIds(productIds);
        const rows = await sql`
          INSERT INTO copy_library (label, headline, primary_text, product_ids)
          VALUES (${label || null}, ${headline || null}, ${primaryText || null}, ${JSON.stringify(normalizedProductIds)}::jsonb)
          RETURNING id, label, headline, primary_text, product_ids, created_at
        `;
        return res.json({ row: rows[0] });
      }
      if (action === 'update_products') {
        if (!id) return res.status(400).json({ error: 'id required' });
        const normalizedProductIds = normalizeProductIds(productIds);
        const rows = await sql`
          UPDATE copy_library
          SET product_ids = ${JSON.stringify(normalizedProductIds)}::jsonb
          WHERE id = ${id}
          RETURNING id, label, headline, primary_text, product_ids, created_at
        `;
        if (!rows[0]) return res.status(404).json({ error: 'copy option not found' });
        return res.json({ row: rows[0] });
      }
      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'id required' });
        await sql`DELETE FROM copy_library WHERE id = ${id}`;
        return res.json({ ok: true });
      }
      if (action === 'bulk_import') {
        const { items } = req.body || {};
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
        let inserted = 0;
        for (const it of items) {
          if (!it.headline && !it.primaryText) continue;
          const normalizedProductIds = normalizeProductIds(it.productIds);
          await sql`
            INSERT INTO copy_library (label, headline, primary_text, product_ids)
            VALUES (${it.label || null}, ${it.headline || null}, ${it.primaryText || null}, ${JSON.stringify(normalizedProductIds)}::jsonb)
          `;
          inserted++;
        }
        return res.json({ inserted });
      }
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
