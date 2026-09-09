import { stableJson } from './operation-journal.js';

export function verifyRecoveredMetaAd(step,ad,accountId) {
  const payload=step.request_payload;
  if (!/^\d+:\/v[\d.]+\/act_[\w]+\/ads$/.test(step.step_key) || !payload) throw new Error('Only journaled Meta ad creation can use this recovery path');
  const recordedAccount=step.step_key.match(/\/act_([^/]+)\/ads$/)?.[1];
  if(recordedAccount!==String(accountId).replace(/^act_/,'') || String(ad.account_id)!==recordedAccount)throw new Error('The ad or original request belongs to a different account');
  const allowed=new Set(['name','adset_id','creative','status','tracking_specs']);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw new Error('This ad uses fields that cannot yet be verified automatically');
  const creative=typeof payload.creative==='string'?JSON.parse(payload.creative):payload.creative;
  if(!creative?.creative_id || String(ad.creative?.id)!==String(creative.creative_id)
    || String(ad.adset_id)!==String(payload.adset_id) || ad.name!==payload.name) throw new Error('The ad does not match the original creative, ad set, and name');
  if(payload.tracking_specs && stableJson(typeof payload.tracking_specs==='string'?JSON.parse(payload.tracking_specs):payload.tracking_specs)!==stableJson(ad.tracking_specs))throw new Error('Tracking configuration does not match');
  const created=Date.parse(ad.created_time),started=Date.parse(step.created_at),updated=Date.parse(step.updated_at);
  if(![created,started,updated].every(Number.isFinite) || updated<started || created<started-120000 || created>updated+300000)
    throw new Error('The ad creation time does not match this attempt');
  return {status:200,body:{id:String(ad.id)}};
}

export function verifyRecoveredMetaCampaign(step,campaign,accountId) {
  const account=step.step_key.match(/^\d+:\/v[\d.]+\/act_([\w]+)\/campaigns$/)?.[1];
  const payload=step.request_payload;
  if(!account || !payload)throw new Error('Only journaled campaign creation can use this recovery path');
  if(account!==String(accountId).replace(/^act_/,'') || String(campaign.account_id)!==account)throw new Error('The campaign or original request belongs to a different account');
  const allowed=new Set(['name','objective','status','special_ad_categories','is_adset_budget_sharing_enabled']);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw new Error('This campaign uses fields that cannot yet be verified automatically');
  if(payload.status!=='PAUSED' || campaign.status!=='PAUSED' || campaign.name!==payload.name || campaign.objective!==payload.objective)
    throw new Error('The campaign name, objective or paused status does not match');
  if(stableJson(payload.special_ad_categories)!==stableJson(campaign.special_ad_categories)
    || typeof payload.is_adset_budget_sharing_enabled!=='boolean'
    || campaign.is_adset_budget_sharing_enabled!==payload.is_adset_budget_sharing_enabled)
    throw new Error('Campaign category or budget-sharing settings do not match');
  const created=Date.parse(campaign.created_time),started=Date.parse(step.created_at),updated=Date.parse(step.updated_at);
  if(![created,started,updated].every(Number.isFinite) || updated<started || created<started-120000 || created>updated+300000)
    throw new Error('The campaign creation time does not match this attempt');
  return {status:200,body:{id:String(campaign.id)}};
}

export async function recoverMetaAd(sql,{operationKey,stepKey,providerId,actorId,note},fetchImpl=globalThis.fetch) {
  if(!/^\d+$/.test(providerId))throw new Error('Enter a numeric Meta object ID');
  const [step]=await sql`SELECT * FROM app_operation_steps WHERE operation_key=${operationKey} AND step_key=${stepKey}`;
  if(!step || !['pending','uncertain'].includes(step.status) || Date.now()-Date.parse(step.updated_at)<600000) throw new Error('Only an uncertain or stalled attempt older than ten minutes can be reconciled');
  const kind=step.step_key.match(/^\d+:\/v[\d.]+\/act_[\w]+\/(ads|campaigns)$/)?.[1];
  if(!kind)throw new Error('This operation requires a different provider recovery procedure');
  const target=new URL(`https://graph.facebook.com/v21.0/${providerId}`);
  target.searchParams.set('fields',kind==='campaigns'
    ? 'id,name,account_id,objective,status,special_ad_categories,is_adset_budget_sharing_enabled,created_time'
    : 'id,name,account_id,adset_id,creative{id},created_time,tracking_specs');
  const response=await fetchImpl(target,{headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Meta could not verify this object (${response.status})`);
  const ad=await response.json();
  if(String(ad.id)!==providerId)throw new Error('Meta returned an unexpected object identity');
  const result=(kind==='campaigns'?verifyRecoveredMetaCampaign:verifyRecoveredMetaAd)(step,ad,process.env.META_AD_ACCOUNT_ID);
  if(kind==='ads' && step.result?.launch_packet_key)result.launch_packet_key=step.result.launch_packet_key;
  const verification=kind==='campaigns'?'Meta account, campaign name, objective, paused status, categories, budget sharing and creation time':'Meta account, creative, ad set, name, tracking, creation time';
  const [saved]=await sql`WITH recovered AS (
    UPDATE app_operation_steps SET status='completed',result=${JSON.stringify(result)}::jsonb,updated_at=now()
    WHERE operation_key=${operationKey} AND step_key=${stepKey} AND status=${step.status} AND updated_at=${step.updated_at}
    RETURNING operation_key
  ), audit AS (
    INSERT INTO app_admin_audit (actor_id,action,target,metadata)
    SELECT ${actorId},'operation.reconciled',operation_key,${JSON.stringify({stepKey,providerId,note,verification})}::jsonb FROM recovered
    RETURNING id
  ) SELECT id FROM audit`;
  if(!saved)throw new Error('The operation changed while it was being verified. Reload its state.');
  return result;
}
