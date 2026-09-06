import { createHash } from 'node:crypto';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = value => createHash('sha256').update(stableJson(value)).digest('hex');

export async function ensureOperationJournal(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_operation_steps (
    operation_key TEXT NOT NULL, step_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', result JSONB, actor_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (operation_key, step_key)
  )`;
  await sql`ALTER TABLE app_operation_steps ADD COLUMN IF NOT EXISTS request_payload JSONB`;
}

export function operationKey(req, actorId, scope) {
  // Legacy clients get deterministic deduplication. Explicit request keys permit
  // intentionally repeating a launch; retrying must preserve the same key.
  const explicit = req.headers?.['idempotency-key'] || req.body?.request_key;
  return digest([scope, actorId, explicit || req.body]);
}

export async function runExternalStep(sql, { operationKey, stepKey, payload, actorId }, perform) {
  const hash = digest(payload);
  const [claim] = await sql`
    INSERT INTO app_operation_steps (operation_key, step_key, request_hash, actor_id, request_payload)
    VALUES (${operationKey}, ${stepKey}, ${hash}, ${actorId || null}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (operation_key,step_key) DO UPDATE SET status = 'pending', updated_at = now()
      WHERE app_operation_steps.status = 'rejected' AND app_operation_steps.request_hash = EXCLUDED.request_hash
    RETURNING operation_key
  `;
  if (!claim) {
    const [existing] = await sql`SELECT * FROM app_operation_steps WHERE operation_key = ${operationKey} AND step_key = ${stepKey}`;
    if (existing?.request_hash !== hash) throw Object.assign(new Error('The operation changed. Start a new request instead of retrying it.'), { statusCode: 409 });
    if (existing?.status === 'completed') return existing.result;
    throw Object.assign(new Error('This external action is running or its outcome is uncertain. Review its operation record before retrying.'), { statusCode: 409, operationKey });
  }
  try {
    const result = await perform();
    await sql`UPDATE app_operation_steps SET status = 'completed', result = ${JSON.stringify(result)}::jsonb, updated_at = now()
      WHERE operation_key = ${operationKey} AND step_key = ${stepKey}`;
    return result;
  } catch (error) {
    // A timeout or lost DB acknowledgement is NOT proof the provider did nothing.
    await sql`UPDATE app_operation_steps SET status = ${error.definitelyNotApplied ? 'rejected' : 'uncertain'}, updated_at = now()
      WHERE operation_key = ${operationKey} AND step_key = ${stepKey} AND status = 'pending'`.catch(() => {});
    throw error;
  }
}

export async function rememberProviderRead(sql, key, step, read) {
  const [cached] = await sql`SELECT result FROM app_operation_steps WHERE operation_key = ${key} AND step_key = ${step} AND status = 'completed'`;
  if (cached) return cached.result;
  const result = await read();
  const [saved] = await sql`INSERT INTO app_operation_steps (operation_key,step_key,request_hash,status,result)
    VALUES (${key},${step},${digest([key,step])},'completed',${JSON.stringify(result)}::jsonb)
    ON CONFLICT (operation_key,step_key) DO UPDATE SET operation_key = EXCLUDED.operation_key RETURNING result`;
  return saved.result;
}

export async function createMetaOperationFetch(sql, req, actorId, fetchImpl = globalThis.fetch) {
  await ensureOperationJournal(sql);
  const key = operationKey(req, actorId, 'meta');
  let step = 0;
  return async (url, init = {}) => {
    const target = new URL(url);
    if (target.hostname !== 'graph.facebook.com' || init.method !== 'POST'
      || !/\/(ads|adcreatives|campaigns|adsets)$/.test(target.pathname)) return fetchImpl(url, init);
    let payload = init.body instanceof URLSearchParams ? Object.fromEntries(init.body)
      : typeof init.body === 'string' ? JSON.parse(init.body) : {};
    payload = { ...payload }; delete payload.access_token;
    const result = await runExternalStep(sql, {
      operationKey: key, stepKey: `${++step}:${target.pathname}`, payload, actorId,
    }, async () => {
      const response = await fetchImpl(url, init);
      const body = await response.json();
      if (response.status >= 500) throw new Error('Meta returned an uncertain server failure; review the operation before retrying.');
      if (!response.ok && body.error && !body.id) throw Object.assign(new Error(body.error.message || 'Meta rejected this request'), { statusCode: response.status, definitelyNotApplied: true });
      return { status: response.status, body };
    });
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  };
}
