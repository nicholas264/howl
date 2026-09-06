import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { priceUsage, modelRequest, parseModelResult, providerError, DEFAULT_SETTINGS } from '../api/_lib/static-studio-models.js';
import { askStudioModel, ensureStudioCosts, loadModelSettings, saveModelSettings, studioCosts } from '../api/_lib/static-studio-costs.js';
import { claimWork, ensureWorkControls } from '../api/_lib/work-controls.js';
const env={OPENAI_API_KEY:'fixture-openai',ANTHROPIC_API_KEY:'fixture-anthropic'};
const db=new PGlite();
const sql=async(parts,...values)=>(await db.query(parts.reduce((q,p,i)=>q+(i?`$${i}`:'')+p,''),values)).rows;
test.before(async()=>{await ensureStudioCosts(sql);await ensureWorkControls(sql);});
test.after(()=>db.close());
const response=(text='{"ok":true}')=>({model:'gpt-6-astra',status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text}]}]});

test('token costs count reasoning once and distinguish provider cache accounting',()=>{
  assert.equal(priceUsage('gpt-6-astra',{input_tokens:10000,output_tokens:2000,input_tokens_details:{cached_tokens:8000},output_tokens_details:{reasoning_tokens:1500}}).costUsd,.128);
  const usage=priceUsage('claude-fable-5-1',{input_tokens:1000,output_tokens:2000,cache_read_input_tokens:8000,cache_creation_input_tokens:1000});
  assert.equal(usage.inputTokens,10000);assert.equal(usage.costUsd,.1245);
  assert.equal(priceUsage('claude-opus-5',{input_tokens:0,output_tokens:0,cache_creation_input_tokens:1000,cache_creation:{ephemeral_1h_input_tokens:1000}}).costUsd,.01);
  assert.equal(priceUsage('gpt-6-astra',{input_tokens:300000,output_tokens:2000}).costUsd,6.15);
  assert.equal(priceUsage('gpt-6-astra',{}),null);
  assert.match(providerError(400,{error:{message:'Your credit balance is too low'}}),/insufficient credits/);
  assert.equal(priceUsage('unknown',{input_tokens:100,output_tokens:100}),null);
  assert.equal(priceUsage('gpt-6-astra',{input_tokens:2,output_tokens:1,input_tokens_details:{cached_tokens:3}}),null);
});
test('provider request contracts preserve photos, use reasoning-compatible parameters and reject truncation',()=>{
  const content=[{type:'text',text:'Brief'},{type:'image',source:{media_type:'image/png',data:'AAAA'}}];
  const openai=modelRequest('gpt-6-astra','System',content,8000,env),body=JSON.parse(openai.init.body);
  assert.equal(openai.url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.reasoning.effort,'high');
  assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,AAAA');assert.ok(body.max_output_tokens>8000);assert.equal(body.temperature,undefined);
  const claude=JSON.parse(modelRequest('claude-fable-5-1','System',content,2000,env).init.body);
  assert.equal(claude.thinking.type,'adaptive');assert.deepEqual(claude.messages[0].content,content);
  assert.throws(()=>parseModelResult('gpt-6-astra',{...response(),status:'incomplete'}),/did not finish/);
  assert.throws(()=>modelRequest('gpt-6-astra','',[],2000,{}),/OPENAI_API_KEY/);
});
test('settings and all monthly cost views are isolated to the authenticated studio owner',async()=>{
  assert.deepEqual(await loadModelSettings(sql,'alice'),DEFAULT_SETTINGS);
  await saveModelSettings(sql,'alice',{creativeModel:'claude-opus-5',reviewModel:'gpt-6-astra',monthlyTarget:500});
  assert.equal((await loadModelSettings(sql,'bob')).creativeModel,'gpt-6-astra');
  await assert.rejects(saveModelSettings(sql,'alice',{...DEFAULT_SETTINGS,creativeModel:'arbitrary-url'}),/supported/);
  await assert.rejects(saveModelSettings(sql,'alice',{...DEFAULT_SETTINGS,monthlyTarget:NaN}),/target/);
  await askStudioModel({sql,userId:'bob'},'direct','System',[],2000,{env,fetchImpl:async()=>Response.json(response())});
  const bob=await studioCosts(sql,'bob',null,env),alice=await studioCosts(sql,'alice',null,{});
  assert.match(bob.recent[0].created_at,/^20\d\d-\d\d-\d\dT/);
  assert.equal(bob.summary.requests,1);assert.equal(bob.summary.cost,.015);assert.equal(alice.summary.requests,0);
  assert.equal(alice.recent.length,0);assert.ok(alice.models.every(m=>!m.configured));
  assert.ok(!JSON.stringify(bob).includes('fixture-openai'));
  assert.equal((await studioCosts(sql,'bob','2020-01',env)).summary.requests,0);
  await assert.rejects(studioCosts(sql,'bob','2026-13',env),/valid month/);
});
test('review routes to Fable; usage is recorded in both studio ledger and shared paid work',async()=>{
  const workId=await claimWork(sql,'analysis','critic');let called;
  await askStudioModel({sql,userId:'critic',workId},'review','Review',[],2000,{env,fetchImpl:async(url,init)=>{
    called={url,body:JSON.parse(init.body)};return Response.json({model:'claude-fable-5-1',stop_reason:'end_turn',content:[{type:'text',text:'{"verdict":"pass"}'}],usage:{input_tokens:1000,output_tokens:100}});
  }});
  assert.equal(called.body.model,'claude-fable-5-1');assert.match(called.url,/anthropic/);
  const [work]=await sql`SELECT cost_usd,model FROM app_work_runs WHERE id=${workId}`;
  assert.equal(Number(work.cost_usd),.015);assert.equal(work.model,'claude-fable-5-1');
});
test('paid invalid outputs, timeouts, unknown models and rejected calls never disappear or become free',async()=>{
  const access={sql,userId:'failures'};
  await assert.rejects(askStudioModel(access,'direct','',[],2000,{env,fetchImpl:async()=>Response.json(response('invalid'))}),/invalid JSON/);
  await assert.rejects(askStudioModel(access,'direct','',[],2000,{env,fetchImpl:async()=>{throw new Error('socket lost');}}),/may still be billed/);
  await assert.rejects(askStudioModel(access,'review','',[],2000,{env,fetchImpl:async()=>Response.json({error:{message:'secret diagnostic'}},{status:429})}),/quota/);
  await askStudioModel(access,'direct','',[],2000,{env,fetchImpl:async()=>Response.json({...response(),model:'unpriced-fallback'})});
  const costs=await studioCosts(sql,'failures',null,env);
  assert.equal(costs.summary.requests,4);assert.equal(costs.summary.unknown,3);assert.equal(costs.summary.cost,.015);
  assert.ok(costs.recent.some(r=>r.status==='failed' && Number(r.cost_usd)===.015));
});
test('ledger failure prevents a paid request from being sent',async()=>{
  let calls=0;
  await assert.rejects(askStudioModel({userId:'offline',sql:async()=>{throw new Error('database unavailable');}},'direct','',[],2000,{env,fetchImpl:async()=>{calls++;}}));
  assert.equal(calls,0);
});
test('actual costs API and settings API persist through Neon encoding',async()=>{
  const restore=useTestDatabase(db),previous={AUTH_DISABLED:process.env.AUTH_DISABLED,NODE_ENV:process.env.NODE_ENV,DATABASE_URL:process.env.DATABASE_URL,CLERK_SECRET_KEY:process.env.CLERK_SECRET_KEY};
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@localhost/test'});
  try{
    const {default:handler}=await import('../api/static-studio.js');
    let data,status=200,cache;
    const res={setHeader(k,v){if(k==='Cache-Control')cache=v;},status(n){status=n;return this;},json(d){data=d;}};
    await handler({method:'POST',body:{action:'model-settings',settings:{...DEFAULT_SETTINGS,monthlyTarget:750}},headers:{}},res);
    assert.equal(status,200);assert.equal(data.settings.monthlyTarget,750);
    await handler({method:'GET',query:{view:'costs'},headers:{}},res);
    assert.equal(data.settings.monthlyTarget,750);assert.equal(cache,'private, no-store');assert.equal(data.summary.requests,0);
    process.env.NODE_ENV='production';process.env.CLERK_SECRET_KEY='sk_test_fixture';
    await handler({method:'GET',query:{view:'costs'},headers:{}},res);
    assert.equal(status,401);
    await handler({method:'POST',body:{action:'model-settings',settings:DEFAULT_SETTINGS},headers:{}},res);
    assert.equal(status,401);
  }finally{restore();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
