import { requireWorkspaceAccess, hasPermission } from './_lib/app-access.js';
import { ensureLaunchDrafts, saveLaunchDraft } from './_lib/launch-drafts.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
export default async function handler(req, res) {
  const access = await requireWorkspaceAccess(req,res);
  if (!access) return;
  const write = req.method !== 'GET';
  if (!(hasPermission(access, write ? 'assets.write' : 'assets.read') || hasPermission(access, write ? 'launch.write' : 'launch.read'))) return res.status(403).json({ error: 'Draft access required' });
  try {
    await ensureLaunchDrafts(access.sql);
    if (req.method === 'GET') {
      const cursor=typeof req.query?.cursor==='string'?req.query.cursor:'';
      if(cursor.length>100)return res.status(400).json({error:'Invalid draft cursor'});
      const rows = await access.sql`SELECT * FROM launch_drafts WHERE id>${cursor} ORDER BY id LIMIT 201`;
      return res.json({ drafts: rows.slice(0,200),next_cursor:rows.length>200?rows[199].id:null });
    }
    const { id, payload, expected_revision: revision } = req.body || {};
    if (!id || String(id).length > 100) return res.status(400).json({ error: 'Valid draft id required' });
    if (revision !== null && (!Number.isInteger(revision) || revision < 0)) return res.status(428).json({ error: 'expected_revision required' });
    if (req.method === 'PUT') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ error: 'Draft payload required' });
      const containsLocalMedia=value=>typeof value==='string'?/^(?:data:|blob:)/i.test(value)
        :value && typeof value==='object' && Object.values(value).some(containsLocalMedia);
      if (containsLocalMedia(payload)) return res.status(400).json({ error: 'Upload draft media before saving across devices' });
      if(String(payload.id)!==String(id))return res.status(400).json({error:'Draft identity must match its payload'});
      const saved = await saveLaunchDraft(access.sql,String(id),payload,revision,access.userId);
      return saved ? res.json({ draft: saved }) : res.status(409).json({ error: 'This draft changed on another device. Reload drafts before editing.' });
    }
    if (req.method === 'DELETE') {
      const rows = await access.sql`DELETE FROM launch_drafts WHERE id = ${String(id)} AND revision = ${revision} RETURNING id`;
      return rows.length ? res.json({ ok:true }) : res.status(409).json({ error: 'Draft changed or was removed. Reload drafts.' });
    }
    return res.status(405).end();
  } catch(error) { return res.status(500).json({error:error.message}); }
}
