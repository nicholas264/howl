import { runExternalStep, operationKey, digest } from './operation-journal.js';

export async function ensureProviderMedia(sql) {
  await sql`CREATE TABLE IF NOT EXISTS provider_media (
    account_id TEXT NOT NULL, kind TEXT NOT NULL, provider_id TEXT NOT NULL,
    source_url TEXT, request_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(account_id,kind,provider_id)
  )`;
  await sql`ALTER TABLE provider_media ADD COLUMN IF NOT EXISTS content_hash TEXT`;
}

export async function journalMediaUpload(sql, req, actorId, accountId, kind, perform) {

  const key = operationKey(req,actorId,'meta-upload');
  const result = await runExternalStep(sql,{operationKey:key,stepKey:'upload',actorId,
    payload:{action:req.body.action,input_hash:digest(req.body)}},perform);
  const id = kind === 'video' ? result.videoId : result.hash;
  if (!id) throw new Error('Upload returned no provider media ID');
  const source = result.sourceVideoUrl || req.body.videoUrl || (/^https:/i.test(req.body.imageBase64 || '') ? req.body.imageBase64 : null);
  await sql`INSERT INTO provider_media (account_id,kind,provider_id,source_url,request_key,content_hash)
    VALUES (${accountId},${kind},${id},${source},${key},${result.contentHash || null}) ON CONFLICT DO NOTHING`;
  return result;
}

export async function resolveLaunchMedia(sql, input) {
  const ids = new Set();
  const urls = new Set();
  const driveIds = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key,item] of Object.entries(value)) {
      if (['videoId','video_id','imageHash','image_hash','feedImageHash','storyImageHash'].includes(key) && typeof item === 'string') ids.add(item);
      if (['videoUrl','sourceVideoUrl','source_video_url','imageUrl','output_url'].includes(key) && typeof item === 'string') urls.add(item);
      if (['fileId','feedFileId','storyFileId','drive_file_id'].includes(key) && typeof item === 'string') driveIds.add(item);
      if (item && typeof item === 'object') walk(item);
    }
  };
  walk(input);
  let unresolvedCreative = false;
  if (input.creativeId) {
    const [receipt] = await sql`SELECT request_payload FROM app_operation_steps
      WHERE status = 'completed' AND step_key LIKE '%/adcreatives' AND result->'body'->>'id' = ${String(input.creativeId)} LIMIT 1`;
    unresolvedCreative = !receipt;
    if (receipt) {
      const payload = {...receipt.request_payload};
      for (const key of ['object_story_spec','asset_feed_spec']) {
        if (typeof payload[key] === 'string') { try {payload[key]=JSON.parse(payload[key]);} catch {} }
      }
      walk(payload);
    }
  }
  const account = process.env.META_AD_ACCOUNT_ID ? `act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}` : null;
  const receipts = ids.size ? await sql`SELECT * FROM provider_media WHERE (${account}::text IS NULL OR account_id = ${account}) AND provider_id IN (SELECT jsonb_array_elements_text(${JSON.stringify([...ids])}::jsonb))` : [];
  const verifiedUrls = receipts.map(row=>row.source_url).filter(Boolean);
  for (const url of verifiedUrls) urls.add(url);
  return {receipts,unresolvedCreative,ids:[...ids],urls:[...urls],driveIds:[...driveIds],verifiedUrls,unresolvedIds:[...ids].filter(id=>!receipts.some(row=>row.provider_id===id))};
}
