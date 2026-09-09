import { digest } from './operation-journal.js';

export async function readCreativeReceipt(sql, creativeId) {
  const account=process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, '');
  if(!account)return null;
  const suffix=`/act_${account}/adcreatives`;
  const rows=await sql`SELECT request_payload,request_hash FROM app_operation_steps
    WHERE status='completed' AND right(step_key,length(${suffix}))=${suffix}
      AND result->'body'->>'id'=${String(creativeId)}`;
  const verified=rows.filter(row=>row.request_payload && digest(row.request_payload)===row.request_hash);
  if(!verified.length || verified.some(row=>row.request_hash!==verified[0].request_hash))return null;
  return verified[0].request_payload;
}

export async function bindCreativeContent(sql,input,urlTags) {
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
  const payload=await readCreativeReceipt(sql,input.creativeId);
  if(!payload)fail('This creative has no unambiguous receipt in the configured ad account. Recreate it through HOWL.');
  let story;
  try{story=typeof payload.object_story_spec==='string'?JSON.parse(payload.object_story_spec):payload.object_story_spec;}catch{}
  const link=story?.link_data,video=story?.video_data;
  if(!story || (!link&&!video) || (link&&video) || payload.asset_feed_spec)fail('This creative format requires a complete reviewed launch packet.');
  const cards=link?.child_attachments;
  const fields={
    headline:video?.title ?? (cards?.length ? '' : link?.name) ?? '',
    primaryText:video?.message ?? link?.message ?? '',
    destUrl:video?.call_to_action?.value?.link ?? link?.link ?? '',
  };
  if(!fields.destUrl)fail('The saved creative has no verifiable destination.');
  for(const [key,value] of Object.entries(fields)) {
    // Carousel card titles are the actual rendered headlines; there is no parent headline.
    if(!(key==='headline'&&cards?.length) && input[key]!=null && input[key]!==value)
      fail(`The ${key} differs from the saved creative. Recreate the creative after editing it.`);
    input[key]=value;
  }
  if((payload.url_tags || '')!==urlTags)fail('Attribution tags differ from the saved creative. Recreate it with the reviewed tags.');
  if(input.pageId && input.pageId!==story.page_id)fail('The page differs from the saved creative.');
  if(input.instagramUserId && input.instagramUserId!==story.instagram_user_id)fail('The Instagram identity differs from the saved creative.');
  return [fields.headline,fields.primaryText,...(cards || []).flatMap(card=>[card.name,card.description])].filter(Boolean).join('\n');
}
