export async function ensureLaunchDrafts(sql) {
  await sql`CREATE TABLE IF NOT EXISTS launch_drafts (
    id TEXT PRIMARY KEY, payload JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

export async function saveLaunchDraft(sql, id, payload, revision, actor) {
  if (revision === null) {
    const [row] = await sql`INSERT INTO launch_drafts (id,payload,created_by,updated_by)
      VALUES (${id},${JSON.stringify(payload)}::jsonb,${actor},${actor}) ON CONFLICT DO NOTHING RETURNING *`;
    return row || null;
  }
  const [row] = await sql`UPDATE launch_drafts SET payload = ${JSON.stringify(payload)}::jsonb,
    revision = revision+1, updated_by = ${actor}, updated_at = now()
    WHERE id = ${id} AND revision = ${revision} RETURNING *`;
  return row || null;
}
