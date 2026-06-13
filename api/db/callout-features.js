// Per-product callout feature specs. Used to ground vision auto-placement
// and to store body copy so it persists between sessions.
import { neon } from '@neondatabase/serverless';
import { requirePermission } from '../_lib/app-access.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'assets.read' : 'assets.write');
  if (!access) return;
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const productId = (req.query.product_id || '').trim();
      if (!productId) return res.status(400).json({ error: 'product_id required' });
      const rows = await sql`
        SELECT id, product_id, feature_name, visual_description, typical_location, body_copy, updated_at
        FROM callout_feature_specs
        WHERE product_id = ${productId}
        ORDER BY id ASC
      `;
      return res.json({ specs: rows });
    }

    if (req.method === 'POST') {
      // Upsert. Accepts a single spec or an array.
      const payload = req.body;
      const list = Array.isArray(payload) ? payload : [payload];
      const out = [];
      for (const spec of list) {
        const { product_id, feature_name, visual_description, typical_location, body_copy } = spec || {};
        if (!product_id || !feature_name) {
          return res.status(400).json({ error: 'product_id and feature_name required' });
        }
        const rows = await sql`
          INSERT INTO callout_feature_specs (product_id, feature_name, visual_description, typical_location, body_copy)
          VALUES (${product_id}, ${feature_name}, ${visual_description || null}, ${typical_location || null}, ${body_copy || null})
          ON CONFLICT (product_id, feature_name) DO UPDATE SET
            visual_description = EXCLUDED.visual_description,
            typical_location = EXCLUDED.typical_location,
            body_copy = EXCLUDED.body_copy,
            updated_at = now()
          RETURNING id, product_id, feature_name, visual_description, typical_location, body_copy, updated_at
        `;
        out.push(rows[0]);
      }
      return res.status(201).json({ specs: out });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM callout_feature_specs WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('callout-features error', err);
    return res.status(500).json({ error: err.message });
  }
}
