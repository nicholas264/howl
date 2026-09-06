import { stableJson } from './operation-journal.js';

export function verifyRecoveredMetaAd(step,ad,accountId) {
  const payload=step.request_payload;
  if (!/^\d+:\/v[\d.]+\/act_[\w]+\/ads$/.test(step.step_key) || !payload) throw new Error('Only journaled Meta ad creation can use this recovery path');
  if(String(ad.account_id)!==String(accountId).replace(/^act_/,''))throw new Error('The ad belongs to a different account');
  const allowed=new Set(['name','adset_id','creative','status','tracking_specs']);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw new Error('This ad uses fields that cannot yet be verified automatically');
  const creative=typeof payload.creative==='string'?JSON.parse(payload.creative):payload.creative;
  if(!creative?.creative_id || String(ad.creative?.id)!==String(creative.creative_id)
    || String(ad.adset_id)!==String(payload.adset_id) || ad.name!==payload.name) throw new Error('The ad does not match the original creative, ad set, and name');
  if(payload.tracking_specs && stableJson(typeof payload.tracking_specs==='string'?JSON.parse(payload.tracking_specs):payload.tracking_specs)!==stableJson(ad.tracking_specs))throw new Error('Tracking configuration does not match');
  const created=Date.parse(ad.created_time);
  if(!Number.isFinite(created) || created<Date.parse(step.created_at)-120000 || created>Date.parse(step.updated_at)+300000)
    throw new Error('The ad creation time does not match this attempt');
  return {status:200,body:{id:String(ad.id)}};
}

export async function recoverMetaAd(sql,{operationKey,stepKey,providerId,actorId,note},fetchImpl=globalThis.fetch) {
  if(!/^\d+$/.test(providerId))throw new Error('Enter a numeric Meta ad ID');
  const [step]=await sql`SELECT * FROM app_operation_steps WHERE operation_key=${operationKey} AND step_key=${stepKey}`;
  if(!step || !['pending','uncertain'].includes(step.status) || Date.now()-Date.parse(step.updated_at)<600000) throw new Error('Only an uncertain or stalled attempt older than ten minutes can be reconciled');
  if(!/^\d+:\/v[\d.]+\/act_[\w]+\/ads$/.test(step.step_key))throw new Error('This operation requires a different provider recovery procedure');
  const target=new URL(`https://graph.facebook.com/v21.0/${providerId}`);
  target.searchParams.set('fields','id,name,account_id,adset_id,creative{id},created_time,tracking_specs');
  const response=await fetchImpl(target,{headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Meta could not verify this ad (${response.status})`);
  const ad=await response.json();
  if(String(ad.id)!==providerId)throw new Error('Meta returned an unexpected ad identity');
  const result=verifyRecoveredMetaAd(step,ad,process.env.META_AD_ACCOUNT_ID);
  const [saved]=await sql`WITH recovered AS (
    UPDATE app_operation_steps SET status='completed',result=${JSON.stringify(result)}::jsonb,updated_at=now()
    WHERE operation_key=${operationKey} AND step_key=${stepKey} AND status=${step.status} AND updated_at=${step.updated_at}
    RETURNING operation_key
  ), audit AS (
    INSERT INTO app_admin_audit (actor_id,action,target,metadata)
    SELECT ${actorId},'operation.reconciled',operation_key,${JSON.stringify({stepKey,providerId,note,verification:'Meta account, creative, ad set, name, tracking, creation time'})}::jsonb FROM recovered
    RETURNING id
  ) SELECT id FROM audit`;
  if(!saved)throw new Error('The operation changed while it was being verified. Reload its state.');
  return result;
}
