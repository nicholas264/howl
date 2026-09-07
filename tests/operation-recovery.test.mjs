import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {initializeSchema} from '../api/db/schema.js';
import {ensureOperationJournal} from '../api/_lib/operation-journal.js';
import {recoverMetaAd,verifyRecoveredMetaCampaign} from '../api/_lib/operation-recovery.js';
import {useTestDatabase} from './neon-test-adapter.mjs';

test('receipt recovery atomically audits success and refuses a concurrent journal change',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous=process.env.META_AD_ACCOUNT_ID;
 const sql=neon('postgresql://test:test@fixture.local/test');
 try{
  process.env.META_AD_ACCOUNT_ID='123';
  await initializeSchema(sql);await ensureOperationJournal(sql);
  const stepKey='1:/v21.0/act_123/ads',time=new Date(Date.now()-1200000).toISOString();
  const payload={name:'Recovery fixture',adset_id:'456',creative:{creative_id:'789'},status:'PAUSED'};
  for(const key of ['success','raced','invalid'])await sql`INSERT INTO app_operation_steps(operation_key,step_key,request_hash,request_payload,status,created_at,updated_at) VALUES (${key},${stepKey},'fixture',${JSON.stringify(payload)}::jsonb,'uncertain',${time},${time})`;
  const ad={id:'1000',name:payload.name,adset_id:'456',creative:{id:'789'},account_id:'123',created_time:time};
  const options=key=>({operationKey:key,stepKey,providerId:'1000',actorId:'fixture-admin',note:'Verified original request'});
  const receipt=await recoverMetaAd(sql,options('success'),async url=>{assert.equal(url.hostname,'graph.facebook.com');return Response.json(ad);});
  assert.equal(receipt.body.id,'1000');
  assert.equal((await sql`SELECT status FROM app_operation_steps WHERE operation_key='success'`)[0].status,'completed');
  assert.equal((await sql`SELECT count(*) AS n FROM app_admin_audit WHERE target='success' AND action='operation.reconciled'`)[0].n,'1');
  await assert.rejects(recoverMetaAd(sql,options('raced'),async()=>{
   await sql`UPDATE app_operation_steps SET updated_at=now(),status='completed',result='{"original":true}'::jsonb WHERE operation_key='raced'`;
   return Response.json(ad);
  }),/changed while/);
  assert.deepEqual((await sql`SELECT result FROM app_operation_steps WHERE operation_key='raced'`)[0].result,{original:true});
  await assert.rejects(recoverMetaAd(sql,options('invalid'),async()=>Response.json({...ad,account_id:'999'})),/different account/);
  assert.equal((await sql`SELECT count(*) AS n FROM app_admin_audit WHERE target IN ('raced','invalid')`)[0].n,'0');
  assert.equal((await sql`SELECT status FROM app_operation_steps WHERE operation_key='invalid'`)[0].status,'uncertain');
  const campaignKey='1:/v21.0/act_123/campaigns';
  const campaignPayload={name:'Campaign fixture',objective:'OUTCOME_SALES',status:'PAUSED',special_ad_categories:[],is_adset_budget_sharing_enabled:false};
  await sql`INSERT INTO app_operation_steps(operation_key,step_key,request_hash,request_payload,status,created_at,updated_at) VALUES ('campaign',${campaignKey},'fixture',${JSON.stringify(campaignPayload)}::jsonb,'uncertain',${time},${time})`;
  const campaign={...campaignPayload,id:'2000',account_id:'123',created_time:time};
  await recoverMetaAd(sql,{...options('campaign'),stepKey:campaignKey,providerId:'2000'},async url=>{assert.ok(url.searchParams.get('fields').includes('is_adset_budget_sharing_enabled'));return Response.json(campaign);});
  assert.equal((await sql`SELECT result FROM app_operation_steps WHERE operation_key='campaign'`)[0].result.body.id,'2000');
  assert.equal((await sql`SELECT count(*) AS n FROM app_admin_audit WHERE target='campaign'`)[0].n,'1');
  const campaignStep={step_key:campaignKey,request_payload:campaignPayload,created_at:time,updated_at:time};
  for(const wrong of [{...campaign,account_id:'999'},{...campaign,status:'ACTIVE'},{...campaign,objective:'OUTCOME_TRAFFIC'},{...campaign,is_adset_budget_sharing_enabled:true},{...campaign,special_ad_categories:['CREDIT']},{...campaign,created_time:'2000-01-01'}])assert.throws(()=>verifyRecoveredMetaCampaign(campaignStep,wrong,'123'));
  assert.throws(()=>verifyRecoveredMetaCampaign({...campaignStep,request_payload:{...campaignPayload,daily_budget:'1000'}},campaign,'123'),/fields/);

 }finally{restore();if(previous===undefined)delete process.env.META_AD_ACCOUNT_ID;else process.env.META_AD_ACCOUNT_ID=previous;await db.close();}
});
