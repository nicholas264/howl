// Shared, secret-free provider intent used by the review and creation paths.
export function newAdsetIntent({name,campaign_id,daily_budget_dollars,objective,pixel_id,campaign,bid_amount}) {
  const cents=Math.round(Number(daily_budget_dollars)*100);
  const campaignBudget=Number(campaign?.daily_budget)>0 || Number(campaign?.lifetime_budget)>0;
  if(!name?.trim() || !campaign_id || (!campaignBudget && (!Number.isSafeInteger(cents) || cents<=0)))throw new Error('A name, campaign and positive daily budget are required.');
  if(objective==='OUTCOME_SALES'&&!pixel_id)throw new Error('A pixel is required for sales ad sets.');
  return {name:name.trim(),campaign_id,...(!campaignBudget?{daily_budget:String(cents),bid_strategy:campaign?.bid_strategy || 'LOWEST_COST_WITHOUT_CAP'}:{}),...(bid_amount?{bid_amount}:{}),billing_event:'IMPRESSIONS',status:'PAUSED',
    targeting:{geo_locations:{countries:['US']},age_min:18,age_max:65},
    optimization_goal:objective==='OUTCOME_SALES'?'OFFSITE_CONVERSIONS':objective==='OUTCOME_TRAFFIC'?'LINK_CLICKS':'REACH',
    ...(objective==='OUTCOME_SALES'?{promoted_object:{pixel_id,custom_event_type:'PURCHASE'}}:{})};
}
export function pairedPlacementRules(video=false) {
  const key=video?'video_label':'image_label',prefix=video?'video':'image';
  return [{customization_spec:{publisher_platforms:['facebook','instagram'],facebook_positions:video?['feed','video_feeds','marketplace','instream_video']:['feed','marketplace'],instagram_positions:['stream','explore']},[key]:{name:`${prefix}_feed`}},
    {customization_spec:{publisher_platforms:['facebook','instagram'],facebook_positions:['story','facebook_reels'],instagram_positions:['story','reels']},[key]:{name:`${prefix}_story`}}];
}
export async function localMediaFingerprint(value) {
  if(!/^data:[^,]*;base64,/i.test(value || ''))throw new Error('This local media format cannot be reviewed. Save it as a supported asset first.');
  const raw=atob(value.slice(value.indexOf(',')+1));
  const bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function launchApprovalRecords(evidence=[]) {
  return evidence.flatMap(record=>record?.approval?[record.approval]:Object.values(record?.pairedApprovals || record?.pairedMediaApprovals || {}));
}

export function effectiveMetaUrlTags(value) {
  return String(value || 'tw_source={{site_source_name}}&tw_adid={{ad.id}}').trim().replace(/^[?&]+/, '');
}

export function validReviewMediaRoles(media) {
  if(!Array.isArray(media) || !media.length || media.length>10 || media.some(item=>!item))return false;
  const roles=new Set(media.map(item=>item.role));
  return roles.size===media.length && (media.length===1&&roles.has('single')
    || media.length===2&&roles.has('feed')&&roles.has('story')
    || media.length>=2&&media.every((_,index)=>roles.has(`card:${index}`)));
}
