import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {resolveNewAdset} from '../api/_lib/launch-adset.js';
import {ensureOperationJournal,createMetaOperationFetch,runExternalStep} from '../api/_lib/operation-journal.js';
const input={name:'New ad set',campaign_id:'123',daily_budget_dollars:50,objective:'OUTCOME_TRAFFIC',pixel_id:'pixel'};
async function resolve(campaign,adsets=[{bid_amount:15000,status:'ACTIVE'}]){
  const saved=process.env.META_AD_ACCOUNT_ID;process.env.META_AD_ACCOUNT_ID='act_456';
  try{return await resolveNewAdset(input,{fetchImpl:async url=>new Response(JSON.stringify(url.includes('/adsets?')?{data:adsets}:{id:'123',account_id:'456',objective:'OUTCOME_SALES',...campaign}))});}
  finally{if(saved===undefined)delete process.env.META_AD_ACCOUNT_ID;else process.env.META_AD_ACCOUNT_ID=saved;}
}
test('campaign-budget cost cap inherits its bid and omits conflicting ad-set budget and strategy',async()=>{
  const {request}=await resolve({daily_budget:'150000',bid_strategy:'COST_CAP'});
  assert.equal(request.bid_amount,15000);assert.equal(request.daily_budget,undefined);assert.equal(request.bid_strategy,undefined);
  assert.equal(request.status,'PAUSED');assert.equal(request.optimization_goal,'OFFSITE_CONVERSIONS');
});
test('ad-set budgets retain the requested budget; lifetime campaign budgets also inherit',async()=>{
  assert.equal((await resolve({bid_strategy:'LOWEST_COST_WITHOUT_CAP'})).request.daily_budget,'5000');
  assert.equal((await resolve({lifetime_budget:'150000',bid_strategy:'LOWEST_COST_WITHOUT_CAP'})).request.daily_budget,undefined);
});
test('ambiguous or missing caps fail with instructions instead of choosing a financial setting',async()=>{
  await assert.rejects(resolve({daily_budget:'150000',bid_strategy:'COST_CAP'},[{bid_amount:10000,status:'ACTIVE'},{bid_amount:15000,status:'ACTIVE'}]),/Select an existing ad set/);
  await assert.rejects(resolve({bid_strategy:'COST_CAP'},[]),/Select an existing ad set/);
});
test('Meta detailed errors survive journaling and corrected rejected payloads can retry safely',async()=>{
  const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  try{
    await ensureOperationJournal(sql);
    const detail={message:'Invalid parameter',error_user_msg:'Bid amount required',error_subcode:1815857};
    const wrapped=await createMetaOperationFetch(sql,{body:{action:'create_adset'}},'actor',async()=>new Response(JSON.stringify({error:detail}),{status:400}));
    await assert.rejects(wrapped('https://graph.facebook.com/v21.0/act_456/adsets',{method:'POST',body:JSON.stringify(input)}),error=>error.message==='Bid amount required'&&error.detail.error_subcode===1815857);
    const step={operationKey:'retry',stepKey:'adset',payload:{bid:0}};
    await assert.rejects(runExternalStep(sql,step,async()=>{throw Object.assign(new Error('rejected'),{definitelyNotApplied:true});}));
    assert.deepEqual(await runExternalStep(sql,{...step,payload:{bid:15000}},async()=>({id:'ok'})),{id:'ok'});
    await assert.rejects(runExternalStep(sql,{...step,payload:{bid:20000}},async()=>({id:'duplicate'})),/operation changed/);
  }finally{await db.close();}
});
