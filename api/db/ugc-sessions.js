import {createSession} from '../_lib/session-creation.js';
import {videoSource,requirePrivateVideo} from '../_lib/private-video.js';
import { saveSessionEdits } from '../_lib/session-edits.js';
import { neon } from '@neondatabase/serverless';
import { requirePermission } from '../_lib/app-access.js';


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
        d.due_at AS deliverable_due_at,
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

    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const row = await ownRow(id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        return res.json({ session: row });
      }
      const limit = Math.min(parseInt(req.query.limit || '50'), 200);
      const rows = await sql`
        SELECT u.id, u.revision, u.title, u.file_name, u.file_size, u.duration, u.video_url,
          u.thumbnail_url, u.status, u.last_error, u.creator_id, u.brief_id, u.deliverable_id, u.rendered_url,
          u.source_type, u.source_label,
          u.created_at, u.updated_at, c.name AS creator_name,
          CASE WHEN jsonb_typeof(u.words) = 'array' THEN jsonb_array_length(u.words) ELSE 0 END AS word_count,
          b.title AS brief_title,
          d.title AS deliverable_title,
          d.status AS deliverable_status,
          d.due_at AS deliverable_due_at,
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
      const input=req.body || {};
      if (!input.video_url) return res.status(400).json({ error: 'video_url required' });
      try{if(videoSource(input.video_url).private)await requirePrivateVideo(sql,input.video_url,auth.userId);}
      catch(error){return res.status(error.statusCode || 400).json({error:error.message});}
      try{
        const session=await createSession(sql,auth,input);
        return res.status(201).json({session});
      }catch(error){if(error.statusCode)return res.status(error.statusCode).json({error:error.message});throw error;}
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
        'source_type',
        'source_label',
        'brief_id',
        'deliverable_id',
      ];
      const set = {};
      for (const k of allowed) if (k in fields) set[k] = fields[k];
      if (!Object.keys(set).length) return res.status(400).json({ error: 'no fields to update' });

      const expectedRevision = Number(fields.expected_revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || fields.expected_revision == null) {
        return res.status(428).json({ error: 'Reload the session before saving; expected_revision required' });
      }
      const saved = await saveSessionEdits(sql, id, set, expectedRevision);
      if (!saved) return res.status(409).json({ error: 'This session changed elsewhere. Reload it before saving.' });

      return res.json({ session: await ownRow(id) });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const owned = await ownRow(id);
      if (!owned) return res.status(404).json({ error: 'Not found' });
      // Sources and renders can remain referenced by deliverables and launches.
      // Physical cleanup must evaluate those references independently.
      await sql`DELETE FROM ugc_sessions WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('ugc-sessions error', err);
    return res.status(500).json({ error: err.message });
  }
}
