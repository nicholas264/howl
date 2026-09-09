import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {preparePublishReview,publishAttribution} from '../src/lib/publish-review.js';
import {validReviewMediaRoles} from '../src/lib/launch-review.js';import {verifyReviewedLaunch} from '../api/_lib/reviewed-launch.js';import {digest} from '../api/_lib/operation-journal.js';

const config={pageId:'page',destUrl:'https://example.test/product'};
const item={id:'fixture',type:'carousel',name:'Carousel',hook:'Parent headline',body:'Main copy',cards:[{headline:'First',body:'First body',imageBase64:'data:image/png;base64,YQ=='},{headline:'Second',body:'Second body',imageBase64:'data:image/png;base64,Yg=='}]};
const adset={id:'adset',account_id:'test',campaign_id:'campaign',targeting:{age_min:18}};

test('carousel review binds every ordered card and rejects card or media substitutions',async()=>{
 const calls=[];
 const row=await preparePublishReview(item,config,'adset',{fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({media:JSON.parse(options.body).media,approvals:[null],approval_hash:digest([null]),adset})};}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/launch-review');assert.deepEqual(row.plan.media.map(asset=>asset.role),['card:0','card:1']);assert.notEqual(row.plan.media[0].sha256,row.plan.media[1].sha256);
 assert.equal(row.plan.confirmed,false);assert.deepEqual(row.plan.cards.map(card=>card.headline),['First','Second']);
 const review={...row.plan,confirmed:true};
 const context={payload:{name:'Carousel'},creative:{url_tags:review.fields.url_tags,object_story_spec:{page_id:'page',link_data:{link:config.destUrl,message:item.body,multi_share_optimized:false,
  child_attachments:item.cards.map((card,index)=>({image_hash:`image-${index}`,name:card.headline,description:card.body,link:config.destUrl,call_to_action:{type:'SHOP_NOW'}}))}}},adset,
  media:{receipts:review.media.map((asset,index)=>({provider_id:`image-${index}`,content_hash:asset.sha256}))},driveUploads:[],evidence:{approvals:[null]}};
 const sql=()=>{throw new Error('Unexpected SQL');};assert.ok(await verifyReviewedLaunch(sql,review,context));
 for(const change of [value=>value.creative.object_story_spec.link_data.child_attachments.reverse(),value=>value.creative.object_story_spec.link_data.child_attachments[1].link='https://example.test/changed',value=>value.creative.object_story_spec.link_data.multi_share_optimized=true,value=>value.media.receipts[1].content_hash='changed']){
  const altered=structuredClone(context);change(altered);await assert.rejects(verifyReviewedLaunch(sql,review,altered),error=>error.statusCode===409&&error.definitelyNotApplied);
 }
 assert.equal(validReviewMediaRoles(Array.from({length:10},(_,index)=>({role:`card:${index}`}))),true);
 assert.equal(validReviewMediaRoles(Array.from({length:11},(_,index)=>({role:`card:${index}`}))),false);
 assert.equal(validReviewMediaRoles([{role:'card:0'},{role:'card:0'}]),false);
 await assert.rejects(preparePublishReview({...item,cards:[item.cards[0]]},config,'adset',{}),/two to ten/);
});

test('actual legacy publisher refuses unconfirmed work and forwards the reviewed plan through dispatch',async()=>{
 const source=await readFile(new URL('../src/components/MetaPublishTool.jsx',import.meta.url),'utf8');
 const start=source.indexOf('  const pushAd = useCallback('),end=source.indexOf('\n  // ── Push all',start);
 const calls=[],alerts=[];
 const context={useCallback:fn=>fn,selectedAdsetId:'adset',config,publishAttribution,alert:message=>alerts.push(message),setStatuses:()=>{},setStep:()=>{},setStatus:()=>{},onUpdateCartItem:()=>{},
  fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {json:async()=>body.action==='upload_image'?{hash:`hash-${calls.length}`} :body.action==='create_creative'?{creativeId:'creative'}:{adId:'ad'}};}};
 const push=vm.runInNewContext(`${source.slice(start,end)}\npushAd`,context);
 await push(item);assert.equal(calls.length,0);assert.match(alerts[0],/Review this ad/);
 const plan={confirmed:true,ad_name:'Reviewed name'};await push(item,plan);
 assert.equal(calls.length,4);assert.equal(calls.at(-1).body.action,'create_ad_from_creative');assert.deepEqual(calls.at(-1).body.reviewed_plan,plan);assert.equal(calls.at(-1).body.adName,'Reviewed name');
 assert.equal(calls.at(-1).body.sourceType,'tool_generated');
});

test('legacy confirmation blocks changed queue contents before any upload',async()=>{
 const source=await readFile(new URL('../src/components/MetaPublishTool.jsx',import.meta.url),'utf8');
 const start=source.indexOf('  const confirmManualReview=async'),end=source.indexOf('  const pushAll=',start);
 const calls=[],errors=[];const context={queue:[structuredClone(item)],publishReview:{items:[item]},setPublishReviewError:message=>errors.push(message),setPublishReview:()=>{},setPushingAll:()=>{},setPushAllProgress:()=>{},pushAd:async(...args)=>calls.push(args)};
 context.reviewFingerprint=items=>JSON.stringify({items,config,adsetId:'adset'});context.publishReview.fingerprint=context.reviewFingerprint([item]);
 const confirm=vm.runInNewContext(`${source.slice(start,end)}\nconfirmManualReview`,context);
 context.queue[0].cards[0].headline='Changed';await confirm([{item,plan:{confirmed:false}}]);assert.equal(calls.length,0);assert.match(errors[0],/queue or settings changed/);
 context.queue=[structuredClone(item)];await confirm([{item,plan:{confirmed:false}}]);assert.equal(calls.length,1);assert.equal(calls[0][1].confirmed,true);
});
