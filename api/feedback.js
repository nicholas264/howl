import { neon } from '@neondatabase/serverless';
import { requireAuth } from './_lib/auth.js';
import { ensureAppTables, requirePermission } from './_lib/app-access.js';

const KINDS = new Set(['bug', 'feature', 'edge_case']);
const STATUSES = new Set(['open', 'planned', 'resolved', 'dismissed']);

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'POST') {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const { kind, message, page_url } = req.body || {};
    if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be bug | feature | edge_case' });
    const msg = (message || '').toString().trim();
    if (!msg) return res.status(400).json({ error: 'message required' });
    if (msg.length > 5000) return res.status(400).json({ error: 'message too long (max 5000)' });
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 500);
    try {
      await ensureAppTables(sql);
      const [row] = await sql`
        INSERT INTO feedback (user_id, email, kind, message, page_url, user_agent)
        VALUES (${auth.userId}, ${auth.email || null}, ${kind}, ${msg}, ${(page_url || '').toString().slice(0, 500) || null}, ${userAgent || null})
        RETURNING id, created_at
      `;
      return res.json({ ok: true, id: row.id, created_at: row.created_at });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    const access = await requirePermission(req, res, 'admin.users');
    if (!access) return;
    try {
      await ensureAppTables(access.sql);
      const status = (req.query.status || '').toString();
      const limit = Math.min(parseInt(req.query.limit || '200'), 1000);
      const rows = status
        ? await access.sql`SELECT * FROM feedback WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`
        : await access.sql`SELECT * FROM feedback ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json({ rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const access = await requirePermission(req, res, 'admin.users');
    if (!access) return;
    const { id, status } = req.body || {};
    if (!id || !STATUSES.has(status)) return res.status(400).json({ error: 'Valid id and status required' });
    try {
      await ensureAppTables(access.sql);
      await access.sql`UPDATE feedback SET status = ${status} WHERE id = ${id}`;
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
