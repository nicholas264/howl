import {randomUUID} from 'node:crypto';
import {digest,operationKey} from './operation-journal.js';
import {readCreativeReceipt} from './creative-receipt.js';
import {assertLaunchReady} from './launch-preflight.js';
import {resolveLaunchMedia} from './provider-media.js';
import {verifyReviewedLaunch} from './reviewed-launch.js';

const plain=value=>JSON.parse(JSON.stringify(value ?? null));
const conflict=message=>Object.assign(new Error(message),{statusCode:409,definitelyNotApplied:true});
const contextKeys=['creatorId','creator_id','deliverableId','deliverable_id','briefId','brief_id','sourceType','source_type','sourceLabel','productId','angleId','fileId','pair'];

export async function readLaunchAdset(adsetId,{token=process.env.META_ACCESS_TOKEN,fetchImpl=globalThis.fetch,version='v21.0'}={}) {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(adsetId)) || !/^v[\d.]+$/.test(version))throw conflict('Invalid ad set reference');
  const account=process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,'');
  const fields=['id','name','account_id','campaign_id','targeting','status','optimization_goal','billing_event','bid_strategy','bid_amount','daily_budget','lifetime_budget','promoted_object','attribution_spec','start_time','end_time'];
  const url=new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(adsetId)}`);
  url.searchParams.set('fields',fields.join(','));
  const response=await fetchImpl(url.toString(),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  if(!response.ok || body.error || String(body.id)!==String(adsetId)
    || String(body.account_id).replace(/^act_/,'')!==account || !body.campaign_id
    || !body.targeting || typeof body.targeting!=='object')throw conflict('Could not verify the ad set and targeting before launch.');
  return Object.fromEntries(fields.filter(field=>body[field]!=null).map(field=>[field,body[field]]));
}

export async function readLaunchCampaign(campaignId,{token,fetchImpl,version='v21.0'}={}) {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(campaignId)))throw conflict('Invalid campaign reference');
  const fields=['id','account_id','name','objective','status','special_ad_categories','is_adset_budget_sharing_enabled','daily_budget','lifetime_budget'];
  const url=new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(campaignId)}`);url.searchParams.set('fields',fields.join(','));
  const response=await fetchImpl(url.toString(),{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  if(!response.ok || body.error || String(body.id)!==String(campaignId) || String(body.account_id).replace(/^act_/,'')!==process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,''))throw conflict('Could not verify the creative-test campaign before launch.');
  return Object.fromEntries(fields.filter(field=>body[field]!=null).map(field=>[field,body[field]]));
}

export function launchEvidenceVerifier(sql,inputs,results,options) {
  const baseline=plain(results);
  const attribution=inputs.map(input=>Object.fromEntries(contextKeys.filter(key=>input[key]!=null).map(key=>[key,plain(input[key])])));
  return async()=>{
    const current=[];
    for(const input of inputs)current.push(await assertLaunchReady(sql,input,options));
    if(digest(plain(current))!==digest(baseline))throw conflict('Approval evidence changed during launch. Review the current outputs and retry as a new launch.');
    return {approvals:baseline,attribution};
  };
}

export async function captureLaunchPacket(sql,{req,actorId,key,stepKey,target,payload,token,fetchImpl}) {
  try {
    if(typeof req.captureLaunchEvidence!=='function')throw conflict('Launch preflight evidence is unavailable.');
    const evidence=await req.captureLaunchEvidence();
    const creativeRef=typeof payload.creative==='string'?JSON.parse(payload.creative):payload.creative;
    const creativeId=creativeRef?.creative_id,adsetId=payload.adset_id;
    if(!creativeId || !adsetId)throw conflict('Creative and ad set are required for the launch snapshot.');
    const creative=await readCreativeReceipt(sql,creativeId);
    if(!creative)throw conflict('The creative has no verified account-bound creation receipt.');
    const account=process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,'');
    if(target.protocol!=='https:' || !account || !target.pathname.endsWith(`/act_${account}/ads`))throw conflict('Launch account does not match the configured account.');
    const adset=await readLaunchAdset(adsetId,{token,fetchImpl,version:target.pathname.split('/')[1]});
    const media=await resolveLaunchMedia(sql,{creativeId});
    const driveUploads=req.body?.action==='launch_meta_ad'
      ? await sql`SELECT step_key,result FROM app_operation_steps WHERE operation_key=${operationKey(req,actorId,'drive-upload')} AND status='completed'`
      : [];
    const isCreativeTest=req.body?.action==='create_creative_test';
    if(isCreativeTest&&!req.reviewedLaunchPlan)throw conflict('Creative-test review is required.');
    const campaign=isCreativeTest?await readLaunchCampaign(adset.campaign_id,{token,fetchImpl,version:target.pathname.split('/')[1]}):null;
    const review=await verifyReviewedLaunch(sql,isCreativeTest?req.reviewedLaunchPlan:req.body?.reviewed_plan,{payload,creative,adset,campaign,media,driveUploads,evidence});
    const snapshot=plain({version:1,captured_at:new Date().toISOString(),actor_id:actorId,account_id:account,
      action:req.body?.action,ad:payload,creative_id:String(creativeId),creative,adset,campaign,
      media_receipts:media.receipts,unresolved_media_ids:media.unresolvedIds,drive_uploads:driveUploads,evidence,review,
      basis:'Configuration observed before dispatch. Subsequent provider edits and actual delivery are not inferred.'});
    const serialized=JSON.stringify(snapshot);
    if(Buffer.byteLength(serialized)>512000)throw conflict('Launch snapshot exceeds the supported size. Split this launch into smaller creatives.');
    const packetKey=`packet:${stepKey}:${randomUUID()}`;
    const [linked]=await sql`WITH packet AS (
      INSERT INTO app_operation_steps(operation_key,step_key,request_hash,status,result,actor_id)
      VALUES (${key},${packetKey},${digest(snapshot)},'completed',${serialized}::jsonb,${actorId}) RETURNING step_key
    ) UPDATE app_operation_steps launched SET result=jsonb_build_object('launch_packet_key',packet.step_key)
      FROM packet WHERE launched.operation_key=${key} AND launched.step_key=${stepKey} AND launched.status='pending'
      RETURNING launched.step_key`;
    if(!linked)throw conflict('The launch operation changed before dispatch.');
    return packetKey;
  } catch(error) {
    // No ad mutation has occurred yet, so this pre-dispatch failure is retryable.
    error.definitelyNotApplied=true;
    throw error;
  }
}

export async function readLaunchPacket(sql,adId) {
  const [row]=await sql`SELECT packet.result AS snapshot,packet.request_hash AS snapshot_hash
    FROM app_operation_steps launched
    JOIN app_operation_steps packet ON packet.operation_key=launched.operation_key
      AND packet.step_key=launched.result->>'launch_packet_key'
    WHERE launched.status='completed' AND launched.step_key LIKE '%/ads'
      AND launched.result->'body'->>'id'=${adId} AND packet.status='completed' LIMIT 1`;
  if(!row)return null;
  if(digest(row.snapshot)!==row.snapshot_hash)throw conflict('The stored launch snapshot failed its integrity check.');
  return row;
}
