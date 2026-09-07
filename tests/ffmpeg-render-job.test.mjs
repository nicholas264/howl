import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {claimFfmpegRender,saveFfmpegRender,failFfmpegRender,runFfmpeg} from '../api/_lib/ffmpeg-render-job.js';
import {saveSessionEdits} from '../api/_lib/session-edits.js';
import render from '../api/render-ugc.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {recoverRenders} from '../api/_lib/render-recovery.js';

test('FFmpeg claim excludes competing work and fences late results, edits and failure',async()=>{
 const db=new PGlite(),sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);
  const [session]=await sql`INSERT INTO ugc_sessions(user_id,title,video_url,status) VALUES ('fixture','Fixture','https://fixture.public.blob.vercel-storage.com/video.mp4','uploaded') RETURNING *`;
  const token=await claimFfmpegRender(sql,session);assert.ok(token);assert.equal(await claimFfmpegRender(sql,session),null);
  assert.equal(await saveSessionEdits(sql,session.id,{status:'uploaded',settings:{ffmpeg_attempt:'forged'}},session.revision),null);
  assert.equal(await saveFfmpegRender(sql,session,'stale','https://fixture/output.mp4','fixture'),false);
  await failFfmpegRender(sql,session.id,'stale','wrong');assert.equal((await sql`SELECT status FROM ugc_sessions WHERE id=${session.id}`)[0].status,'rendering');
  assert.equal(await saveFfmpegRender(sql,session,token,'https://fixture/output.mp4','fixture'),true);
  assert.equal(await saveFfmpegRender(sql,session,token,'https://fixture/duplicate.mp4','fixture'),false);
  assert.equal(await claimFfmpegRender(sql,session),null);
  const [current]=await sql`SELECT * FROM ugc_sessions WHERE id=${session.id}`;
  const next=await claimFfmpegRender(sql,current);assert.ok(next);
  await sql`UPDATE ugc_sessions SET settings=jsonb_set(settings,'{ffmpeg_started_at}',to_jsonb((now()-interval '7 minutes')::text)) WHERE id=${session.id}`;
  const recovered=await recoverRenders(sql,()=>{throw Error('Must not contact Lambda for local renders');});assert.deepEqual(recovered,[{id:session.id,status:'interrupted'}]);
  assert.equal(await saveFfmpegRender(sql,current,next,'https://fixture/late.mp4','fixture'),false);
 }finally{await db.close();}
});

test('render deadline kills a running subprocess and rejects before reporting success',async()=>{
 let child;
 await assert.rejects(runFfmpeg([],AbortSignal.timeout(100),()=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','ignore','pipe']});return child;}),/deadline/);
 assert.equal(child.signalCode,'SIGKILL');
 const controller=new AbortController();controller.abort();assert.throws(()=>runFfmpeg([],controller.signal),{name:'AbortError'});
});


test('invalid render segments leave the saved session unchanged',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env};
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
  await initializeSchema(sql);
  const [session]=await sql`INSERT INTO ugc_sessions(user_id,title,video_url,status) VALUES ('local-dev','Fixture','https://fixture.public.blob.vercel-storage.com/video.mp4','uploaded') RETURNING *`;
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await render({method:'POST',headers:{},body:{session_id:session.id,segments:[{start:5,end:2}]}},res);
  assert.equal(res.statusCode,400);assert.deepEqual((await sql`SELECT * FROM ugc_sessions WHERE id=${session.id}`)[0],session);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
