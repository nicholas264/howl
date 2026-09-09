import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureOperationJournal,digest} from '../api/_lib/operation-journal.js';
import {ensureProviderMedia} from '../api/_lib/provider-media.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import handler from '../api/meta.js';
import {readLaunchPacket} from '../api/_lib/launch-packets.js';
import {creativeTestIntent} from '../src/lib/creative-test-intent.js';
import {preparePublishReview} from '../src/lib/publish-review.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
const settings={testName:'Review test',dailyBudgetDollars:'20',costCapCents:2500,pixelId:'123',pageId:'456',destUrl:'https://example.test/product'};
test('creative-test review is required and each dispatched ad retains its own reviewed media and intent',async t=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db',META_AD_ACCOUNT_ID:'fixture',META_ACCESS_TOKEN:'fixture'});
  await initializeSchema(sql);await ensureOperationJournal(sql);await ensureProviderMedia(sql);await ensureLocalReceipts(sql);
  const intent=creativeTestIntent(settings),items=[];
  for(let i=0;i<2;i++){
   const item={id:`item-${i}`,name:'Same name',hook:`Headline ${i}`,body:`Copy ${i}`,squareUrl:`data:image/png;base64,${i?'Yg==':'YQ=='}`};
   const row=await preparePublishReview(item,settings,null,{creativeTest:settings,fetchImpl:async(url,options)=>{const request=JSON.parse(options.body);assert.equal(request.adset_id,undefined);return Response.json({media:request.media,approvals:[null],approval_hash:digest([null]),creative_test:intent});}});
   assert.equal(row.plan.confirmed,false);
   await sql`INSERT INTO provider_media(account_id,kind,provider_id,request_key,content_hash) VALUES ('act_fixture','image',${`image-${i}`},${String(i)},${row.plan.media[0].sha256})`;
   items.push({id:item.id,name:item.name,hook:item.hook,body:item.body,type:'static',imageHash:`image-${i}`,sourceType:'tool_generated',reviewed_plan:{...row.plan,confirmed:true}});
  }
  const stored=new Map();let posts=0,ads=0,drift=false,campaignDrift=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
   const path=new URL(url).pathname;
   if(options.method!=='POST'){
    const body=structuredClone(stored.get(path.split('/').at(-1)));
    if(drift&&body?.daily_budget)body.bid_amount='9999';
    if(campaignDrift&&body?.objective)body.daily_budget='9999';
    return Response.json(body);
   }
   posts++;
   const kind=path.split('/').at(-1),id=`${kind}-${posts}`;
   const payload=options.body instanceof URLSearchParams?Object.fromEntries(options.body):JSON.parse(options.body);
   stored.set(id,{...payload,id,account_id:'fixture'});
   if(kind==='ads')ads++;
   return Response.json({id});
  });
  const run=async(body)=>{const result=response();await handler({method:'POST',headers:{},body:{action:'create_creative_test',...settings,items,...body}},result);return result;};
  const missing=await run({items:items.map(({reviewed_plan,...item})=>item)});assert.equal(missing.statusCode,400);assert.equal(posts,0);
  const changed=await run({costCapCents:2600});assert.equal(changed.statusCode,400);assert.equal(posts,0);
  drift=true;const rejected=await run({request_key:'drift'});assert.equal(rejected.statusCode,409,JSON.stringify(rejected.body));assert.equal(ads,0);
  drift=false;campaignDrift=true;
  const campaignChanged=await run({request_key:'campaign-drift'});assert.equal(campaignChanged.statusCode,409);assert.equal(ads,0);campaignDrift=false;
  const swapped=await run({request_key:'swapped',items:items.map((item,index)=>({...item,imageHash:`image-${1-index}`}))});assert.equal(swapped.statusCode,409);assert.equal(ads,0);
  const good=await run({request_key:'valid'});assert.equal(good.statusCode,200,JSON.stringify(good.body));assert.equal(good.body.success,true);assert.equal(ads,2);
  assert.deepEqual(good.body.results.map(row=>row.itemId),['item-0','item-1']);
  assert.notEqual(good.body.results[0].adsetId,good.body.results[1].adsetId);
  for(let i=0;i<2;i++){
   const packet=await readLaunchPacket(sql,good.body.results[i].adId);
   assert.equal(packet.snapshot.evidence.approvals.length,1);
   assert.equal(packet.snapshot.review.media[0].sha256,items[i].reviewed_plan.media[0].sha256);
   assert.equal(packet.snapshot.campaign.objective,'OUTCOME_SALES');
  }
  const replay=await run({request_key:'valid'});assert.equal(replay.statusCode,200);assert.equal(ads,2);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
test('actual creative-test confirmation blocks changed settings and forwards frozen confirmed plans',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=await readFile(new URL('../src/components/MetaPublishTool.jsx',import.meta.url),'utf8');
 const start=source.indexOf('  const confirmCreativeTestReview=async'),end=source.indexOf('  const pushAll=',start);
 const item={id:'one',hook:'Reviewed'},calls=[],errors=[];
 const context={queue:[item],publishReview:{items:[item],creativeTest:settings,fingerprint:'reviewed'},ctFingerprint:()=> 'changed',setPublishReviewError:message=>errors.push(message),setPublishReview:()=>{},launchCreativeTest:async(...args)=>calls.push(args)};
 const confirm=vm.runInNewContext(`${source.slice(start,end)}\nconfirmCreativeTestReview`,context);
 await confirm([{item,plan:{confirmed:false}}]);assert.equal(calls.length,0);assert.match(errors[0],/settings changed/);
 context.ctFingerprint=()=> 'reviewed';await confirm([{item,plan:{confirmed:false}}]);assert.equal(calls.length,1);assert.equal(calls[0][0][0].plan.confirmed,true);assert.equal(calls[0][1],settings);
});
