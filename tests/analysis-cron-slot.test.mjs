import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ensureOperationalTables} from '../api/_lib/operational-schema.js';
import {claimAnalysisCronSlot,completeAnalysisCronSlot} from '../api/_lib/analysis-cron-slot.js';

test('cron slots reject duplicates and stale completion with no runtime DDL privileges',async()=>{
 const db=new PGlite();
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  await ensureOperationalTables(sql);
  await db.exec(`CREATE ROLE cron_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO cron_runtime;
    GRANT SELECT,INSERT,UPDATE ON creative_analysis_cron_slots TO cron_runtime; SET ROLE cron_runtime;`);
  await assert.rejects(sql`ALTER TABLE creative_analysis_cron_slots ADD COLUMN forbidden int`,{code:'42501'});
  const claims=await Promise.all([claimAnalysisCronSlot(sql),claimAnalysisCronSlot(sql)]);
  assert.equal(claims.filter(Boolean).length,1);const first=claims.find(Boolean);
  await sql`UPDATE creative_analysis_cron_slots SET started_at=now()-interval '11 minutes' WHERE run_key=${first.run_key}`;
  const replacement=await claimAnalysisCronSlot(sql);assert.ok(replacement);assert.notEqual(replacement.lease_token,first.lease_token);
  assert.equal(await completeAnalysisCronSlot(sql,first,99),false);
  assert.equal(await completeAnalysisCronSlot(sql,replacement,3),true);
  assert.equal(await completeAnalysisCronSlot(sql,replacement,4),false);
  assert.equal(await claimAnalysisCronSlot(sql),null);
  const [row]=await sql`SELECT processed FROM creative_analysis_cron_slots WHERE run_key=${first.run_key}`;assert.equal(row.processed,3);
 }finally{await db.close();}
});
