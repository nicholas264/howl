import { blankWorkspace, normalizeWorkspace } from '../../src/lib/static-studio/model.js';
export async function ensureStudioTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS static_studios (
    user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
export async function loadStudio(sql,userId) {
  await ensureStudioTables(sql);
  const [row]=await sql`SELECT revision,payload,updated_at FROM static_studios WHERE user_id=${userId}`;
  return row || {revision:0,payload:blankWorkspace(),updated_at:null};
}
export async function saveStudio(sql,userId,payload,revision) {
  if(!Number.isInteger(revision) || revision<0) throw new Error('Expected revision required.');
  const normalized=normalizeWorkspace(payload);
  await ensureStudioTables(sql);
  let rows;
  if(revision===0) rows=await sql`INSERT INTO static_studios(user_id,payload) VALUES(${userId},${JSON.stringify(normalized)}::jsonb)
    ON CONFLICT DO NOTHING RETURNING revision,payload,updated_at`;
  else rows=await sql`UPDATE static_studios SET payload=${JSON.stringify(normalized)}::jsonb,revision=revision+1,updated_at=now()
    WHERE user_id=${userId} AND revision=${revision} RETURNING revision,payload,updated_at`;
  if(!rows.length) {const error=new Error('This studio changed in another tab. Reload before saving to avoid overwriting that work.');error.status=409;throw error;}
  return rows[0];
}
