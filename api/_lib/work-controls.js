import { randomUUID } from 'node:crypto';

export async function ensureWorkControls(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_work_lanes (kind TEXT PRIMARY KEY, leases JSONB NOT NULL DEFAULT '[]'::jsonb)`;
  await sql`CREATE TABLE IF NOT EXISTS app_work_runs (
    id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    provider TEXT, model TEXT, input_tokens BIGINT, output_tokens BIGINT, media_seconds NUMERIC, cost_usd NUMERIC,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ, http_status INTEGER
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_app_work_runs_started ON app_work_runs(started_at)`;
}

export async function claimWork(sql, kind, actorId, {globalLimit=8,userLimit=3,ttlSeconds=330} = {}) {
  const id=randomUUID();
  await ensureWorkControls(sql);
  await sql`INSERT INTO app_work_lanes (kind) VALUES (${kind}) ON CONFLICT DO NOTHING`;
  const [claimed]=await sql`
    UPDATE app_work_lanes lane SET leases = COALESCE((
      SELECT jsonb_agg(item) FROM jsonb_array_elements(lane.leases) item WHERE (item->>'expires_at')::timestamptz > now()
    ),'[]'::jsonb) || jsonb_build_array(jsonb_build_object('id',${id}::text,'actor_id',${actorId}::text,'expires_at',now()+make_interval(secs=>${ttlSeconds})))
    WHERE kind = ${kind}
      AND (SELECT count(*) FROM jsonb_array_elements(lane.leases) item WHERE (item->>'expires_at')::timestamptz > now()) < ${globalLimit}
      AND (SELECT count(*) FROM jsonb_array_elements(lane.leases) item WHERE (item->>'expires_at')::timestamptz > now() AND item->>'actor_id' = ${actorId}) < ${userLimit}
    RETURNING kind
  `;
  if (!claimed) return null;
  try {
    await sql`INSERT INTO app_work_runs (id,actor_id,kind) VALUES (${id},${actorId},${kind})`;
    return id;
  } catch(error) {await finishWork(sql,id,kind,503).catch(()=>{});throw error;}
}

export async function finishWork(sql,id,kind,statusCode,{costUsd=null,provider=null}={}) {
  await sql`UPDATE app_work_lanes SET leases=COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(leases) item
    WHERE item->>'id' <> ${id} AND (item->>'expires_at')::timestamptz > now()),'[]'::jsonb) WHERE kind = ${kind}`;
  await sql`UPDATE app_work_runs SET status=${statusCode < 400 ? 'completed':'failed'},http_status=${statusCode},finished_at=now(),
      cost_usd=COALESCE(${costUsd}::numeric,cost_usd),provider=COALESCE(${provider}::text,provider)
    WHERE id=${id} AND status='running'`;
}

export async function recoverExpiredWork(sql) {
  await ensureWorkControls(sql);
  // A lost process is not proof of provider failure or zero spend.
  return sql`UPDATE app_work_runs run SET status='unknown',finished_at=now()
    WHERE status='running' AND started_at<now()-interval '6 minutes'
      AND NOT EXISTS (SELECT 1 FROM app_work_lanes lane CROSS JOIN LATERAL jsonb_array_elements(lane.leases) item
        WHERE item->>'id'=run.id AND (item->>'expires_at')::timestamptz>now()) RETURNING id`;
}

export async function recordProviderUsage(sql,id,{provider,model,inputTokens=0,outputTokens=0,mediaSeconds=null,costUsd=null}) {
  await sql`UPDATE app_work_runs SET provider=${provider},model=${model || null},
    input_tokens=COALESCE(input_tokens,0)+${inputTokens},output_tokens=COALESCE(output_tokens,0)+${outputTokens},
    media_seconds=COALESCE(media_seconds,0)+${mediaSeconds || 0},
    cost_usd=CASE WHEN ${costUsd}::numeric IS NULL THEN cost_usd ELSE COALESCE(cost_usd,0)+${costUsd} END
    WHERE id=${id}`;
}
