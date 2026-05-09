// Per-image, per-feature anchor cache. Vision results and manual overrides
// both write here so re-renders are deterministic and corrections persist.
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const imageId = (req.query.image_id || '').trim();
      if (!imageId) return res.status(400).json({ error: 'image_id required' });
      const rows = await sql`
        SELECT id, image_id, feature_name, anchor_x, anchor_y, side, text_x, text_y, source, updated_at
        FROM callout_image_placements
        WHERE image_id = ${imageId}
        ORDER BY id ASC
      `;
      return res.json({ placements: rows });
    }

    if (req.method === 'POST') {
      // Upsert. Accepts a single placement or an array.
      const payload = req.body;
      const list = Array.isArray(payload) ? payload : [payload];
      const out = [];
      for (const p of list) {
        const { image_id, feature_name, anchor_x, anchor_y, side, text_x, text_y, source } = p || {};
        if (!image_id || !feature_name || anchor_x == null || anchor_y == null || !side) {
          return res.status(400).json({ error: 'image_id, feature_name, anchor_x, anchor_y, side required' });
        }
        const rows = await sql`
          INSERT INTO callout_image_placements
            (image_id, feature_name, anchor_x, anchor_y, side, text_x, text_y, source)
          VALUES
            (${image_id}, ${feature_name}, ${anchor_x}, ${anchor_y}, ${side},
             ${text_x ?? null}, ${text_y ?? null}, ${source || 'vision'})
          ON CONFLICT (image_id, feature_name) DO UPDATE SET
            anchor_x = EXCLUDED.anchor_x,
            anchor_y = EXCLUDED.anchor_y,
            side     = EXCLUDED.side,
            text_x   = EXCLUDED.text_x,
            text_y   = EXCLUDED.text_y,
            source   = EXCLUDED.source,
            updated_at = now()
          RETURNING id, image_id, feature_name, anchor_x, anchor_y, side, text_x, text_y, source, updated_at
        `;
        out.push(rows[0]);
      }
      return res.status(201).json({ placements: out });
    }

    if (req.method === 'DELETE') {
      // Clear all placements for an image (used by 'Re-run vision').
      const imageId = (req.query.image_id || '').trim();
      if (!imageId) return res.status(400).json({ error: 'image_id required' });
      await sql`DELETE FROM callout_image_placements WHERE image_id = ${imageId}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('callout-placements error', err);
    return res.status(500).json({ error: err.message });
  }
}
