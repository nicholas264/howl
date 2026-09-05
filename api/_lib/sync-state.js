import { randomUUID } from 'node:crypto';

export async function ensureSyncState(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_sync_state (
    name TEXT PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}'::jsonb,
    lease_token TEXT, lease_until TIMESTAMPTZ, last_completed_at TIMESTAMPTZ,
    last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
export async function claimSync(sql, name, initial, force = false) {
  await ensureSyncState(sql);
  await sql`INSERT INTO app_sync_state (name) VALUES (${name}) ON CONFLICT DO NOTHING`;
  const token = randomUUID();
  const [row] = await sql`
    UPDATE app_sync_state SET lease_token = ${token}, lease_until = now()+interval '6 minutes',
      state = CASE WHEN state->>'phase' IS NULL OR state->>'phase' = 'done' THEN ${JSON.stringify(initial)}::jsonb ELSE state END,
      last_error = NULL, updated_at = now()
    WHERE name = ${name} AND (lease_until IS NULL OR lease_until < now())
      AND (${force} OR last_completed_at IS NULL OR last_completed_at < now()-interval '10 minutes' OR state->>'phase' <> 'done')
    RETURNING *
  `;
  return row ? { ...row, token } : null;
}
export async function checkpointSync(sql, job, state, complete = false) {
  const [row] = await sql`UPDATE app_sync_state
    SET state = ${JSON.stringify(state)}::jsonb,
        lease_until = now()+interval '6 minutes',
        last_completed_at = CASE WHEN ${complete} THEN now() ELSE last_completed_at END, updated_at = now()
    WHERE name = ${job.name} AND lease_token = ${job.token}
    RETURNING name`;
  if (!row) throw new Error('Sync lease lost; another worker owns this run.');
}
export async function releaseSync(sql, job, error = null) {
  await sql`UPDATE app_sync_state SET lease_token = NULL, lease_until = NULL, last_error = ${error}, updated_at = now()
    WHERE name = ${job.name} AND lease_token = ${job.token}`;
}

export function withoutAccessToken(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') throw new Error('Invalid Meta pagination URL');
  url.searchParams.delete('access_token');
  return url.toString();
}
export function withAccessToken(value, accessToken) {
  const url = new URL(withoutAccessToken(value));
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}
