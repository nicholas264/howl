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
  let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:2,forecast:2},'checkin');
  s.metrics[0].plan=[{date:'2026-09-23',value:2},{date:'2026-09-30',value:2}];
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'on-track');
  assert.equal(metricHealth(s,s.metrics[0],'2027-01-01').status,'on-track');
  assert.equal(metricHealth(s,s.metrics[0],'2026-06-01').status,'not-started');
  s.checkins[0].date='2026-09-01';assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'stale');
  const kpi={...f.metric,kind:'kpi',baseline:0,target:0};s.metrics[0]=kpi;s.checkins[0].date='2026-09-23';s.checkins[0].value=0;kpi.id=f.metricId;kpi.plan=[{date:'2026-09-23',value:0},{date:'2026-09-30',value:0}];s.checkins[0].forecast=0;
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
    const handler=createCooHandler({authorize:async()=>({sql,userId:'coo',role:'owner',permissions:['*']}),now:()=>now});
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

test('checkpoint pace uses the reporting date, preserves seasonal jumps, and separates forecast from goal',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{...f.metric,baseline:0,target:1000,unit:'units',direction:'increase',tolerance:25,plan:[{date:'2026-07-31',value:100},{date:'2026-08-31',value:400},{date:'2026-09-30',value:1000}]});
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:320,forecast:800},'checkin');
  const h=metricHealth(s,s.metrics[0],'2026-09-23');
  assert.equal(h.planned,400);assert.equal(h.forecast,800);assert.equal(h.variance,-80);assert.equal(h.forecastGap,-200);assert.equal(h.planStatus,'off-track');assert.equal(h.forecastStatus,'off-track');
  assert.equal(s.metrics[0].target,1000);
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:450,forecast:800},'checkin');
  const later=metricHealth(s,s.metrics[0],'2026-09-23');assert.equal(later.planStatus,'on-track');assert.equal(later.forecastStatus,'off-track');assert.equal(later.status,'off-track');
  s.checkins.at(-1).date='2026-08-30';s.checkins[0].date='2026-08-29';
  const stale=metricHealth(s,s.metrics[0],'2026-09-23');assert.equal(stale.planned,100);assert.equal(stale.plannedNow,400);assert.equal(stale.status,'stale');
});
test('missing plan and forecast are explicit; tolerance supports lower-is-better and zero expected finish',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{date:'2026-09-23',value:5},'checkin');
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'no-plan');
  s=command(s,'metric',f.metricId,{...s.metrics[0],tolerance:.5,plan:[{date:'2026-07-01',value:5},{date:'2026-09-30',value:2}]});
  assert.equal(metricHealth(s,s.metrics[0],'2026-09-23').status,'no-forecast');
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:5.3,forecast:0},'checkin');
  const h=metricHealth(s,s.metrics[0],'2026-09-23');assert.equal(h.planStatus,'at-risk');assert.equal(h.forecastStatus,'on-track');assert.equal(h.forecast,0);
});
test('agreed checkpoints and goal remain locked while forecast revisions remain in history',()=>{
  const f=fixture();let s=command(f.state,'metric',f.metricId,{...f.metric,plan:[{date:'2026-09-30',value:2}]});
  assert.throws(()=>command(s,'metric',f.metricId,{...s.metrics[0],plan:[{date:'2026-09-29',value:2},{date:'2026-09-30',value:2}]}),/locked/);
  assert.throws(()=>command(s,'metric',f.metricId,{...s.metrics[0],target:1,plan:[{date:'2026-09-30',value:1}]}),/locked/);
  s=command(s,'metric',f.metricId,{date:'2026-09-22',value:5,forecast:4},'checkin');
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:4,forecast:3},'checkin');
  assert.deepEqual(s.checkins.map(c=>c.forecast),[4,3]);assert.equal(s.metrics[0].target,2);
  for(const plan of [[{date:'2026-09-30',value:9}],[{date:'2026-09-29',value:2}],[{date:'2026-09-30',value:2},{date:'2026-09-30',value:2}],[{date:'2026-02-30',value:2}]])assert.throws(()=>command(f.state,'metric',undefined,{...f.metric,plan}));
});
test('one constraint spans departments, links actions, and has its own resolution history',async()=>{
  const {constraintsForMetric,constraintHealth}=await import('../src/lib/coo.js');
  const f=fixture();let s=command(f.state,'metric',undefined,{...f.metric,kind:'kpi',objectiveId:'',title:'Revenue at risk',departmentId:f.state.departments[1].id});const second=s.metrics.at(-1);
  s=command(s,'constraint',undefined,{title:'Missing component',owner:'Sourcing lead',departmentId:f.state.departments[2].id,cycleId:f.cycleId,metricIds:[f.metricId,second.id],objectiveIds:[],dueDate:'2026-09-29',impact:'Production and sales at risk',decision:'Approve expedited freight'});const constraint=s.constraints[0];
  assert.equal(constraintsForMetric(s,s.metrics[0])[0].id,constraint.id);assert.equal(constraintsForMetric(s,second)[0].id,constraint.id);
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:4,forecast:3,constraintUpdate:{id:constraint.id,status:'in-progress',note:'Samples received'},followUp:{title:'Inspect samples',owner:'QA lead',dueDate:'2026-09-25'}},'checkin');
  assert.equal(s.initiatives.at(-1).constraintId,constraint.id);assert.equal(constraintHealth(s,constraint,'2026-09-23').reportedStatus,'in-progress');
  s=command(s,'review',undefined,{title:'Review',owner:'COO',cycleId:f.cycleId,departmentId:f.departmentId,date:'2026-09-23'});
  assert.equal(s.reviews[0].constraintSnapshot.length,1);assert.equal(s.reviews[0].snapshot[0].forecast,3);
  s=command(s,'constraint',constraint.id,{date:'2026-09-23',status:'resolved',note:'Approved'},'checkin');
  assert.equal(constraintHealth(s,constraint,'2026-09-23').reportedStatus,'resolved');assert.equal(s.reviews[0].constraintSnapshot[0].reportedStatus,'in-progress');
  assert.throws(()=>command(s,'metric',f.metricId,{},'archive'),/linked/);
});
test('combined progress creates a constraint and action in one save, with all-or-nothing PostgreSQL persistence',async()=>{
  const f=fixture();const db=new PGlite(),restore=useTestDatabase(db);
  try {
    const sql=neon('postgres://test:test@localhost/test');await ensureCooWorkspace(sql);await sql`INSERT INTO coo_workspace(id,data,updated_by) VALUES('company',${JSON.stringify(f.state)}::jsonb,'coo')`;
    const handler=createCooHandler({authorize:async()=>({sql,userId:'coo',role:'owner',permissions:['*']}),now:()=>now});
    const values={date:'2026-09-23',value:5,forecast:4,constraintUpdate:{title:'Material shortage',owner:'Buyer',dueDate:'2026-09-28',status:'blocked',note:'Need replacement material'},followUp:{title:'Order material',owner:'Buyer',dueDate:'2026-10-01'}};
    const call=async(v)=>{const res=response();await handler({method:'POST',body:{revision:1,command:{action:'checkin',kind:'metric',id:f.metricId,values:v}}},res);return res;};
    assert.equal((await call(values)).statusCode,400);
    let [row]=await sql`SELECT data,revision FROM coo_workspace WHERE id='company'`;assert.equal(row.revision,1);assert.equal(row.data.checkins.length,0);assert.equal(row.data.constraints.length,0);
    const result=await call({...values,followUp:{...values.followUp,dueDate:'2026-09-28'}});assert.equal(result.statusCode,200);
    [row]=await sql`SELECT data,revision FROM coo_workspace WHERE id='company'`;assert.equal(row.revision,2);assert.equal(row.data.checkins.length,2);assert.equal(row.data.constraints.length,1);assert.equal(row.data.initiatives.at(-1).constraintId,row.data.constraints[0].id);
  }finally{restore();await db.close();}
});
test('monthly financial import is cumulative, excludes ratios, and fails on missing, duplicate or partial periods',async()=>{
  const {forecastPlan}=await import('../src/lib/coo.js');const cycle={start:'2026-07-01',end:'2026-09-30'};
  const forecast={months:[{month:'2026-07',netRevenue:100},{month:'2026-08',netRevenue:200},{month:'2026-09',netRevenue:700}]};
  const result=forecastPlan(forecast,'netRevenue',cycle);assert.equal(result.target,1000);assert.deepEqual(result.plan.map(p=>p.value),[100,300,1000]);assert.equal(result.plan.at(-1).date,cycle.end);
  assert.throws(()=>forecastPlan(forecast,'grossMarginPct',cycle));
  assert.throws(()=>forecastPlan({months:forecast.months.slice(1)},'netRevenue',cycle),/Missing/);
  assert.throws(()=>forecastPlan({months:[...forecast.months,forecast.months[0]]},'netRevenue',cycle),/ambiguous/);
  assert.throws(()=>forecastPlan(forecast,'netRevenue',{...cycle,start:'2026-07-15'}),/whole/);
});

test('quick-update actions use the constraint resolution department and clearing a decision is logged',()=>{
  const f=fixture();let s=command(f.state,'constraint',undefined,{title:'Supplier delay',owner:'Buyer',departmentId:f.state.departments[2].id,cycleId:f.cycleId,dueDate:'2026-09-29',metricIds:[f.metricId],objectiveIds:[],decision:'Approve freight'});
  const c=s.constraints[0];
  s=command(s,'metric',f.metricId,{date:'2026-09-23',value:5,forecast:3,constraintUpdate:{id:c.id,status:'in-progress',decision:'',note:'Freight approved'},followUp:{title:'Place order',owner:'Buyer',dueDate:'2026-09-25'}},'checkin');
  assert.equal(s.initiatives.at(-1).departmentId,c.departmentId);assert.equal(s.initiatives.at(-1).constraintId,c.id);assert.equal(s.initiatives.at(-1).objectiveId,'');
  assert.equal(s.constraints[0].decision,'');assert.equal(s.checkins.at(-1).decision,'');assert.equal(s.constraints[0].version,2);
});
