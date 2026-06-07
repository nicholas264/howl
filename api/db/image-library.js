import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';
import { requireAuth } from '../_lib/auth.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const sql = neon(process.env.DATABASE_URL);
  const userId = auth.userId;

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit || '200'), 500);
      const rows = await sql`
        SELECT id, url, file_name, created_at
        FROM image_library
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return res.json({ images: rows });
    }

    if (req.method === 'POST') {
      const { url, file_name } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url required' });
      const rows = await sql`
        INSERT INTO image_library (user_id, url, file_name)
        VALUES (${userId}, ${url}, ${file_name || null})
        RETURNING id, url, file_name, created_at
      `;
      return res.status(201).json({ image: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT url FROM image_library WHERE id = ${id} AND user_id = ${userId} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      if (rows[0].url) {
        try { await del(rows[0].url); } catch (err) { console.error('blob del failed', err); }
      }
      await sql`DELETE FROM image_library WHERE id = ${id} AND user_id = ${userId}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('image-library error', err);
    return res.status(500).json({ error: err.message });
  }
}
