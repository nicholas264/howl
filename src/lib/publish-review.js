import {effectiveMetaUrlTags,localMediaFingerprint} from './launch-review.js';

export function publishAttribution(item) {
  return {creatorId:item.creatorId || null,deliverableId:item.deliverableId || null,briefId:item.briefId || null,
    sourceLabel:item.sourceLabel || item.creator || null,
    sourceType:item.sourceType || (item.creatorId?'external_creator':'tool_generated'),sourceVideoUrl:item.sourceVideoUrl || null};
}
export async function preparePublishReview(item,config,adsetId,{fetchImpl,signal}) {
  if(!adsetId || adsetId==='__new__' || !config.pageId?.trim() || !config.destUrl?.trim() || !item.hook?.trim())throw new Error('Choose an ad set, Page, destination and headline before reviewing.');
  const carousel=item.type==='carousel';
  if(carousel&&(!Array.isArray(item.cards)||item.cards.length<2||item.cards.length>10))throw new Error('A carousel requires two to ten cards.');
  const sources=carousel?item.cards.map((card,index)=>({role:`card:${index}`,value:card.imageBase64 || card.squareUrl}))
    :[{role:'single',value:item.type==='video'?item.videoUrl:item.squareUrl || item.url}];
  const media=await Promise.all(sources.map(async({role,value})=>/^https:\/\//i.test(value || '')?{role,url:value}:{role,sha256:await localMediaFingerprint(value)}));
  const response=await fetchImpl('/api/launch-review',{method:'POST',headers:{'Content-Type':'application/json'},signal,
    body:JSON.stringify({input:{action:'create_ad_from_creative',...publishAttribution(item)},media,adset_id:adsetId})});
  const result=await response.json();if(!response.ok || result.error)throw new Error(result.error || 'Launch review failed.');
  return {item,approvals:result.approvals,plan:{version:1,confirmed:false,ad_name:item.name || `HOWL Ad ${new Date().toLocaleDateString()}`,
    approval_hash:result.approval_hash,media:result.media,fields:{headline:item.hook,primary_text:item.body || item.hook,dest_url:config.destUrl,page_id:config.pageId,instagram_user_id:'',url_tags:effectiveMetaUrlTags()},
    target:{mode:'existing',id:adsetId,snapshot:result.adset},
    ...(carousel?{cards:item.cards.map(card=>({headline:card.headline || item.hook || '',body:card.body || '',dest_url:config.destUrl,call_to_action:'SHOP_NOW'}))}:{})}};
}
