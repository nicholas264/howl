import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ensureMonthlyMetrics,upsertMonthlySnapshot} from '../api/_lib/monthly-metrics.js';
import {createMonthlyMetricsHandler} from '../api/db/monthly-metrics.js';
import {ROLE_PERMISSIONS,hasPermission} from '../api/_lib/app-access.js';
import google from '../api/google.js';
const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;},end(){}});

test('retired public Google Ads OAuth setup never exchanges or displays credentials',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected token exchange');};
 try{for(const action of ['auth','callback']){const res=response();await google({method:'GET',query:{action,code:'untrusted-code'}},res);assert.equal(res.statusCode,410);}assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});

test('monthly writes require analytics.write and atomic partial snapshots preserve other providers',async()=>{
 const db=new PGlite();
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  await ensureMonthlyMetrics(sql);
  await db.exec(`CREATE ROLE metrics_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO metrics_runtime;
   GRANT SELECT,INSERT,UPDATE,DELETE ON monthly_metrics TO metrics_runtime; SET ROLE metrics_runtime;`);
  await assert.rejects(sql`ALTER TABLE monthly_metrics ADD COLUMN forbidden int`,{code:'42501'});
  const handler=createMonthlyMetricsHandler(async(req,res,permission)=>{
   const access={sql,permissions:ROLE_PERMISSIONS[req.role]};
   if(!hasPermission(access,permission)){res.status(403).json({error:'Forbidden'});return null;}return access;
  });
  for(const action of ['snapshot','delete']){
   const res=response();await handler({method:'POST',role:'analyst',body:{action,month:'2026-09',snapshots:[{month:'2026-09',meta:{spend:999}}]}},res);assert.equal(res.statusCode,403);
  }
  assert.equal((await sql`SELECT count(*) AS n FROM monthly_metrics`)[0].n,0);
  const res=response();await handler({method:'POST',role:'strategist',body:{action:'snapshot',snapshots:[{month:'2026-09',shopify:{revenue:12}}]}},res);assert.equal(res.body.upserted,1);
  await Promise.all([upsertMonthlySnapshot(sql,{month:'2026-09',google:{spend:4}}),upsertMonthlySnapshot(sql,{month:'2026-09',meta:{spend:7}}),upsertMonthlySnapshot(sql,{month:'2026-09',klaviyo:{revenue:9}})]);
  const read=response();await handler({method:'GET',role:'analyst'},read);assert.equal(read.statusCode,200);
  const row=read.body.rows[0];assert.deepEqual(row.shopify,{revenue:12});assert.deepEqual(row.google,{spend:4});assert.deepEqual(row.meta,{spend:7});assert.deepEqual(row.klaviyo,{revenue:9});
  await upsertMonthlySnapshot(sql,{month:'2026-09',meta:null});
  const [cleared]=await sql`SELECT meta,google FROM monthly_metrics WHERE month='2026-09'`;assert.equal(cleared.meta,null);assert.deepEqual(cleared.google,{spend:4});
  const invalid=response();await handler({method:'POST',role:'strategist',body:{action:'snapshot',snapshots:[{month:'2026-10',meta:{}},{month:'bad'}]}},invalid);assert.equal(invalid.statusCode,400);assert.equal((await sql`SELECT count(*) AS n FROM monthly_metrics`)[0].n,1);
 }finally{await db.close();}
});
