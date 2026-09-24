import { randomUUID } from 'node:crypto';
import { digest } from './operation-journal.js';
import { parseStudioOutput, validateStudioBrief, BREAKDOWN_LABELS } from './script-studio.js';

export async function ensureScriptStudio(sql) {
  await sql`CREATE TABLE IF NOT EXISTS script_studio_scripts (
    id UUID PRIMARY KEY, parent_id UUID REFERENCES script_studio_scripts(id),
    title TEXT NOT NULL, product TEXT NOT NULL, delivery TEXT NOT NULL,
    brief JSONB NOT NULL, script JSONB NOT NULL, content_hash TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(created_by, content_hash)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS script_studio_created ON script_studio_scripts(created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS script_studio_ads (
    ad_id TEXT PRIMARY KEY, script_id UUID NOT NULL REFERENCES script_studio_scripts(id),
    hook_variant TEXT NOT NULL CHECK (hook_variant IN ('primary','first','second','third','custom')),
    linked_by TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS script_studio_ad_script ON script_studio_ads(script_id)`;
}
export function scriptId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw Object.assign(new Error('Select a saved script version.'), {statusCode:400});
  return value;
}
export async function getScript(sql, id) {
  const [row] = await sql`SELECT * FROM script_studio_scripts WHERE id = ${scriptId(id)}`;
  if (!row) throw Object.assign(new Error('Saved script not found.'), {statusCode:404});
  return row;
}
export async function saveScript(sql, userId, input) {
  let brief, script;
  try { brief = validateStudioBrief(input.brief); script = parseStudioOutput(JSON.stringify(input.script), {requireBreakdown:true}); }
  catch(error) { throw Object.assign(error, {statusCode:400}); }
  if (input.script.breakdown_script !== script.script) throw Object.assign(new Error('Refresh the breakdown after editing the script, then save.'), {statusCode:400});
  const parentId = input.parent_id ? (await getScript(sql, input.parent_id)).id : null;
  const hash = digest({brief, script});
  const [saved] = await sql`INSERT INTO script_studio_scripts(id,parent_id,title,product,delivery,brief,script,content_hash,created_by)
    VALUES (${randomUUID()},${parentId},${script.title},${brief.product},${brief.delivery},${JSON.stringify(brief)}::jsonb,${JSON.stringify(script)}::jsonb,${hash},${userId})
    ON CONFLICT(created_by,content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING *`;
  return saved;
}
export function metrics(row) {
  const measured = Number(row.days_with_data) > 0;
  const n = k => measured ? Number(row[k] || 0) : null;
  const spend=n('spend'), revenue=n('revenue'), purchases=n('purchases'), impressions=n('impressions'), clicks=n('clicks'), views=n('video_3s_views'), thruplays=n('video_thruplays');
  return { ...row, spend, revenue, purchases, impressions, clicks, video_3s_views:views, video_thruplays:thruplays,
    has_data:measured, cpa:purchases>0?spend/purchases:null, roas:spend>0?revenue/spend:null,
    ctr:impressions>0?clicks/impressions:null, hook_rate:impressions>0?views/impressions:null, hold_rate:views>0?thruplays/views:null };
}
export async function scriptPerformance(sql, id, days=30) {
  await getScript(sql,id);
  if (![7,30,90].includes(Number(days))) throw Object.assign(new Error('Choose a 7, 30 or 90 day window.'), {statusCode:400});
  const ads = await sql`SELECT a.ad_id,a.hook_variant,a.linked_at,
    (SELECT l.ad_name FROM launch_history l WHERE l.ad_id=a.ad_id ORDER BY l.launched_at DESC LIMIT 1) AS ad_name,
    count(i.date)::int AS days_with_data, min(i.date) AS first_date, max(i.date) AS last_date, max(i.synced_at) AS last_synced,
    sum(i.spend)::float AS spend, sum(i.purchase_value)::float AS revenue, sum(i.purchases)::float AS purchases,
    sum(i.impressions)::float AS impressions, sum(i.clicks)::float AS clicks,
    sum(i.video_3s_views)::float AS video_3s_views, sum(i.video_thruplays)::float AS video_thruplays
    FROM script_studio_ads a LEFT JOIN creative_insights_daily i ON i.ad_id=a.ad_id
      AND i.date >= current_date - (${Number(days)}::int - 1) AND i.date <= current_date
    WHERE a.script_id=${id} GROUP BY a.ad_id,a.hook_variant,a.linked_at ORDER BY a.linked_at DESC`;
  const sum = rows => metrics(rows.reduce((total,row) => {
    for (const key of ['days_with_data','spend','revenue','purchases','impressions','clicks','video_3s_views','video_thruplays']) total[key]=(total[key]||0)+Number(row[key]||0);
    if (row.last_synced && (!total.last_synced || new Date(row.last_synced)>new Date(total.last_synced))) total.last_synced=row.last_synced;
    return total;
  }, {}));
  return { days:Number(days), ads:ads.map(metrics), totals:sum(ads), variants:[...new Set(ads.map(a=>a.hook_variant))].map(variant=>({variant,ads:ads.filter(a=>a.hook_variant===variant).length,...sum(ads.filter(a=>a.hook_variant===variant))})) };
}
export function scriptDocumentHtml(saved) {
  const s=saved.script;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const p=value=>`<p>${esc(value).replace(/\n/g,'<br>')}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${esc(s.title)}</h1>${p(`HOWL · ${saved.product} · ${saved.delivery} · ${saved.brief.duration}s target`)}${p(`Saved version ${saved.id} · ${new Date(saved.created_at).toISOString()}`)}<h2>Spoken script</h2>${p(s.script)}<h2>What each part does</h2>${Object.entries(BREAKDOWN_LABELS).map(([key,label])=>{const b=s.breakdown[key];return `<h3>${label}${b.used?'':' (not used)'}</h3>${b.used?`<blockquote>${esc(b.quote)}</blockquote>`:''}${p(b.purpose)}`;}).join('')}<h2>Angle and approach</h2>${p(s.angle)}${p(s.strategy)}<h2>Alternate openings</h2>${s.hooks.map((h,i)=>`<h3>Opening ${i+1}</h3>${p(h.spoken)}${p(h.next_line)}${p('Visual: '+h.visual)}${p('On-screen: '+h.on_screen)}`).join('')}<h2>Shot list</h2><table border="1"><tr><th>Time</th><th>Visual</th><th>On-screen</th></tr>${s.shot_list.map(row=>`<tr><td>${esc(row.time)}</td><td>${esc(row.visual)}</td><td>${esc(row.on_screen)}</td></tr>`).join('')}</table><h2>Before filming</h2>${s.guardrails.map(p).join('')}${p('This document is a copy of this saved script version. Edits in Google Docs do not automatically update Campfire or its performance attribution.')}</body></html>`;
}
