import {validReviewMediaRoles} from '../../src/lib/launch-review.js';
import {digest} from './operation-journal.js';

const fail=message=>{throw Object.assign(new Error(`Launch review changed: ${message}`),{statusCode:409,definitelyNotApplied:true});};
const json=value=>typeof value==='string'?JSON.parse(value):value;
const targetFields=['status','campaign_id','targeting','optimization_goal','billing_event','bid_strategy','bid_amount','daily_budget','lifetime_budget','promoted_object','attribution_spec','start_time','end_time'];
export const reviewedTarget=adset=>Object.fromEntries(targetFields.map(key=>[key,adset[key] ?? null]));

export async function verifyReviewedLaunch(sql,review,{payload,creative,adset,campaign,media,driveUploads,evidence}) {
  if(review==null)fail('confirm the complete review before creating an ad');
  if(review.version!==1 || review.confirmed!==true || !review.fields || !Array.isArray(review.media))fail('confirm the complete review first');
  if(!/^[a-f0-9]{64}$/.test(review.approval_hash || '') || !validReviewMediaRoles(review.media))fail('invalid evidence or media roles');
  for(const item of review.media)if(!item || !(item.drive_file_id?/^[a-f0-9]{32}$/.test(item.drive_md5 || ''):/^[a-f0-9]{64}$/.test(item.sha256 || '')))fail('media fingerprint missing');
  if(['headline','primary_text','dest_url','url_tags','page_id','instagram_user_id'].some(key=>typeof review.fields[key]!=='string'))fail('complete creative fields required');
  if(digest(evidence.approvals)!==review.approval_hash)fail('creator approval or rights evidence differs');
  if(payload.name!==review.ad_name)fail('ad name differs');
  const story=json(creative.object_story_spec),feed=json(creative.asset_feed_spec);
  const fields=review.fields,link=story?.link_data,video=story?.video_data;
  const equal=(actual,expected,label)=>{if(digest(actual)!==digest(expected))fail(label);};
  equal(story?.page_id,fields.page_id,'Facebook Page differs');
  equal(story?.instagram_user_id || '',fields.instagram_user_id || '','Instagram identity differs');
  equal(creative.url_tags || '',fields.url_tags,'attribution tags differ');
  if(payload.url_tags!=null)equal(payload.url_tags,fields.url_tags,'ad attribution tags differ');
  let assets;
  if(feed){
    equal(feed.asset_customization_rules,review.placement_rules,'placement customization differs');
    equal(feed.bodies?.map(row=>row.text),[fields.primary_text],'primary text differs');
    equal(feed.titles?.map(row=>row.text),[fields.headline],'headline differs');
    equal(feed.link_urls?.map(row=>row.website_url),[fields.dest_url],'destination differs');
    assets=[...(feed.images || []).map(row=>({id:row.hash,labels:row.adlabels})),...(feed.videos || []).map(row=>({id:row.video_id,labels:row.adlabels}))]
      .map(row=>({...row,role:row.labels?.some(label=>/_feed$/.test(label.name))?'feed':row.labels?.some(label=>/_story$/.test(label.name))?'story':null}));
  }else if(link?.child_attachments){
    const cards=link.child_attachments;
    if(!Array.isArray(cards) || cards.length<2 || cards.length>10 || video)fail('unsupported reviewed carousel');
    equal(link.message || '',fields.primary_text,'carousel primary text differs');
    equal(link.link,fields.dest_url,'carousel destination differs');
    equal(link.multi_share_optimized,false,'carousel order optimization differs');
    equal(cards.map(card=>({headline:card.name || '',body:card.description || '',dest_url:card.link,call_to_action:card.call_to_action?.type})),review.cards,'carousel card order, copy, destination or action differs');
    assets=cards.map((card,index)=>({id:card.image_hash,role:`card:${index}`}));
  }else{
    if(!link&&!video)fail('unsupported reviewed creative format');
    equal(video?.title ?? link?.name ?? '',fields.headline,'headline differs');
    equal(video?.message ?? link?.message ?? '',fields.primary_text,'primary text differs');
    equal(video?.call_to_action?.value?.link ?? link?.link,fields.dest_url,'destination differs');
    assets=[{id:video?.video_id || link?.image_hash,role:'single'}];
  }
  if(assets.length!==review.media.length || new Set(assets.map(asset=>asset.role)).size!==assets.length)fail('media placement roles differ');
  for(const expected of review.media){
    const asset=assets.find(row=>row.role===expected.role);if(!asset)fail('media role missing');
    if(expected.drive_file_id){
      const uploaded=driveUploads.find(row=>row.step_key===expected.drive_file_id);
      if(!uploaded || ![uploaded.result.imageHash,uploaded.result.videoId].includes(asset.id) || uploaded.result.contentMd5!==expected.drive_md5)fail('Drive content or placement differs');
    }else{
      const receipt=media.receipts.find(row=>row.provider_id===asset.id);
      if(!receipt || receipt.content_hash!==expected.sha256 || (expected.url&&receipt.source_url!==expected.url))fail('uploaded media bytes or placement differ');
    }
  }
  if(review.target?.mode==='existing'){
    equal(String(adset.id),String(review.target.id),'ad set differs');
    if(!review.target.snapshot || typeof review.target.snapshot!=='object')fail('ad-set snapshot missing');
    equal(reviewedTarget(adset),reviewedTarget(review.target.snapshot),'ad-set configuration differs');
  }else if(review.target?.mode==='creative_test'){
    if(!review.target.request || !review.target.campaign || !campaign)fail('creative-test configuration missing');
    const readReceipt=async(kind,id)=>{
      const suffix=`/act_${adset.account_id}/${kind}`;
      const [receipt]=await sql`SELECT request_payload,request_hash FROM app_operation_steps WHERE status='completed' AND right(step_key,length(${suffix}))=${suffix} AND result->'body'->>'id'=${String(id)} LIMIT 1`;
      if(!receipt || digest(receipt.request_payload)!==receipt.request_hash)fail(`creative-test ${kind} receipt missing`);
      return receipt.request_payload;
    };
    equal(await readReceipt('campaigns',adset.campaign_id),review.target.campaign,'campaign creation request differs');
    equal(await readReceipt('adsets',adset.id),{...review.target.request,campaign_id:adset.campaign_id},'ad-set creation request differs');
    equal(String(campaign.id),String(adset.campaign_id),'campaign differs');
    if(Number(campaign.daily_budget || 0)!==0 || Number(campaign.lifetime_budget || 0)!==0)fail('unexpected campaign budget');
    for(const key of ['name','objective','status','special_ad_categories','is_adset_budget_sharing_enabled'])equal(campaign[key],review.target.campaign[key],`campaign ${key} differs`);
    for(const key of ['name','status','targeting','optimization_goal','billing_event','bid_strategy','promoted_object'])equal(adset[key] ?? null,review.target.request[key] ?? null,`ad-set ${key} differs; review the created ad set in the Launcher`);
    for(const key of ['daily_budget','bid_amount'])equal(String(adset[key]),String(review.target.request[key]),`${key} differs`);
    if(adset.lifetime_budget && Number(adset.lifetime_budget)!==0)fail('unexpected lifetime budget');
  }else if(review.target?.mode==='new'){
    if(!review.target.request || typeof review.target.request!=='object')fail('new ad-set request missing');
    const suffix=`/act_${adset.account_id}/adsets`;
    const [receipt]=await sql`SELECT request_payload,request_hash FROM app_operation_steps
      WHERE status='completed' AND right(step_key,length(${suffix}))=${suffix} AND result->'body'->>'id'=${String(adset.id)} LIMIT 1`;
    if(!receipt || digest(receipt.request_payload)!==receipt.request_hash)fail('new ad set has no verified receipt');
    equal(receipt.request_payload,review.target.request,'new ad-set request differs');
    equal(String(adset.campaign_id),String(review.target.request.campaign_id),'campaign differs');
    for(const key of ['status','targeting','optimization_goal','billing_event','bid_strategy','promoted_object'])equal(adset[key] ?? null,review.target.request[key] ?? null,`${key} differs; select the created ad set and review its current configuration`);
    equal(String(adset.daily_budget || 0),String(review.target.request.daily_budget || 0),'daily budget differs');
    equal(String(adset.bid_amount || 0),String(review.target.request.bid_amount || 0),'bid amount differs');
    if(review.target.campaign){
      if(!campaign)fail('campaign settings unavailable');
      for(const key of ['id','objective','bid_strategy'])equal(campaign[key] ?? null,review.target.campaign[key] ?? null,`campaign ${key} differs`);
      for(const key of ['daily_budget','lifetime_budget'])equal(String(campaign[key] || 0),String(review.target.campaign[key] || 0),`campaign ${key} differs`);
    }
    if(adset.lifetime_budget && Number(adset.lifetime_budget)!==0)fail('unexpected lifetime budget');
  }else fail('ad-set review missing');
  return review;
}
