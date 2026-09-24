import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { applyCooCommand, ensureCooWorkspace } from '../api/_lib/coo.js';
import { createCooHandler } from '../api/coo-workspace.js';
import { emptyWorkspace, metricHealth, metricProgress, objectiveProgress, initiativeHealth, scorecardCsv } from '../src/lib/coo.js';
const now=new Date('2026-09-23T12:00:00Z');
function fixture() {
  let state=applyCooCommand(null,{action:'setup'},'coo',now);
  const save=(kind,values,id)=>{state=applyCooCommand(state,{action:'save',kind,values,id},'coo',now);return state;};
  save('cycle',{name:'2026',owner:'',description:'',start:'2026-01-01',end:'2026-12-31'});const annual=state.cycles.at(-1).id;
  save('cycle',{name:'Q3 2026',owner:'',description:'',start:'2026-07-01',end:'2026-09-30',parentId:annual});const cycleId=state.cycles.at(-1).id;
  const departmentId=state.departments[0].id;
  save('objective',{title:'Reliable production',owner:'COO',departmentId:'',cycleId:annual});const companyId=state.objectives.at(-1).id;
  save('objective',{title:'Improve fulfillment',owner:'Pat',departmentId,cycleId,parentId:companyId});const objectiveId=state.objectives.at(-1).id;
  const metric={title:'Defect rate',kind:'kr',owner:'Pat',departmentId,cycleId,objectiveId,baseline:10,target:2,unit:'%',direction:'decrease',cadence:7};
  save('metric',metric);const metricId=state.metrics.at(-1).id;
  const initiative={title:'Quality gate',owner:'Sam',departmentId,cycleId,objectiveId,dueDate:'2026-09-25',type:'initiative'};
  save('initiative',initiative);const initiativeId=state.initiatives.at(-1).id;
  return {state,annual,cycleId,departmentId,companyId,objectiveId,metric,metricId,initiative,initiativeId};
}
const command=(s,kind,id,values,action='save')=>applyCooCommand(s,{action,kind,id,values,expectedVersion:Object.values(s).flat().find(x=>x.id===id)?.version||1},'coo',now);
test('initial setup does not invent targets or actuals and cannot overwrite existing setup',()=>{
  const s=applyCooCommand(null,{action:'setup'},'coo',now);
  assert.equal(s.departments.length,3);assert.deepEqual(s.metrics,[]);assert.deepEqual(s.checkins,[]);
  assert.throws(()=>applyCooCommand(s,{action:'setup'},'coo',now),/already/);
});
test('annual to quarterly alignment, metric history, review snapshot and assigned follow-up',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-22',value:3,note:'New process',blocker:'Supplier variability',nextStep:'Review incoming inspection'},'checkin');
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').value,3);
  s=command(s,'review',undefined,{title:'Weekly operating review',owner:'COO',departmentId:'',cycleId:f.cycleId,date:'2026-09-23',decisions:'Add receiving inspection',lessons:'Inspect earlier'});
  const review=s.reviews[0];assert.equal(review.snapshot[0].value,3);
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:2},'checkin');assert.equal(s.reviews[0].snapshot[0].value,3);
  s=command(s,'initiative',undefined,{...f.initiative,type:'action',title:'Inspect parts',reviewId:review.id});assert.equal(s.initiatives.at(-1).reviewId,review.id);
  s=command(s,'initiative',undefined,{...f.initiative,type:'milestone',title:'Sign off SOP',parentInitiativeId:f.initiativeId});assert.equal(s.initiatives.at(-1).parentInitiativeId,f.initiativeId);
  assert.throws(()=>command(s,'review',review.id,{...review,title:'Rewrite history'}),/preserve/);
});
test('status handles decrease targets, zero targets, missing values, stale values, future cycles and historical cutoff',()=>{
  const f=fixture();assert.equal(metricHealth(f.state,f.state.metrics[0],'2026-09-23').status,'no-data');
  assert.equal(metricProgress(f.metric,6),.5);assert.equal(metricProgress({...f.metric,baseline:10,target:0},0),1);
  let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:2},'checkin');
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'on-track');
  assert.equal(metricHealth(s,s.metrics[0],'2027-01-01').status,'on-track');
  assert.equal(metricHealth(s,s.metrics[0],'2026-06-01').status,'not-started');
  s.checkins[0].date='2026-09-01';assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'stale');
  const kpi={...f.metric,kind:'kpi',baseline:0,target:0};s.metrics[0]=kpi;s.checkins[0].date='2026-09-23';s.checkins[0].value=0;kpi.id=f.metricId;
  assert.equal(metricHealth(s,kpi,'2026-09-23').status,'on-track');s.checkins[0].value=1;assert.equal(metricHealth(s,kpi,'2026-09-23').status,'off-track');
});
test('objective progress counts only key results and missing results are explicit',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:6},'checkin');
  s=command(s,'metric',undefined,{...f.metric,title:'Another KR'});
  s=command(s,'metric',undefined,{...f.metric,title:'Ongoing KPI',kind:'kpi'});
  assert.deepEqual(objectiveProgress(s,s.objectives[1],'2026-09-23'),{total:2,reported:1,progress:.25});
});
test('validation rejects bad dates, nonfinite actuals, wrong direction and incompatible relationships',()=>{
  const f=fixture();
  for(const values of [{...f.metric,target:20},{...f.metric,target:10},{...f.metric,baseline:NaN},{...f.metric,owner:''},{...f.metric,departmentId:'missing'},{...f.metric,cadence:0},{...f.metric,objectiveId:''}])assert.throws(()=>command(f.state,'metric',undefined,values));
  for(const values of [{date:'2026-02-30',value:2},{date:'2026-10-01',value:2},{date:'2026-06-30',value:2},{date:'2026-09-22',value:Infinity}])assert.throws(()=>command(f.state,'metric',f.metricId,values,'checkin'));
  assert.throws(()=>command(f.state,'initiative',undefined,{...f.initiative,dueDate:'2026-10-01'}),/inside/);
  assert.throws(()=>command(f.state,'cycle',undefined,{name:'Bad',start:'2026-01-01',end:'2027-01-01',parentId:f.annual}),/inside/);
});
test('same-date correction preserves both entries and latest wins',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:3},'checkin');
  s=applyCooCommand(s,{action:'checkin',kind:'metric',id:f.metricId,values:{date:'2026-09-23',value:2}},'pat',new Date('2026-09-23T13:00:00Z'));
  assert.equal(s.checkins.length,2);assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').value,2);
  assert.throws(()=>command(s,'metric',f.metricId,{...f.metric,target:1}),/history|retain/);
});
test('archives and parent edits cannot orphan active records; cycle dates protect history',()=>{
  const f=fixture();
  for(const [kind,id] of [['department',f.departmentId],['cycle',f.annual],['objective',f.companyId],['objective',f.objectiveId]])assert.throws(()=>command(f.state,kind,id,{},'archive'),/linked/);
  assert.throws(()=>command(f.state,'objective',f.objectiveId,{...f.state.objectives[1],cycleId:f.annual,parentId:''}),/Reassign/);
  let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:3},'checkin');
  assert.throws(()=>command(s,'cycle',f.cycleId,{...s.cycles[1],end:'2026-09-20'}),/contain/);
  s=command(s,'metric',f.metricId,{},'archive');assert.equal(s.checkins.length,1);assert.equal(s.metrics[0].archived,true);
});
test('dependencies reject cycles and milestones remain tied to top-level work',()=>{
  const f=fixture();let s=command(f.state,'initiative',undefined,{...f.initiative,title:'Second',dependencyId:f.initiativeId});const second=s.initiatives.at(-1).id;
  assert.throws(()=>command(s,'initiative',f.initiativeId,{...f.initiative,dependencyId:second}),/loop/);
  assert.throws(()=>command(s,'initiative',f.initiativeId,{...f.initiative,parentInitiativeId:f.initiativeId}),/top-level/);
  assert.throws(()=>command(s,'initiative',f.initiativeId,{},'archive'),/linked/);
  s=command(s,'initiative',f.initiativeId,{date:'2026-09-23',status:'done'},'checkin');assert.equal(initiativeHealth(s,s.initiatives[0],'2026-10-01').status,'done');
});
test('CSV escapes spreadsheet formula injection and quotes',()=>{
  const f=fixture();f.state.metrics[0].title='=SUM(1,2)';f.state.metrics[0].description='A "quoted" definition';
  const csv=scorecardCsv(f.state,f.state.metrics,'2026-09-23');assert.ok(csv.includes('"\'=SUM(1,2)"'));assert.ok(csv.includes('"A ""quoted"" definition"'));assert.ok(csv.includes('No update'));
});
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
test('API persists across reads, enforces permissions and detects stale writes using PostgreSQL',async()=>{
  const db=new PGlite(),restore=useTestDatabase(db);
  try {
    const sql=neon('postgres://test:test@localhost/test');await ensureCooWorkspace(sql);
    let write=true;const permissions=[];
    const handler=createCooHandler({authorize:async(req,res,p)=>{permissions.push(p);if(p==='analytics.write'&&!write){res.status(403).json({error:'Forbidden'});return null;}return {sql,userId:'coo',role:write?'owner':'viewer',permissions:write?['analytics.read','analytics.write']:['analytics.read']};}});
    const call=async(method,body)=>{const res=response();await handler({method,body},res);return res;};
    const initial=await call('GET');assert.deepEqual(initial.body.state,emptyWorkspace());assert.equal(initial.body.revision,0);
    const saved=await call('POST',{revision:0,command:{action:'setup'}});assert.equal(saved.statusCode,200);assert.equal(saved.body.revision,1);
    assert.equal((await call('GET')).body.state.departments.length,3);
    assert.equal((await call('POST',{revision:0,command:{action:'setup'}})).statusCode,409);
    assert.equal((await call('POST',{revision:1,command:{action:'save',kind:'metric',values:{}}})).statusCode,400);
    write=false;assert.equal((await call('GET')).statusCode,403);assert.equal((await call('POST',{revision:1,command:{action:'setup'}})).statusCode,403);
    assert.equal((await call('DELETE')).statusCode,405);assert.ok(permissions.includes('analytics.write'));
    assert.equal((await call('GET')).headers['Cache-Control'],'private, no-store');
  }finally{restore();await db.close();}
});

test('same-millisecond corrections use insertion order and an ended KR cannot remain at risk',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:3},'checkin');
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:2.5},'checkin');
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').value,2.5);
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-30').status,'off-track');
  assert.throws(()=>applyCooCommand(s,{action:'save',kind:'__proto__',values:{}},'coo',now),/Unknown/);
});
test('concurrent writes race at the SQL boundary without losing the winning update',async()=>{
  const db=new PGlite();let release;const gate=new Promise(resolve=>release=resolve);let reads=0;
  const restore=useTestDatabase(db,async(query)=>{if(query.startsWith('SELECT data')){reads++;if(reads===2)release();await gate;}});
  try{
    const sql=neon('postgres://test:test@localhost/test');await ensureCooWorkspace(sql);
    const handler=createCooHandler({authorize:async()=>({sql,userId:'coo',role:'owner',permissions:['*']})});
    const call=async()=>{const res=response();await handler({method:'POST',body:{revision:0,command:{action:'setup'}}},res);return res;};
    const results=await Promise.all([call(),call()]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
    const rows=await sql`SELECT revision,data FROM coo_workspace WHERE id='company'`;assert.equal(rows[0].revision,1);assert.equal(rows[0].data.departments.length,3);
  }finally{restore();await db.close();}
});

test('KPI thresholds can be below an already healthy baseline, unlike improvement goals',()=>{
  const f=fixture();const s=command(f.state,'metric',undefined,{...f.metric,title:'Healthy KPI',kind:'kpi',baseline:98,target:95,direction:'increase'});
  assert.equal(s.metrics.at(-1).target,95);assert.equal(metricProgress(s.metrics.at(-1),97),1);
});
test('archived objectives retain their archived key result progress',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:2},'checkin');
  s=command(s,'metric',f.metricId,{},'archive');s=command(s,'initiative',f.initiativeId,{},'archive');s=command(s,'objective',f.objectiveId,{},'archive');
  assert.equal(objectiveProgress(s,s.objectives[1],'2026-09-23').progress,1);
});

test('refreshing workspace revision cannot silently overwrite a newer version of the same record',()=>{
  const f=fixture();const old=f.state.metrics[0];
  const s=command(f.state,'metric',old.id,{...old,owner:'New owner'});
  assert.equal(s.metrics[0].version,2);
  assert.throws(()=>applyCooCommand(s,{action:'save',kind:'metric',id:old.id,expectedVersion:old.version,values:{...old,title:'Stale title'}},'coo',now),/record changed/);
});

test('COO access requires owner role, even with wildcard or analytics/admin permissions',async()=>{
  const {canAccessCoo}=await import('../src/lib/coo-access.js');
  assert.equal(canAccessCoo({role:'owner'}),true);
  for(const role of ['admin','strategist','producer','launcher','analyst','viewer','uninvited',undefined]) {
    assert.equal(canAccessCoo({role,permissions:['*']}),false);
    for(const method of ['GET','POST']) {
      let queried=false;
      const handler=createCooHandler({authorize:async()=>({role,userId:'not-owner',permissions:['*','analytics.read','analytics.write','admin.users'],sql:()=>{queried=true;throw Error('Must not query COO data');}})});
      const res=response();await handler({method,body:{revision:0,command:{action:'setup'}}},res);
      assert.equal(res.statusCode,403,`${role}: ${method}`);assert.equal(queried,false);
      assert.equal(res.body.state,undefined);
    }
  }
});
