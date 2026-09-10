import {newAdsetIntent} from '../../src/lib/launch-review.js';

// Resolve live campaign settings in both review and creation, never from its name.
export async function resolveNewAdset(input,{fetchImpl=globalThis.fetch,token=process.env.META_ACCESS_TOKEN}={}) {
  if(!/^\d+$/.test(String(input.campaign_id)))throw new Error('A valid campaign is required.');
  const read=async path=>{
    const response=await fetchImpl(`https://graph.facebook.com/v21.0/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    const body=await response.json();
    if(!response.ok || body.error)throw new Error(body.error?.error_user_msg || body.error?.message || 'Could not read campaign settings.');
    return body;
  };
  const campaign=await read(`${input.campaign_id}?fields=id,account_id,objective,bid_strategy,daily_budget,lifetime_budget`);
  if(String(campaign.account_id)!==process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,''))throw new Error('Campaign does not belong to the configured ad account.');
  let bidAmount;
  if(['COST_CAP','LOWEST_COST_WITH_BID_CAP','TARGET_COST'].includes(campaign.bid_strategy)) {
    const adsets=await read(`${input.campaign_id}/adsets?fields=bid_amount,status&limit=200`);
    const candidates=(adsets.data || []).filter(row=>['ACTIVE','PAUSED'].includes(row.status));
    const bids=[...new Set(candidates.map(row=>Number(row.bid_amount)))];
    if(adsets.paging?.next || bids.length!==1 || !Number.isSafeInteger(bids[0]) || bids[0]<=0)
      throw new Error('This campaign requires a bid cap, but its existing ad sets do not share one amount. Select an existing ad set with the intended cap.');
    bidAmount=bids[0];
  } else if(campaign.bid_strategy && campaign.bid_strategy!=='LOWEST_COST_WITHOUT_CAP') {
    throw new Error(`This campaign uses ${campaign.bid_strategy}. Select an existing ad set with the intended bidding settings.`);
  }
  const request=newAdsetIntent({...input,objective:campaign.objective,campaign,bid_amount:bidAmount});
  return {request,campaign};
}
