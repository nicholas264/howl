import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchQuickBooksPeople,importQuickBooksPeople,matchQuickBooksPerson} from '../api/_lib/organization-quickbooks.js';
import {applyOrganizationCommand} from '../api/_lib/organization.js';
const connection={access:'test',realm:'123',environment:'sandbox'};
const candidate={key:'employee-1',name:'Test Tech',email:'tech@example.com',kind:'Employee'};
test('QuickBooks roster paginates, separates vendors and strips sensitive fields',async()=>{
 const calls=[];
 const fetcher=async url=>{const q=new URL(url).searchParams.get('query');calls.push(q);const entity=q.includes('Employee')?'Employee':'Vendor';const rows=entity==='Employee'?(q.includes('STARTPOSITION 1 ')?Array.from({length:1000},(_,i)=>({Id:String(i+1),GivenName:'Test',FamilyName:`${i}`,SSN:'secret',BillRate:100})):[]):[{Id:'1',DisplayName:'Contract Tech',Vendor1099:true,TaxIdentifier:'secret'},{Id:'2',DisplayName:'Supplier'}];return {ok:true,json:async()=>({QueryResponse:{[entity]:rows}})};};
 const rows=await fetchQuickBooksPeople(connection,{},fetcher);
 assert.equal(calls.length,3);assert.match(calls[1],/STARTPOSITION 1001/);assert.equal(rows.length,1002);assert.equal(rows[1000].kind,'Contractor');assert.equal(rows[1001].kind,'Vendor');assert.equal(rows[0].key.length,64);assert.ok(!JSON.stringify(rows).includes('secret'));assert.ok(!JSON.stringify(rows).includes('BillRate'));
 await assert.rejects(fetchQuickBooksPeople(connection,{},async()=>({ok:true,json:async()=>({Fault:{}})})),/incomplete/);
});
test('import is idempotent, preserves fields, and source identity survives edits and archival',()=>{
 const first=importQuickBooksPeople(null,[candidate],[{key:candidate.key,title:'Assembly technician',department:'Assembly'}],'owner');
 assert.deepEqual(first.summary,{added:1,existing:0});const p=first.state.people[0];assert.equal(p.employmentType,'Employee');assert.equal(p.managerId,'');assert.equal(p.title,'Assembly technician');
 let state=applyOrganizationCommand(first.state,{action:'save',id:p.id,expectedVersion:p.version,values:{...p,name:'Updated name',email:'new@example.com'}},'owner');
 assert.equal(matchQuickBooksPerson(state.people,candidate).status,'existing');
 state=applyOrganizationCommand(state,{action:'archive',id:p.id,expectedVersion:2},'owner');
 const again=importQuickBooksPeople(state,[candidate],[{key:candidate.key,title:'Overwrite attempt'}],'owner');assert.deepEqual(again.state,state);assert.deepEqual(again.summary,{added:0,existing:1});
});
test('existing names and emails are matched conservatively, ambiguous matches fail atomically',()=>{
 const a=applyOrganizationCommand(null,{action:'save',values:{name:'Test Tech',title:'Lead',email:'different@example.com'}},'owner');
 assert.equal(matchQuickBooksPerson(a.people,candidate).status,'existing');
 const b=applyOrganizationCommand(a,{action:'save',values:{name:'Another Person',title:'Role',email:candidate.email}},'owner');
 assert.equal(matchQuickBooksPerson(b.people,candidate).status,'ambiguous');const copy=structuredClone(b);
 assert.throws(()=>importQuickBooksPeople(b,[candidate],[{key:candidate.key}],'owner'),/Multiple profiles/);assert.deepEqual(b,copy);
});
test('server rejects forged, duplicate, empty selections and invalid manager; contractor defaults are explicit',()=>{
 for(const selection of [[],[{key:'fake'}],[{key:candidate.key},{key:candidate.key}],[{key:candidate.key,managerId:'missing'}]])assert.throws(()=>importQuickBooksPeople(null,[candidate],selection,'owner'));
 const r=importQuickBooksPeople(null,[{...candidate,kind:'Contractor'}],[{key:candidate.key}],'owner');assert.equal(r.state.people[0].employmentType,'Contractor');assert.equal(r.state.people[0].title,'Role not recorded');
});

import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {ensureOrganization} from '../api/_lib/organization.js';
import {createOrganizationHandler} from '../api/organization.js';
const response=()=>({statusCode:200,setHeader(){},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}});
test('owner-only roster import persists atomically, releases leases, and rejects stale revisions and replaced connections',async()=>{
 const db=new PGlite();useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');await ensureOrganization(sql);await sql`CREATE TABLE finance_connection(id TEXT,version TEXT)`;await sql`INSERT INTO finance_connection VALUES ('company','v1')`;
 let calls=0,released=0,fail=false;
 const deps={authorize:async()=>({sql,role:'owner',userId:'owner',permissions:['*']}),acquire:async()=>{calls++;return {version:'v1'};},release:async()=>{released++;},fetchPeople:async()=>{if(fail)throw Error('Roster failed');return [candidate];}};
 const call=async(body,query,method='POST',overrides={})=>{const r=response();await createOrganizationHandler({...deps,...overrides})({method,body,query},r);return r;};
 try{
  let r=await call(undefined,{source:'quickbooks'},'GET',{authorize:async()=>({role:'admin',permissions:['*']})});assert.equal(r.statusCode,403);assert.equal(calls,0);
  r=await call(undefined,{source:'quickbooks'},'GET');assert.equal(r.body.candidates[0].status,'new');assert.equal(released,1);
  r=await call({revision:0,command:{action:'import-quickbooks',selections:[{key:candidate.key,title:'Assembly technician'}]}});assert.equal(r.statusCode,200);assert.equal(r.body.summary.added,1);assert.equal(released,2);
  r=await call({revision:0,command:{action:'import-quickbooks',selections:[{key:candidate.key}]}});assert.equal(r.statusCode,409);assert.equal(calls,2);
  fail=true;r=await call({revision:1,command:{action:'import-quickbooks',selections:[{key:candidate.key}]}});assert.equal(r.statusCode,400);assert.equal(released,3);fail=false;
  await sql`UPDATE finance_connection SET version='v2'`;
  r=await call({revision:1,command:{action:'import-quickbooks',selections:[{key:candidate.key}]}});assert.equal(r.statusCode,400);assert.match(r.body.error,/connection changed/);assert.equal(released,4);
  const [saved]=await sql`SELECT data,revision FROM organization_workspace`;assert.equal(saved.revision,1);assert.equal(saved.data.people.length,1);
 }finally{useTestDatabase(null);await db.close();}
});
