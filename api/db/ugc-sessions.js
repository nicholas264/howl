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
        const rows = await sql`SELECT * FROM ugc_sessions WHERE id = ${id} LIMIT 1`;
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        return res.json({ session: rows[0] });
      }
      const limit = Math.min(parseInt(req.query.limit || '50'), 200);
      const rows = await sql`
        SELECT id, title, file_name, file_size, duration, video_url, thumbnail_url, status, created_at, updated_at
        FROM ugc_sessions
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
      return res.json({ sessions: rows });
    }

    if (req.method === 'POST') {
      const {
        title,
        file_name,
        file_size,
        video_url,
        duration,
        words,
        settings,
        thumbnail_url,
        status,
      } = req.body || {};
      if (!video_url) return res.status(400).json({ error: 'video_url required' });
      const rows = await sql`
        INSERT INTO ugc_sessions (user_id, title, file_name, file_size, duration, video_url, words, settings, thumbnail_url, status)
        VALUES (
          ${userId},
          ${title || file_name || 'Untitled session'},
          ${file_name || null},
          ${file_size || null},
          ${duration || null},
          ${video_url},
          ${words ? JSON.stringify(words) : null},
          ${settings ? JSON.stringify(settings) : null},
          ${thumbnail_url || null},
          ${status || 'uploaded'}
        )
        RETURNING *
      `;
      return res.status(201).json({ session: rows[0] });
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const fields = req.body || {};
      const allowed = ['title', 'duration', 'words', 'settings', 'audio_url', 'thumbnail_url', 'status'];
      const set = {};
      for (const k of allowed) if (k in fields) set[k] = fields[k];
      if (!Object.keys(set).length) return res.status(400).json({ error: 'no fields to update' });

      // Build a single UPDATE — neon's tagged template doesn't support dynamic SET clauses,
      // so we apply each column via separate queries inside a transaction-like sequence.
      // (Idempotent enough for autosave; adopt sql.transaction() if it ever matters.)
      if ('title' in set) await sql`UPDATE ugc_sessions SET title = ${set.title}, updated_at = now() WHERE id = ${id}`;
      if ('duration' in set) await sql`UPDATE ugc_sessions SET duration = ${set.duration}, updated_at = now() WHERE id = ${id}`;
      if ('words' in set) await sql`UPDATE ugc_sessions SET words = ${JSON.stringify(set.words)}, updated_at = now() WHERE id = ${id}`;
      if ('settings' in set) await sql`UPDATE ugc_sessions SET settings = ${JSON.stringify(set.settings)}, updated_at = now() WHERE id = ${id}`;
      if ('audio_url' in set) await sql`UPDATE ugc_sessions SET audio_url = ${set.audio_url}, updated_at = now() WHERE id = ${id}`;
      if ('thumbnail_url' in set) await sql`UPDATE ugc_sessions SET thumbnail_url = ${set.thumbnail_url}, updated_at = now() WHERE id = ${id}`;
      if ('status' in set) await sql`UPDATE ugc_sessions SET status = ${set.status}, updated_at = now() WHERE id = ${id}`;

      const rows = await sql`SELECT * FROM ugc_sessions WHERE id = ${id} LIMIT 1`;
      return res.json({ session: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await sql`SELECT video_url, audio_url FROM ugc_sessions WHERE id = ${id} LIMIT 1`;
      if (rows.length) {
        const urls = [rows[0].video_url, rows[0].audio_url].filter(Boolean);
        for (const url of urls) {
          try { await del(url); } catch (err) { console.error('blob del failed', url, err); }
        }
      }
      await sql`DELETE FROM ugc_sessions WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('ugc-sessions error', err);
    return res.status(500).json({ error: err.message });
  }
}
