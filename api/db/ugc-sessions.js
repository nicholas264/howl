import { neon } from '@neondatabase/serverless';
import { del } from '@vercel/blob';
import { requirePermission } from '../_lib/app-access.js';
import { ensureCreatorOpsTables } from '../_lib/creator-ops.js';

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
  const auth = await requirePermission(req, res, req.method === 'GET' ? 'assets.read' : 'assets.write');
  if (!auth) return;
  const sql = neon(process.env.DATABASE_URL);
  const ownRow = async (id) => {
    const rows = await sql`
      SELECT u.*, c.name AS creator_name,
        CASE WHEN jsonb_typeof(u.words) = 'array' THEN jsonb_array_length(u.words) ELSE 0 END AS word_count,
        b.title AS brief_title,
        d.title AS deliverable_title,
        d.status AS deliverable_status,
        d.expected_asset_count,
        d.received_asset_count,
        d.completed_asset_count,
        d.shipped_asset_count
      FROM ugc_sessions u
      LEFT JOIN creators c ON c.id = u.creator_id
      LEFT JOIN creator_briefs b ON b.id = u.brief_id
      LEFT JOIN creator_deliverables d ON d.id = u.deliverable_id
      WHERE u.id = ${id}
      LIMIT 1
    `;
    return rows[0] || null;
  };

  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const row = await ownRow(id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json({ session: row });
      }
      const limit = Math.min(parseInt(req.query.limit || '50'), 200);
      const rows = await sql`
        SELECT u.id, u.title, u.file_name, u.file_size, u.duration, u.video_url,
          u.thumbnail_url, u.status, u.last_error, u.creator_id, u.brief_id, u.deliverable_id, u.rendered_url,
          u.created_at, u.updated_at, c.name AS creator_name,
          CASE WHEN jsonb_typeof(u.words) = 'array' THEN jsonb_array_length(u.words) ELSE 0 END AS word_count,
          b.title AS brief_title,
          d.title AS deliverable_title,
          d.status AS deliverable_status,
          d.expected_asset_count,
          d.received_asset_count,
          d.completed_asset_count,
          d.shipped_asset_count
        FROM ugc_sessions u
        LEFT JOIN creators c ON c.id = u.creator_id
        LEFT JOIN creator_briefs b ON b.id = u.brief_id
        LEFT JOIN creator_deliverables d ON d.id = u.deliverable_id
        ORDER BY u.updated_at DESC
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
        creator_id,
        brief_id,
        deliverable_id,
      } = req.body || {};
      if (!video_url) return res.status(400).json({ error: 'video_url required' });
      const rows = await sql`
        INSERT INTO ugc_sessions (user_id, title, file_name, file_size, duration, video_url, words, settings, thumbnail_url, status, creator_id, brief_id, deliverable_id)
        VALUES (
          ${auth.userId},
          ${title || file_name || 'Untitled session'},
          ${file_name || null},
          ${file_size || null},
          ${duration || null},
          ${video_url},
          ${words ? JSON.stringify(words) : null},
          ${settings ? JSON.stringify(settings) : null},
          ${thumbnail_url || null},
          ${status || 'uploaded'},
          ${Number(creator_id) || null},
          ${Number(brief_id) || null},
          ${Number(deliverable_id) || null}
        )
        RETURNING *
      `;
      return res.status(201).json({ session: rows[0] });
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const owned = await ownRow(id);
      if (!owned) return res.status(404).json({ error: 'Not found' });
      const fields = req.body || {};
      const allowed = [
        'title',
        'duration',
        'words',
        'settings',
        'audio_url',
        'thumbnail_url',
        'status',
        'creator_id',
        'brief_id',
        'deliverable_id',
      ];
      const set = {};
      for (const k of allowed) if (k in fields) set[k] = fields[k];
      if (!Object.keys(set).length) return res.status(400).json({ error: 'no fields to update' });

      if ('title' in set) await sql`UPDATE ugc_sessions SET title = ${set.title}, updated_at = now() WHERE id = ${id}`;
      if ('duration' in set) await sql`UPDATE ugc_sessions SET duration = ${set.duration}, updated_at = now() WHERE id = ${id}`;
      if ('words' in set) await sql`UPDATE ugc_sessions SET words = ${JSON.stringify(set.words)}, updated_at = now() WHERE id = ${id}`;
      if ('settings' in set) await sql`UPDATE ugc_sessions SET settings = ${JSON.stringify(set.settings)}, updated_at = now() WHERE id = ${id}`;
      if ('audio_url' in set) await sql`UPDATE ugc_sessions SET audio_url = ${set.audio_url}, updated_at = now() WHERE id = ${id}`;
      if ('thumbnail_url' in set) await sql`UPDATE ugc_sessions SET thumbnail_url = ${set.thumbnail_url}, updated_at = now() WHERE id = ${id}`;
      if ('status' in set) await sql`UPDATE ugc_sessions SET status = ${set.status}, updated_at = now() WHERE id = ${id}`;
      if ('creator_id' in set) await sql`UPDATE ugc_sessions SET creator_id = ${Number(set.creator_id) || null}, updated_at = now() WHERE id = ${id}`;
      if ('brief_id' in set) await sql`UPDATE ugc_sessions SET brief_id = ${Number(set.brief_id) || null}, updated_at = now() WHERE id = ${id}`;
      if ('deliverable_id' in set) await sql`UPDATE ugc_sessions SET deliverable_id = ${Number(set.deliverable_id) || null}, updated_at = now() WHERE id = ${id}`;

      return res.json({ session: await ownRow(id) });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const owned = await ownRow(id);
      if (!owned) return res.status(404).json({ error: 'Not found' });
      const urls = [owned.video_url, owned.audio_url, owned.rendered_url].filter(Boolean);
      for (const url of urls) {
        try { await del(url); } catch (err) { console.error('blob del failed', url, err); }
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
