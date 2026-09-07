import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureVariantObservations} from '../api/_lib/creative-variants.js';
import {grantRuntimeAccess} from '../scripts/lib/runtime-grants.mjs';

test('runtime grants allow data operations and triggers but deny schema ownership and migration writes',async()=>{
 const db=new PGlite();
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 sql.query=async(query)=>(await db.query(query)).rows;
 try{
  await initializeSchema(sql);await ensureVariantObservations(sql);
  await sql`CREATE TABLE app_schema_migrations(version TEXT PRIMARY KEY)`;
  await db.exec('CREATE ROLE howl_runtime_test NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await assert.rejects(grantRuntimeAccess(sql,'bad"role'),/dedicated/);
  const granted=await grantRuntimeAccess(sql,'howl_runtime_test');assert.ok(granted.tables>50);
  await db.exec('SET ROLE howl_runtime_test');
  await assert.rejects(sql`CREATE TABLE public.forbidden(id int)`,{code:'42501'});
  await assert.rejects(sql`ALTER TABLE app_users ADD COLUMN forbidden int`,{code:'42501'});
  await assert.rejects(sql`TRUNCATE app_users`,{code:'42501'});
  await assert.rejects(sql`INSERT INTO app_schema_migrations(version) VALUES ('forbidden')`,{code:'42501'});
  await sql`INSERT INTO creative_performance(ad_id,group_key) VALUES ('grant-fixture','grant-fixture')`;
  await sql`UPDATE creative_performance SET ad_name='Updated' WHERE ad_id='grant-fixture'`;
  assert.equal((await sql`SELECT count(*) AS n FROM creative_variant_observations WHERE ad_id='grant-fixture'`)[0].n,1);
  await sql`DELETE FROM creative_performance WHERE ad_id='grant-fixture'`;
 }finally{await db.close();}
});
