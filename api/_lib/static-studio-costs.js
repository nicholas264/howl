import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, STUDIO_MODELS, RATE_VERSION, validateSettings, modelForAction, providerKey, modelRequest, priceUsage, parseModelResult, providerError } from './static-studio-models.js';
import { recordProviderUsage } from './work-controls.js';
export async function ensureStudioCosts(sql) {
  await sql`CREATE TABLE IF NOT EXISTS static_studio_settings (user_id TEXT PRIMARY KEY, settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS static_studio_usage (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,work_id TEXT,stage TEXT NOT NULL,model TEXT NOT NULL,reported_model TEXT,
    provider TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',input_tokens BIGINT,output_tokens BIGINT,cached_tokens BIGINT,
    cost_usd NUMERIC,rate_version TEXT NOT NULL,http_status INTEGER,error_message TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_studio_usage_user_date ON static_studio_usage(user_id,created_at)`;
}
export async function loadModelSettings(sql,userId) {
  const [row]=await sql`SELECT settings FROM static_studio_settings WHERE user_id=${userId}`;
  return row?validateSettings(row.settings):{...DEFAULT_SETTINGS};
}
export async function saveModelSettings(sql,userId,value) {
  const settings=validateSettings(value);
  await sql`INSERT INTO static_studio_settings(user_id,settings) VALUES(${userId},${JSON.stringify(settings)}::jsonb)
    ON CONFLICT(user_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()`;
  return settings;
}
export async function askStudioModel(access,action,system,content,maxTokens=2000,{fetchImpl=globalThis.fetch,env=process.env}={}) {
  const settings=await loadModelSettings(access.sql,access.userId),model=modelForAction(settings,action);
  const {url,init}=modelRequest(model,system,content,maxTokens,env),id=randomUUID(),spec=STUDIO_MODELS[model];
  // Persist intent BEFORE any paid request. A lost response must not look like $0.
  await access.sql`INSERT INTO static_studio_usage(id,user_id,work_id,stage,model,provider,rate_version)
    VALUES(${id},${access.userId},${access.workId || null},${action},${model},${spec.provider},${RATE_VERSION})`;
  let response,data,priced=null;
  try {
    response=await fetchImpl(url,{...init,signal:AbortSignal.timeout(230000)});
    data=await response.json();
    // Unknown fallback models must never be priced as the requested model.
    const reported=data.model || model;
    const failure=response.ok?null:providerError(response.status,data);
    const rateModel=Object.keys(STUDIO_MODELS).find(m=>reported===m || new RegExp(`^${m}-\\d{4}-\\d{2}-\\d{2}$`).test(reported));
    priced=priceUsage(rateModel,data.usage);
    await access.sql`UPDATE static_studio_usage SET reported_model=${reported},status=${response.ok?'received':'failed'},
      input_tokens=${priced?.inputTokens ?? null},output_tokens=${priced?.outputTokens ?? null},cached_tokens=${priced?.cachedTokens ?? null},
      cost_usd=${priced?.costUsd ?? null},error_message=${failure},http_status=${response.status},finished_at=now() WHERE id=${id}`;
    if(access.workId && priced)await recordProviderUsage(access.sql,access.workId,{provider:spec.provider,model:reported,...priced});
    if(!response.ok)throw new Error(failure);
    const result=parseModelResult(model,data);
    await access.sql`UPDATE static_studio_usage SET status='completed' WHERE id=${id}`;
    return result;
  } catch(error) {
    await access.sql`UPDATE static_studio_usage SET status=${response?'failed':'unknown'},finished_at=now() WHERE id=${id}`.catch(()=>{});
    if(!response)throw new Error('The provider response was not received. Usage may still be billed; check Costs & models before retrying.');
    throw error;
  }
}
export async function studioCosts(sql,userId,month,env=process.env) {
  const settings=await loadModelSettings(sql,userId);
  const selected=month || new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || Number(selected.slice(0,4))<2020 || Number(selected.slice(0,4))>2100)throw new Error('Choose a valid month.');
  const start=`${selected}-01T00:00:00Z`;
  const [summary]=await sql`SELECT count(*)::int AS requests,COALESCE(sum(cost_usd),0)::float8 AS cost,
    count(*) FILTER(WHERE cost_usd IS NULL)::int AS unknown,
    count(*) FILTER(WHERE status='completed')::int AS completed
    FROM static_studio_usage WHERE user_id=${userId} AND created_at>=${start}::timestamptz AND created_at<${start}::timestamptz+interval '1 month'`;
  const breakdown=await sql`SELECT stage,model,count(*)::int AS requests,COALESCE(sum(cost_usd),0)::float8 AS cost,
    count(*) FILTER(WHERE cost_usd IS NULL)::int AS unknown FROM static_studio_usage
    WHERE user_id=${userId} AND created_at>=${start}::timestamptz AND created_at<${start}::timestamptz+interval '1 month' GROUP BY stage,model ORDER BY cost DESC`;
  const recent=await sql`SELECT id,stage,model,reported_model,status,input_tokens,output_tokens,cached_tokens,cost_usd,rate_version,error_message,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM static_studio_usage WHERE user_id=${userId} AND created_at>=${start}::timestamptz AND created_at<${start}::timestamptz+interval '1 month'
    ORDER BY created_at DESC,id DESC LIMIT 100`;
  return {month:selected,settings,summary,breakdown,recent,models:Object.entries(STUDIO_MODELS).map(([id,m])=>({id,...m,configured:!!providerKey(id,env)})),rateVersion:RATE_VERSION};
}
