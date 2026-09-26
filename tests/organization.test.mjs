import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { applyOrganizationCommand,ensureOrganization } from '../api/_lib/organization.js';
import { createOrganizationHandler } from '../api/organization.js';
import { tenure,visibleHierarchy,canAccessOrganization } from '../src/lib/organization.js';
const now=new Date('2026-09-24T12:00:00Z');
const save=(s,values,id)=>applyOrganizationCommand(s,{action:'save',id,expectedVersion:s?.people.find(p=>p.id===id)?.version,values},'owner',now);
function fixture(){let s=save(null,{name:'Test owner',title:'CEO',startDate:'2020-09-24',department:'Leadership'});s=save(s,{name:'Test lead',title:'COO',managerId:s.people[0].id,department:'Operations'});s=save(s,{name:'Test maker',title:'Assembler',managerId:s.people[1].id,department:'Manufacturing',responsibilities:'Final assembly\nQuality inspection'});return s;}
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
test('tenure respects anniversaries, partial months, unknown and future dates and departure',()=>{
  assert.equal(tenure('2020-09-24','','2026-09-24'),'6 years');
  assert.equal(tenure('2020-09-25','','2026-09-24'),'5 years, 11 months');
  assert.equal(tenure('2026-09-01','','2026-09-24'),'Less than a month');
  assert.equal(tenure('2026-10-01','','2026-09-24'),'Starts 2026-10-01');
  assert.equal(tenure(''),'Start date not recorded');
  assert.equal(tenure('2020-09-24','2022-09-24','2026-09-24'),'2 years');
});
test('chart filters retain manager chains without including unrelated people',()=>{
  const s=fixture();let h=visibleHierarchy(s.people,'inspection','Manufacturing');assert.equal(h.people.length,3);assert.deepEqual([...h.matches],[s.people[2].id]);
  h=visibleHierarchy(s.people,'missing');assert.equal(h.people.length,0);
});
test('reporting loops and missing or archived managers are rejected without changing the original state',()=>{
  const s=fixture(),original=structuredClone(s);
  for(const id of [s.people[0].id,s.people[2].id])assert.throws(()=>save(s,{...s.people[0],managerId:id},s.people[0].id),/loop/);
  assert.throws(()=>save(s,{name:'New',title:'Role',managerId:'missing'}),/active manager/);
  assert.deepEqual(s,original);
});
test('profiles validate dates, duplicate emails and preserve versioned history',()=>{
  let s=fixture();const p=s.people[2];s=save(s,{...p,title:'Senior assembler',email:'person@example.com'},p.id);
  assert.equal(s.history.at(-1).before.title,'Assembler');assert.equal(s.history.at(-1).after.title,'Senior assembler');
  assert.throws(()=>applyOrganizationCommand(s,{action:'save',id:p.id,expectedVersion:1,values:p},'owner',now),/changed/);
  for(const fields of [{startDate:'2026-02-30'},{startDate:'2025-01-01',endDate:'2024-01-01'},{email:'PERSON@example.com'},{email:'invalid'}])assert.throws(()=>save(s,{name:'New',title:'Role',...fields}));
});
test('archiving requires reassignment and restoration clears an archived manager',()=>{
  let s=fixture();const [boss,lead,worker]=s.people;
  const action=(action,id)=>{s=applyOrganizationCommand(s,{action,id,expectedVersion:s.people.find(p=>p.id===id).version},'owner',now);};
  assert.throws(()=>action('archive',lead.id),/Reassign/);action('archive',worker.id);action('archive',lead.id);action('restore',worker.id);
  assert.equal(s.people.find(p=>p.id===worker.id).managerId,'');assert.equal(s.people.find(p=>p.id===lead.id).archived,true);assert.equal(s.people.find(p=>p.id===boss.id).archived,false);
});
test('only owner can read or mutate organization, before any data query',async()=>{
  for(const role of ['admin','viewer','strategist','producer','launcher','analyst',undefined])for(const method of ['GET','POST']){
    assert.equal(canAccessOrganization({role}),false);let queried=false;
    const handler=createOrganizationHandler({authorize:async()=>({role,permissions:['*'],sql:()=>{queried=true;throw Error('No query allowed');}})});const res=response();await handler({method},res);assert.equal(res.statusCode,403);assert.equal(queried,false);
  }assert.equal(canAccessOrganization({role:'owner'}),true);
});
test('real PostgreSQL persists org profiles, rejects stale revisions and invalid writes atomically',async()=>{
  const db=new PGlite();useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');await ensureOrganization(sql);
  const handler=createOrganizationHandler({authorize:async()=>({sql,userId:'owner',role:'owner',permissions:['*']}),now:()=>now});
  async function call(method,body){const r=response();await handler({method,body},r);return r;}
  try{
    let r=await call('GET');assert.deepEqual(r.body.state,{people:[],history:[]});assert.equal(r.headers['Cache-Control'],'private, no-store');
    r=await call('POST',{revision:0,command:{action:'save',values:{name:'Actual supplied person',title:'Operations lead'}}});assert.equal(r.statusCode,200);const id=r.body.state.people[0].id;
    r=await call('POST',{revision:0,command:{action:'save',values:{name:'Stale edit',title:'Role'}}});assert.equal(r.statusCode,409);
    r=await call('POST',{revision:1,command:{action:'save',id,expectedVersion:1,values:{name:'Actual supplied person',title:'Operations lead',managerId:id}}});assert.equal(r.statusCode,400);
    r=await call('GET');assert.equal(r.body.revision,1);assert.equal(r.body.state.history.length,1);assert.equal(r.body.state.people[0].managerId,'');
  }finally{useTestDatabase(null);await db.close();}
});

test('supplied roster uses only confirmed names and roles, imports once without invented relationships',()=>{const s=applyOrganizationCommand(null,{action:'import-roster'},'owner',now);assert.equal(s.people.length,11);assert.equal(s.people.find(p=>p.name==='Randall Slimp').title,'CEO');assert.ok(s.people.every(p=>!p.managerId&&!p.startDate&&!p.department&&!p.responsibilities));assert.throws(()=>applyOrganizationCommand(s,{action:'import-roster'},'owner',now),/empty directory/);});

test('drag and selector assignment preserve profile fields, validate loops and use record versions',()=>{let s=fixture();const [boss,lead,worker]=s.people;s=applyOrganizationCommand(s,{action:'assign-manager',id:worker.id,managerId:boss.id,expectedVersion:worker.version},'owner',now);assert.equal(s.people[2].managerId,boss.id);assert.equal(s.people[2].responsibilities,worker.responsibilities);assert.throws(()=>applyOrganizationCommand(s,{action:'assign-manager',id:boss.id,managerId:worker.id,expectedVersion:boss.version},'owner',now),/loop/);assert.throws(()=>applyOrganizationCommand(s,{action:'assign-manager',id:worker.id,managerId:lead.id,expectedVersion:worker.version},'owner',now),/changed/);s=applyOrganizationCommand(s,{action:'assign-manager',id:worker.id,managerId:'',expectedVersion:s.people[2].version},'owner',now);assert.equal(s.people[2].managerId,'');});

test('tags are normalized, audited, preserved by older edits and usable as hierarchy filters',()=>{
 let s=fixture(),worker=s.people[2];s=save(s,{...worker,tags:['Assembly Technician',' assembly technician ',' Safety ']},worker.id);
 assert.deepEqual(s.people[2].tags,['Assembly Technician','Safety']);assert.deepEqual(s.history.at(-1).after.tags,['Assembly Technician','Safety']);
 const {tags,...legacy}=s.people[2];s=save(s,{...legacy,title:'Assembly Technician'},worker.id);assert.deepEqual(s.people[2].tags,tags);
 const h=visibleHierarchy(s.people,'','','Assembly Technician');assert.equal(h.people.length,3);assert.deepEqual([...h.matches],[worker.id]);
 assert.equal(visibleHierarchy(s.people,'Safety').matches.size,1);
 for(const tags of ['bad',[1],['x'.repeat(51)],Array(21).fill('tag')])assert.throws(()=>save(s,{...s.people[2],tags},worker.id));
 s=save(s,{...s.people[2],tags:[]},worker.id);assert.deepEqual(s.people[2].tags,[]);
});
