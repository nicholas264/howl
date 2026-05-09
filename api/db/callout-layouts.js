import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';
import { requireAuth } from '../_lib/auth.js';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const sql = neon(process.env.DATABASE_URL);
  const userId = auth.userId;

  try {
    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const rows = await sql`SELECT * FROM callout_layouts WHERE id = ${id} LIMIT 1`;
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        return res.json({ layout: rows[0] });
      }
      const limit = Math.min(parseInt(req.query.limit || '100'), 300);
      const rows = await sql`
        SELECT id, product_id, format, title, subtitle, image_url, thumb_url, created_at, updated_at
        FROM callout_layouts
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
      return res.json({ layouts: rows });
    }

    if (req.method === 'POST') {
      const { product_id, format, title, subtitle, title_pos, callouts, image_url, thumb_url } = req.body || {};
      const rows = await sql`
        INSERT INTO callout_layouts (user_id, product_id, format, title, subtitle, title_pos, callouts, image_url, thumb_url)
        VALUES (
          ${userId},
          ${product_id || null},
          ${format || null},
          ${title || null},
          ${subtitle || null},
          ${title_pos ? JSON.stringify(title_pos) : null},
          ${callouts ? JSON.stringify(callouts) : null},
          ${image_url || null},
          ${thumb_url || null}
        )
        RETURNING *
      `;
      return res.status(201).json({ layout: rows[0] });
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const fields = req.body || {};
      if ('product_id' in fields) await sql`UPDATE callout_layouts SET product_id = ${fields.product_id}, updated_at = now() WHERE id = ${id}`;
      if ('format' in fields) await sql`UPDATE callout_layouts SET format = ${fields.format}, updated_at = now() WHERE id = ${id}`;
      if ('title' in fields) await sql`UPDATE callout_layouts SET title = ${fields.title}, updated_at = now() WHERE id = ${id}`;
      if ('subtitle' in fields) await sql`UPDATE callout_layouts SET subtitle = ${fields.subtitle}, updated_at = now() WHERE id = ${id}`;
      if ('title_pos' in fields) await sql`UPDATE callout_layouts SET title_pos = ${JSON.stringify(fields.title_pos)}, updated_at = now() WHERE id = ${id}`;
      if ('callouts' in fields) await sql`UPDATE callout_layouts SET callouts = ${JSON.stringify(fields.callouts)}, updated_at = now() WHERE id = ${id}`;
      if ('image_url' in fields) await sql`UPDATE callout_layouts SET image_url = ${fields.image_url}, updated_at = now() WHERE id = ${id}`;
      if ('thumb_url' in fields) await sql`UPDATE callout_layouts SET thumb_url = ${fields.thumb_url}, updated_at = now() WHERE id = ${id}`;

      const rows = await sql`SELECT * FROM callout_layouts WHERE id = ${id} LIMIT 1`;
      return res.json({ layout: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT image_url FROM callout_layouts WHERE id = ${id} LIMIT 1`;
      if (rows.length && rows[0].image_url) {
        // Only orphan-delete the blob if no callout_images library record holds it.
        const refs = await sql`SELECT 1 FROM callout_images WHERE url = ${rows[0].image_url} LIMIT 1`;
        if (!refs.length) {
          try { await del(rows[0].image_url); } catch (err) { console.error('blob del failed', err); }
        }
      }
      await sql`DELETE FROM callout_layouts WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('callout-layouts error', err);
    return res.status(500).json({ error: err.message });
  }
}
