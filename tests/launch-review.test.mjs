import test from 'node:test';import assert from 'node:assert/strict';import https from 'node:https';import {EventEmitter} from 'node:events';import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {useTestDatabase} from './neon-test-adapter.mjs';
import {initializeSchema} from '../api/db/schema.js';import {ensureWorkControls} from '../api/_lib/work-controls.js';import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {ensureOperationJournal,digest,runExternalStep} from '../api/_lib/operation-journal.js';
import {verifyReviewedLaunch} from '../api/_lib/reviewed-launch.js';import {fetchPublicResource} from '../api/_lib/safe-fetch.js';
import {newAdsetIntent,pairedPlacementRules,localMediaFingerprint} from '../src/lib/launch-review.js';import endpoint from '../api/launch-review.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});

test('streaming media review hashes exact chunks, rejects oversized streams and retains buffer mode',async t=>{
 const chunks=[Buffer.from('first'),Buffer.from('second')];
 t.mock.method(https,'get',(_url,options,callback)=>{
  const request=new EventEmitter();request.destroy=error=>{if(error)request.emit('error',error);request.emit('close');};
  queueMicrotask(()=>{
   options.lookup('fixture',{},(error,address)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');});
   const stream=new EventEmitter();stream.statusCode=200;stream.headers={'content-type':'image/png'};stream.destroy=()=>{};
   callback(stream);for(const chunk of chunks)stream.emit('data',chunk);stream.emit('end');request.emit('close');
  });return request;
 });
 const options={contentTypes:/^image\//,maxBytes:20};
 const result=await fetchPublicResource('https://8.8.8.8/image',{...options,hashOnly:true});
 assert.equal(result.sha256,createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));assert.equal(result.size,11);assert.equal(result.bytes,undefined);
 assert.deepEqual((await fetchPublicResource('https://8.8.8.8/image',options)).bytes,Buffer.concat(chunks));
 await assert.rejects(fetchPublicResource('https://8.8.8.8/image',{...options,maxBytes:5,hashOnly:true}),/size limit/);
 assert.equal(await localMediaFingerprint('data:image/png;base64,'+Buffer.concat(chunks).toString('base64')),result.sha256);
});

test('review comparison rejects changed copy, bytes, placement, approval and targeting',async()=>{
 const sha='a'.repeat(64),adset={id:'adset',account_id:'test',campaign_id:'campaign',targeting:{age_min:18}};
 const context={payload:{name:'Ad'},creative:{object_story_spec:{page_id:'page',link_data:{image_hash:'image',name:'Headline',message:'Copy',link:'https://example.test'}}},adset,
  media:{receipts:[{provider_id:'image',content_hash:sha}]},driveUploads:[],evidence:{approvals:[null]}};
 const plan={version:1,confirmed:true,ad_name:'Ad',approval_hash:digest([null]),fields:{headline:'Headline',primary_text:'Copy',dest_url:'https://example.test',url_tags:'',page_id:'page',instagram_user_id:''},media:[{role:'single',sha256:sha}],target:{mode:'existing',id:'adset',snapshot:structuredClone(adset)}};
 const sql=()=>{throw new Error('No SQL expected for existing ad sets');};
 assert.deepEqual(await verifyReviewedLaunch(sql,plan,context),plan);
 for(const change of [p=>p.fields.primary_text='Changed',p=>p.media[0].sha256='b'.repeat(64),p=>p.media[0].sha256=null,p=>p.approval_hash='b'.repeat(64),p=>p.target.snapshot.targeting.age_min=25,p=>p.confirmed=false]){
  const altered=structuredClone(plan);change(altered);await assert.rejects(verifyReviewedLaunch(sql,altered,context),error=>error.statusCode===409&&error.definitelyNotApplied);
 }
 const pair=structuredClone(context);pair.creative.object_story_spec={page_id:'page'};
 pair.creative.asset_feed_spec={images:[{hash:'image',adlabels:[{name:'image_feed'}]},{hash:'story',adlabels:[{name:'image_story'}]}],bodies:[{text:'Copy'}],titles:[{text:'Headline'}],link_urls:[{website_url:'https://example.test'}],asset_customization_rules:pairedPlacementRules()};
 pair.media.receipts.push({provider_id:'story',content_hash:sha});
 const paired={...plan,media:[{role:'feed',sha256:sha},{role:'story',sha256:sha}],placement_rules:pairedPlacementRules()};
 assert.ok(await verifyReviewedLaunch(sql,paired,pair));
 await assert.rejects(verifyReviewedLaunch(sql,{...paired,media:[paired.media[0],paired.media[0]]},pair),/roles/);
 await assert.rejects(verifyReviewedLaunch(sql,{...paired,placement_rules:pairedPlacementRules(true)},pair),/placement customization/);
 const drive={...plan,media:[{role:'single',drive_file_id:'file',drive_md5:'d'.repeat(32)}]};
 assert.ok(await verifyReviewedLaunch(sql,drive,{...context,driveUploads:[{step_key:'file',result:{imageHash:'image',contentMd5:'d'.repeat(32)}}]}));
 await assert.rejects(verifyReviewedLaunch(sql,drive,context),/Drive content/);
});

test('new ad-set review requires account-bound receipt and matching observed configuration',async()=>{
 const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await ensureOperationJournal(sql);
  const intent=newAdsetIntent({name:'Ad set',campaign_id:'campaign',daily_budget_dollars:10,objective:'OUTCOME_TRAFFIC'});
  const sha='a'.repeat(64),plan={version:1,confirmed:true,ad_name:'Ad',approval_hash:digest([]),fields:{headline:'Title',primary_text:'Copy',dest_url:'https://example.test',url_tags:'',page_id:'page',instagram_user_id:''},media:[{role:'single',sha256:sha}],target:{mode:'new',request:intent}};
  const context={payload:{name:'Ad'},creative:{object_story_spec:{page_id:'page',link_data:{image_hash:'image',name:'Title',message:'Copy',link:'https://example.test'}}},adset:{...intent,id:'new',account_id:'test'},media:{receipts:[{provider_id:'image',content_hash:sha}]},driveUploads:[],evidence:{approvals:[]}};
  await assert.rejects(verifyReviewedLaunch(sql,plan,context),/no verified receipt/);
  await runExternalStep(sql,{operationKey:'fixture',stepKey:'1:/v21.0/act_test/adsets',actorId:'fixture',payload:intent},async()=>({body:{id:'new'}}));
  assert.ok(await verifyReviewedLaunch(sql,plan,context));
  await assert.rejects(verifyReviewedLaunch(sql,plan,{...context,adset:{...context.adset,targeting:{age_min:25}}}),/targeting differs/);
  assert.throws(()=>newAdsetIntent({name:'x',campaign_id:'c',daily_budget_dollars:-1}),/positive daily budget/);
 }finally{await db.close();}
});

test('review endpoint returns evidence without provider mutation and releases leases on failure',async()=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
  await initializeSchema(sql);await ensureWorkControls(sql);await ensureRateLimits(sql);
  const body={input:{sourceType:'tool_generated'},media:[{role:'single',sha256:'a'.repeat(64)}],new_adset:{name:'Set',campaign_id:'campaign',daily_budget_dollars:10,objective:'OUTCOME_TRAFFIC'}};
  const success=response();await endpoint({method:'POST',headers:{},body},success);
  assert.equal(success.statusCode,200);assert.equal(success.body.approval_hash,digest([null]));assert.equal(success.body.new_adset.status,'PAUSED');
  const invalid=response();await endpoint({method:'POST',headers:{},body:{...body,media:[{role:'single',sha256:'invalid'}]}},invalid);assert.equal(invalid.statusCode,400);
  const [lane]=await sql`SELECT leases FROM app_work_lanes WHERE kind='launch-review'`;assert.deepEqual(lane.leases,[]);
  delete process.env.AUTH_DISABLED;delete process.env.HOWL_USE_PRODUCTION_AUTH;process.env.CLERK_SECRET_KEY='sk_test_fixture';
  const denied=response();await endpoint({method:'POST',headers:{},body},denied);assert.equal(denied.statusCode,401);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
