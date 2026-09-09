import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {ensureOperationJournal,runExternalStep,createMetaOperationFetch,operationKey} from '../api/_lib/operation-journal.js';
import {ensureProviderMedia} from '../api/_lib/provider-media.js';
import {readLaunchPacket} from '../api/_lib/launch-packets.js';
import {recoverMetaAd} from '../api/_lib/operation-recovery.js';
import endpoint from '../api/launch-packets.js';import {useTestDatabase} from './neon-test-adapter.mjs';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});

test('launch snapshots precede dispatch, survive replay and recovery, and reject incomplete evidence',async()=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{META_AD_ACCOUNT_ID:'test',META_ACCESS_TOKEN:'synthetic-secret',AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
  await ensureOperationJournal(sql);await ensureProviderMedia(sql);
  await db.exec('CREATE TABLE app_admin_audit(id SERIAL PRIMARY KEY,actor_id TEXT,action TEXT,target TEXT,metadata JSONB)');
  await runExternalStep(sql,{operationKey:'creative',stepKey:'1:/v21.0/act_test/adcreatives',actorId:'fixture',payload:{object_story_spec:JSON.stringify({page_id:'page',link_data:{image_hash:'image',name:'Title',message:'Copy',link:'https://example.test/product'}})}},async()=>({status:200,body:{id:'creative'}}));
  await sql`INSERT INTO provider_media(account_id,kind,provider_id,source_url,request_key,content_hash) VALUES ('act_test','image','image','https://example.test/image.png','upload','fixture-sha')`;
  const request=key=>({headers:{},body:{action:'create_ad_from_creative',request_key:key},captureLaunchEvidence:async()=>({approvals:[],attribution:[{sourceType:'tool_generated'}]})});
  const init=name=>({method:'POST',body:new URLSearchParams({name,adset_id:'adset',creative:JSON.stringify({creative_id:'creative'}),status:'PAUSED',access_token:'synthetic-secret'})});
  const url='https://graph.facebook.com/v21.0/act_test/ads';let reads=0,creates=0;
  const provider=async(target,options)=>{
   if(options.method!=='POST'){
    reads++;assert.equal(options.headers.Authorization,'Bearer synthetic-secret');
    return Response.json({id:'adset',account_id:'test',campaign_id:'campaign',targeting:{publisher_platforms:['facebook'],facebook_positions:['feed']},access_token:'must-not-be-saved'});
   }
   creates++;
   const [pending]=await sql`SELECT result FROM app_operation_steps WHERE status='pending' AND step_key LIKE '%/ads'`;
   assert.ok(pending.result.launch_packet_key,'snapshot linked before provider mutation');
   return Response.json({id:'12345'});
  };
  const req=request('success');await (await createMetaOperationFetch(sql,req,'fixture',provider))(url,init('Ad'));
  const packet=await readLaunchPacket(sql,'12345');assert.ok(packet);assert.equal(packet.snapshot.media_receipts.length,1);
  assert.deepEqual(packet.snapshot.adset.targeting.facebook_positions,['feed']);assert.equal(packet.snapshot.actor_id,'fixture');
  assert.equal(typeof packet.snapshot.media_receipts[0].created_at,'string');
  assert.ok(!JSON.stringify(packet).includes('synthetic-secret'));assert.ok(!JSON.stringify(packet).includes('must-not-be-saved'));
  await (await createMetaOperationFetch(sql,req,'fixture',provider))(url,init('Ad'));
  assert.equal(reads,1);assert.equal(creates,1);assert.deepEqual(await readLaunchPacket(sql,'12345'),packet);
  const read=response();await endpoint({method:'GET',headers:{},query:{ad_id:'12345'}},read);assert.equal(read.statusCode,200);assert.deepEqual(read.body.packet,packet);
  const legacy=response();await endpoint({method:'GET',headers:{},query:{ad_id:'old'}},legacy);assert.equal(legacy.body.packet,null);
  const stale=request('stale');stale.captureLaunchEvidence=async()=>{throw new Error('Changed approval');};
  await assert.rejects((await createMetaOperationFetch(sql,stale,'fixture',provider))(url,init('Stale')),/Changed approval/);assert.equal(creates,1);
  const failedSql=async(parts,...values)=>{if(parts.join('').includes('WITH packet AS'))throw new Error('Snapshot storage unavailable');return sql(parts,...values);};
  await assert.rejects((await createMetaOperationFetch(failedSql,request('storage'),'fixture',provider))(url,init('Storage')),/Snapshot storage unavailable/);assert.equal(creates,1);
  await assert.rejects((await createMetaOperationFetch(sql,request('foreign'),'fixture',async()=>Response.json({id:'adset',account_id:'other',campaign_id:'campaign',targeting:{}})))(url,init('Foreign')),/verify the ad set/);
  const unknown=request('unknown'),unknownKey=operationKey(unknown,'fixture','meta');
  await assert.rejects((await createMetaOperationFetch(sql,unknown,'fixture',async(target,options)=>{if(options.method==='POST')throw new Error('Lost response');return provider(target,options);}))(url,init('Unknown')),/Lost response/);
  const [before]=await sql`SELECT result,status FROM app_operation_steps WHERE operation_key=${unknownKey} AND step_key LIKE '%/ads'`;
  assert.equal(before.status,'uncertain');assert.ok(before.result.launch_packet_key);
  await sql`UPDATE app_operation_steps SET created_at=now()-interval '20 minutes',updated_at=now()-interval '11 minutes' WHERE operation_key=${unknownKey} AND step_key LIKE '%/ads'`;
  const recovered=await recoverMetaAd(sql,{operationKey:unknownKey,stepKey:'1:/v21.0/act_test/ads',providerId:'67890',actorId:'owner',note:'Fixture'},async()=>Response.json({id:'67890',account_id:'test',name:'Unknown',adset_id:'adset',creative:{id:'creative'},created_time:new Date(Date.now()-15*60000).toISOString()}));
  assert.equal(recovered.launch_packet_key,before.result.launch_packet_key);assert.ok(await readLaunchPacket(sql,'67890'));
  await sql`UPDATE app_operation_steps SET result=result || '{"actor_id":"tampered"}'::jsonb WHERE operation_key=${unknownKey} AND step_key=${recovered.launch_packet_key}`;
  await assert.rejects(readLaunchPacket(sql,'67890'),/integrity/);
  delete process.env.AUTH_DISABLED;delete process.env.HOWL_USE_PRODUCTION_AUTH;process.env.CLERK_SECRET_KEY='sk_test_validfixture';
  const denied=response();await endpoint({method:'GET',headers:{},query:{ad_id:'12345'}},denied);assert.equal(denied.statusCode,401);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
