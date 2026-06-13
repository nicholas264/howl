import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';
import { requirePermission } from '../_lib/app-access.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const auth = await requirePermission(req, res, req.method === 'GET' ? 'assets.read' : 'assets.write');
  if (!auth) return;
  const sql = neon(process.env.DATABASE_URL);
  const userId = auth.userId;

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit || '200'), 500);
      const productId = (req.query.product_id || '').trim();
      const rows = productId
        ? await sql`
            SELECT id, product_id, url, file_name, created_at
            FROM callout_images
            WHERE user_id = ${userId} AND product_id = ${productId}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT id, product_id, url, file_name, created_at
            FROM callout_images
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
      return res.json({ images: rows });
    }

    if (req.method === 'POST') {
      const { url, product_id, file_name } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url required' });
      const rows = await sql`
        INSERT INTO callout_images (user_id, product_id, url, file_name)
        VALUES (${userId}, ${product_id || null}, ${url}, ${file_name || null})
        RETURNING id, product_id, url, file_name, created_at
      `;
      return res.status(201).json({ image: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT url FROM callout_images WHERE id = ${id} AND user_id = ${userId} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      if (rows[0].url) {
        try { await del(rows[0].url); } catch (err) { console.error('blob del failed', err); }
      }
      await sql`DELETE FROM callout_images WHERE id = ${id} AND user_id = ${userId}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('callout-images error', err);
    return res.status(500).json({ error: err.message });
  }
}
