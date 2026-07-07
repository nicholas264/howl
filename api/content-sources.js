import { requirePermission } from './_lib/app-access.js';
import {
  ensureContentStudioTables,
  parseImportItems,
  rebuildSourceChunks,
  sourcePayload,
} from './_lib/content-studio.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  await ensureContentStudioTables(sql);

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          s.id, s.title, s.source_type, s.body, s.url, s.tags, s.created_at, s.updated_at,
          COUNT(c.id)::int AS chunk_count
        FROM content_sources s
        LEFT JOIN content_source_chunks c ON c.source_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC, s.created_at DESC
        LIMIT 500
      `;
      return res.json({ rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const action = req.body?.action || 'add';
    if (action === 'add') {
      const payload = sourcePayload(req.body);
      if (!payload.title || !payload.body) return res.status(400).json({ error: 'title and body required' });
      const [row] = await sql`
        INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
        VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url || null}, ${payload.tags}, ${access.userId})
        RETURNING *
      `;
      const chunkCount = await rebuildSourceChunks(sql, row);
      return res.json({ row: { ...row, chunk_count: chunkCount } });
    }

    if (action === 'bulk_import') {
      const items = parseImportItems(req.body);
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
      const rows = [];
      for (const item of items.slice(0, 100)) {
        const payload = sourcePayload(item);
        if (!payload.title || !payload.body) continue;
        const [row] = await sql`
          INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
          VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url || null}, ${payload.tags}, ${access.userId})
          RETURNING *
        `;
        const chunkCount = await rebuildSourceChunks(sql, row);
        rows.push({ ...row, chunk_count: chunkCount });
      }
      return res.json({ inserted: rows.length, rows });
    }

    if (action === 'delete') {
      const id = Number(req.body?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM content_sources WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
