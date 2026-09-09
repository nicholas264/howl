import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureOperationJournal,digest} from '../api/_lib/operation-journal.js';import {ensureProviderMedia} from '../api/_lib/provider-media.js';import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';import handler from '../api/meta.js';import {readLaunchPacket} from '../api/_lib/launch-packets.js';import {effectiveMetaUrlTags} from '../src/lib/launch-review.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
test('confirmed carousel dispatch preserves ordered content and rejects reordered reviews before Meta',async t=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db',META_AD_ACCOUNT_ID:'fixture',META_ACCESS_TOKEN:'fixture'});
  await initializeSchema(sql);await ensureOperationJournal(sql);await ensureProviderMedia(sql);await ensureLocalReceipts(sql);
  const sha=['a'.repeat(64),'b'.repeat(64)],cards=[{imageHash:'first',headline:'First',body:'First copy',destUrl:'https://example.test'},{imageHash:'second',headline:'Second',body:'Second copy',destUrl:'https://example.test'}];
  for(let index=0;index<cards.length;index++)await sql`INSERT INTO provider_media(account_id,kind,provider_id,request_key,content_hash) VALUES ('act_fixture','image',${cards[index].imageHash},${String(index)},${sha[index]})`;
  const adset={id:'adset',account_id:'fixture',campaign_id:'campaign',targeting:{age_min:18},bid_strategy:'COST_CAP',bid_amount:'1500'};let ads=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(options.method!=='POST')return Response.json(adset);
    if(String(url).endsWith('/adcreatives'))return Response.json({id:'creative'});
    if(String(url).endsWith('/ads')){ads++;return Response.json({id:'ad'});}
    throw new Error('Unexpected provider call');
  });
  const base={adName:'Carousel',headline:'Parent',primaryText:'Main copy',destUrl:'https://example.test',pageId:'page',sourceType:'tool_generated'};
  const created=response();await handler({method:'POST',headers:{},body:{...base,action:'create_creative',cards}},created);assert.equal(created.statusCode,200,JSON.stringify(created.body));
  const plan={version:1,confirmed:true,ad_name:'Carousel',approval_hash:digest([null]),fields:{headline:'Parent',primary_text:'Main copy',dest_url:'https://example.test',page_id:'page',instagram_user_id:'',url_tags:effectiveMetaUrlTags()},
    cards:cards.map(card=>({headline:card.headline,body:card.body,dest_url:card.destUrl,call_to_action:'SHOP_NOW'})),media:sha.map((hash,index)=>({role:`card:${index}`,sha256:hash})),target:{mode:'existing',id:'adset',snapshot:adset}};
  const body={...base,action:'create_ad_from_creative',creativeId:'creative',adsetId:'adset',reviewed_plan:plan};
  const bad=response();await handler({method:'POST',headers:{},body:{...body,request_key:'changed',reviewed_plan:{...plan,cards:[...plan.cards].reverse()}}},bad);assert.equal(bad.statusCode,409);assert.equal(ads,0);
  const cap=response();await handler({method:'POST',headers:{},body:{...body,request_key:'changed-cap',reviewed_plan:{...plan,target:{...plan.target,snapshot:{...adset,bid_amount:'1000'}}}}},cap);assert.equal(cap.statusCode,409);assert.equal(ads,0);
  const good=response();await handler({method:'POST',headers:{},body},good);assert.equal(good.statusCode,200,JSON.stringify(good.body));assert.equal(ads,1);
  const packet=await readLaunchPacket(sql,'ad');assert.equal(packet.snapshot.review.cards.length,2);assert.equal(packet.snapshot.media_receipts.length,2);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
