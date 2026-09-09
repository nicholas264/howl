import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureSessionCreation,createSession} from '../api/_lib/session-creation.js';
test('session save retries converge atomically and preserve subsequent edits',async()=>{
 const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureSessionCreation(sql);
  const actor={userId:'one',email:'one@example.test'},input={video_url:'https://example.test/upload.mp4',title:'Upload',settings:{volume:1}};
  const results=await Promise.all(Array.from({length:8},()=>createSession(sql,actor,input)));
  assert.equal(new Set(results.map(row=>row.id)).size,1);
  const [{count}]=await sql`SELECT count(*)::int AS count FROM ugc_sessions`;assert.equal(count,1);
  const id=results[0].id;await sql`UPDATE ugc_sessions SET title='Edited',settings='{"volume":0.5}'::jsonb,revision=revision+1 WHERE id=${id}`;
  const replay=await createSession(sql,actor,input);assert.equal(replay.id,id);assert.equal(replay.title,'Edited');assert.equal(replay.settings.volume,0.5);assert.equal(replay.revision,1);
  await assert.rejects(createSession(sql,actor,{...input,title:'Changed intent'}),error=>error.statusCode===409);
  const other=await createSession(sql,{...actor,userId:'two'},input);assert.notEqual(other.id,id);
  const intentional=await createSession(sql,actor,{...input,creation_key:'another-session'});assert.notEqual(intentional.id,id);
  await assert.rejects(createSession(sql,actor,{...input,creation_key:12}),error=>error.statusCode===400);
 }finally{await db.close();}
});
