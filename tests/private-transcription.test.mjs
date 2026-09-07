import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {PGlite} from '@electric-sql/pglite';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {initializeSchema} from '../api/db/schema.js';
import {ensureMediaObjects} from '../api/_lib/media-objects.js';
import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {ensureWorkControls} from '../api/_lib/work-controls.js';
import {ensureOperationBudgets} from '../api/_lib/operation-budget.js';
import {ensureTranscriptionJobs} from '../api/_lib/transcription-jobs.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import transcribe from '../api/transcribe-url.js';
import {saveSessionEdits} from '../api/_lib/session-edits.js';

test('private source transcription decodes media and keeps extracted audio private while saving the transcript',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'private-transcription-')),db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},originalFetch=globalThis.fetch;
 const dispatcher=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  const file=join(directory,'fixture.mp4');
  const generated=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=black:s=32x32:r=10','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const video=readFileSync(file),url='https://fixture.private.blob.vercel-storage.com/ugc-source/video.mp4';
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db',HOWL_PRIVATE_READ_WRITE_TOKEN:'vercel_blob_rw_fixture_test',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_publicfixture_test',OPENAI_API_KEY:'fixture-openai-key'});
  await initializeSchema(sql);await ensureMediaObjects(sql);await ensureRateLimits(sql);await ensureWorkControls(sql);await ensureOperationBudgets(sql);await ensureTranscriptionJobs(sql);
  const [session]=await sql`INSERT INTO ugc_sessions(user_id,title,video_url,status) VALUES ('local-dev','Fixture',${url},'uploaded') RETURNING id`;
  await sql`INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type) VALUES (${url},'ugc-source/video.mp4','local-dev','assets','video/mp4')`;
  mock.get('https://vercel.com').intercept({path:'/api/blob/signed-token',method:'POST'}).reply(options=>{const scope=JSON.parse(options.body);assert.equal(scope.pathname,'ugc-source/video.mp4');assert.deepEqual(scope.operations,['get']);return {statusCode:200,data:JSON.stringify({delegationToken:Buffer.from(JSON.stringify({...scope,storeId:'fixture'})).toString('base64url')+'.signature',clientSigningToken:'fixture-delegated-key',validUntil:scope.validUntil}),responseOptions:{headers:{'content-type':'application/json'}}};});
  let audioUploads=0,whisperCalls=0,sourceReads=0;
  mock.get('https://vercel.com').intercept({path:/^\/api\/blob\/\?pathname=/,method:'PUT',headers:{'x-vercel-blob-access':'private',authorization:'Bearer vercel_blob_rw_fixture_test'}}).reply(options=>{audioUploads++;const pathname=new URL(options.path,'https://vercel.com').searchParams.get('pathname');assert.ok(pathname.startsWith(`ugc-audio/session-${session.id}-`));return {statusCode:200,data:JSON.stringify({url:`https://fixture.private.blob.vercel-storage.com/${pathname}`,pathname,contentType:'audio/mpeg',contentDisposition:'attachment'}),responseOptions:{headers:{'content-type':'application/json'}}};});
  globalThis.fetch=async(value,init={})=>{
   if(String(value).startsWith(url+'?')){sourceReads++;assert.ok(!String(value).includes(process.env.HOWL_PRIVATE_READ_WRITE_TOKEN));return new Response(video,{headers:{'content-type':'video/mp4'}});}
   if(value==='https://api.openai.com/v1/audio/transcriptions'){whisperCalls++;assert.ok((await init.body.get('file').arrayBuffer()).byteLength>100);return Response.json({duration:1,words:[{word:'fixture',start:0,end:0.5}],segments:[]});}
   throw new Error('Unexpected external request');
  };
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await transcribe({method:'POST',headers:{},body:{sessionId:session.id}},res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(sourceReads,1);assert.equal(whisperCalls,1);assert.equal(audioUploads,1);
  const [saved]=await sql`SELECT status,audio_url,revision FROM ugc_sessions WHERE id=${session.id}`;
  assert.equal(res.body.revision,saved.revision);
  assert.ok(await saveSessionEdits(sql,session.id,{title:'Edited after transcription'},res.body.revision));
  assert.equal(saved.status,'transcribed');assert.equal(saved.revision,1);assert.ok(saved.audio_url.startsWith('https://fixture.private.blob.vercel-storage.com/ugc-audio/'));
  assert.equal((await sql`SELECT owner_id FROM app_media_objects WHERE url=${saved.audio_url}`)[0].owner_id,'local-dev');
 }finally{globalThis.fetch=originalFetch;setGlobalDispatcher(dispatcher);await mock.close();restore();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await db.close();rmSync(directory,{recursive:true,force:true});}
});
