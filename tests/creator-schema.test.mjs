import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureCreatorOpsTables} from '../api/_lib/creator-ops.js';
import {logCreativeOperatorEvent} from '../api/_lib/creative-audit.js';
import {upsertCreativeEvidenceTask} from '../api/_lib/creative-evidence-tasks.js';

test('creator migrations preserve explicit seeding state and audit writes need no schema privilege',async()=>{
 const db=new PGlite();
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  await initializeSchema(sql);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Migration fixture') RETURNING id`;
  await sql`INSERT INTO creator_seeding_log(creator_id,seeding_status,notes) VALUES (${creator.id},'planned','Discuss delivered package options before ordering')`;
  await sql`UPDATE seeding_units SET cogs=123 WHERE unit_type='R1'`;
  await ensureCreatorOpsTables(sql);
  assert.equal((await sql`SELECT seeding_status FROM creator_seeding_log WHERE creator_id=${creator.id}`)[0].seeding_status,'planned');
  assert.equal(Number((await sql`SELECT cogs FROM seeding_units WHERE unit_type='R1'`)[0].cogs),123);
  await db.exec(`CREATE ROLE creator_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO creator_runtime;
   GRANT SELECT,INSERT,UPDATE ON creative_operator_events,creative_evidence_tasks TO creator_runtime;
   GRANT USAGE ON SEQUENCE creative_operator_events_id_seq TO creator_runtime; SET ROLE creator_runtime;`);
  await assert.rejects(sql`ALTER TABLE creative_operator_events ADD COLUMN forbidden int`,{code:'42501'});
  const event=await logCreativeOperatorEvent(sql,{eventType:'fixture',groupKey:'fixture-group',groupName:'Fixture',metadata:{checked:true}});
  assert.equal(event.event_type,'fixture');
  await upsertCreativeEvidenceTask(sql,{groupKey:'fixture-group',taskType:'transcript',status:'open',groupName:'Fixture',userId:'fixture'});
  await upsertCreativeEvidenceTask(sql,{groupKey:'fixture-group',taskType:'transcript',status:'done',groupName:'Fixture',userId:'fixture'});
  const rows=await sql`SELECT status FROM creative_evidence_tasks WHERE group_key='fixture-group'`;assert.equal(rows.length,1);assert.equal(rows[0].status,'done');
 }finally{await db.close();}
});
