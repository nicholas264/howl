import {ensureSessionCreation} from '../api/_lib/session-creation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {ensureMediaObjects} from '../api/_lib/media-objects.js';
import {videoSource,requirePrivateVideo,videoReadUrl,redactPrivateMediaError} from '../api/_lib/private-video.js';

test('private video grants require registration and constrain the real SDK delegation to one file and operation',async()=>{
 const db=new PGlite(),previous=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN,dispatcher=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const url='https://fixture.private.blob.vercel-storage.com/ugc-source/video.mp4';let issued=[];
 try{
  process.env.HOWL_PRIVATE_READ_WRITE_TOKEN='vercel_blob_rw_fixture_test';await ensureMediaObjects(sql);
  for(const value of [url.replace('fixture.private','other.private'),url.replace('ugc-source','creator-contracts'),url+'?secret=bad','https://blob.vercel-storage.com/file',url.replace('https:','http:')])assert.throws(()=>videoSource(value));
  await assert.rejects(videoReadUrl(sql,url),/still being verified/);
  await sql`INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type) VALUES (${url},'ugc-source/video.mp4','owner','assets','video/mp4')`;
  await assert.rejects(requirePrivateVideo(sql,url,'other'),/another member/);
  mock.get('https://vercel.com').intercept({path:'/api/blob/signed-token',method:'POST'}).reply(options=>{
   const body=JSON.parse(options.body);issued.push(body);
   return {statusCode:200,data:JSON.stringify({delegationToken:Buffer.from(JSON.stringify({...body,storeId:'fixture'})).toString('base64url')+'.fixture-signature',clientSigningToken:'fixture-delegated-key',validUntil:body.validUntil}),responseOptions:{headers:{'content-type':'application/json'}}};
  }).persist();
  const before=Date.now(),signed=await videoReadUrl(sql,url);
  const parsed=new URL(signed);assert.equal(parsed.origin,new URL(url).origin);assert.equal(parsed.pathname,'/ugc-source/video.mp4');assert.ok(parsed.search);assert.ok(!signed.includes(process.env.HOWL_PRIVATE_READ_WRITE_TOKEN));assert.ok(!signed.includes('fixture-delegated-key'));
  assert.equal(issued[0].pathname,'ugc-source/video.mp4');assert.deepEqual(issued[0].operations,['get']);assert.ok(issued[0].validUntil>=before+599000 && issued[0].validUntil<=Date.now()+600000);
  await videoReadUrl(sql,url,{method:'head',ttlSeconds:60});assert.deepEqual(issued[1].operations,['head']);
  await assert.rejects(videoReadUrl(sql,url,{method:'delete'}),/Invalid video read grant/);await assert.rejects(videoReadUrl(sql,url,{ttlSeconds:1801}),/Invalid video read grant/);assert.equal(issued.length,2);
  const publicUrl=url.replace('.private.','.public.');assert.equal(await videoReadUrl(sql,publicUrl),publicUrl);assert.equal(issued.length,2);
  await sql`UPDATE app_media_objects SET content_type='application/pdf' WHERE url=${url}`;await assert.rejects(videoReadUrl(sql,url),/still being verified/);assert.equal(issued.length,2);
  assert.equal(redactPrivateMediaError(new Error('Failed '+signed+' after download')),'Failed [private media] after download');
 }finally{setGlobalDispatcher(dispatcher);await mock.close();if(previous===undefined)delete process.env.HOWL_PRIVATE_READ_WRITE_TOKEN;else process.env.HOWL_PRIVATE_READ_WRITE_TOKEN=previous;await db.close();}
});

import {createHmac} from 'node:crypto';
import {initializeSchema} from '../api/db/schema.js';
import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import upload from '../api/blob/upload-token.js';
import sessions from '../api/db/ugc-sessions.js';
import playback from '../api/ugc-source-token.js';
import {recordPrivateAudio} from '../api/_lib/private-video.js';
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){}});

test('private editor upload callbacks authorize session attachment and scoped playback without exposing store credentials',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},dispatcher=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const url='https://fixture.private.blob.vercel-storage.com/ugc-source/video.mp4';let signedRequests=0;
 try{
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_publicfixture_test',HOWL_PRIVATE_READ_WRITE_TOKEN:'vercel_blob_rw_fixture_test',UGC_SOURCE_TOKEN_SECRET:'fixture-playback-secret',VERCEL_BLOB_CALLBACK_URL:'https://fixture.example.test'});
  await initializeSchema(sql);await ensureSessionCreation(sql);await ensureMediaObjects(sql);await ensureRateLimits(sql);
  const grant=response();await upload({method:'POST',url:'/api/blob/upload-token',headers:{},body:{type:'blob.generate-client-token',payload:{pathname:'ugc-source/video.mp4',clientPayload:'fixture-session'}}},grant);assert.equal(grant.statusCode,200);assert.equal(grant.body.access,'private');assert.match(grant.body.clientToken,/^vercel_blob_client_fixture_/);
  const request={method:'POST',query:{},headers:{},body:{video_url:url,title:'Private source'}};
  const pending=response();await sessions(request,pending);assert.equal(pending.statusCode,409);assert.equal((await sql`SELECT count(*)::int AS n FROM ugc_sessions`)[0].n,0);
  const body={type:'blob.upload-completed',payload:{blob:{url,pathname:'ugc-source/video.mp4',contentType:'video/mp4'},tokenPayload:JSON.stringify({v:1,ownerId:'local-dev',scope:'assets'})}};
  const callback=response();await upload({method:'POST',headers:{'x-vercel-signature':createHmac('sha256',process.env.HOWL_PRIVATE_READ_WRITE_TOKEN).update(JSON.stringify(body)).digest('hex')},body},callback);assert.equal(callback.statusCode,200);
  const saved=response();await sessions(request,saved);assert.equal(saved.statusCode,201);
  const retry=response();await sessions(request,retry);assert.equal(retry.statusCode,201);assert.equal(retry.body.session.id,saved.body.session.id);
  await sql`UPDATE app_media_objects SET owner_id='other' WHERE url=${url}`;
  const other=response();await sessions(request,other);assert.equal(other.statusCode,403);assert.equal((await sql`SELECT count(*)::int AS n FROM ugc_sessions`)[0].n,1);
  await sql`UPDATE app_media_objects SET owner_id='local-dev' WHERE url=${url}`;
  mock.get('https://vercel.com').intercept({path:'/api/blob/signed-token',method:'POST'}).reply(options=>{signedRequests++;const scope=JSON.parse(options.body);return {statusCode:200,data:JSON.stringify({delegationToken:Buffer.from(JSON.stringify({...scope,storeId:'fixture'})).toString('base64url')+'.signature',clientSigningToken:'fixture-signing-material',validUntil:scope.validUntil}),responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
  const access=response();await playback({method:'GET',query:{id:saved.body.session.id},headers:{}},access);assert.equal(access.statusCode,200);assert.equal(access.body.source_url,url);assert.ok(access.body.playback_url.startsWith(url+'?'));assert.equal(access.body.expires_in,600);assert.equal(access.headers['Cache-Control'],'private, no-store');assert.equal(signedRequests,1);assert.ok(!JSON.stringify(access.body).includes(process.env.HOWL_PRIVATE_READ_WRITE_TOKEN));assert.ok(!JSON.stringify(access.body).includes('fixture-signing-material'));
  const audio={url:'https://fixture.private.blob.vercel-storage.com/ugc-audio/session-1-123.mp3',pathname:'ugc-audio/session-1-123.mp3',contentType:'audio/mpeg'};
  await recordPrivateAudio(sql,audio,1,'local-dev');assert.equal((await sql`SELECT content_type FROM app_media_objects WHERE url=${audio.url}`)[0].content_type,'audio/mpeg');
  await assert.rejects(recordPrivateAudio(sql,{...audio,url:audio.url.replace('fixture.private','other.private')},1,'local-dev'),/private destination/);
  delete process.env.AUTH_DISABLED;process.env.CLERK_SECRET_KEY='sk_test_fixture';const denied=response();await playback({method:'GET',query:{id:saved.body.session.id},headers:{}},denied);assert.equal(denied.statusCode,401);assert.equal(signedRequests,1);
 }finally{setGlobalDispatcher(dispatcher);await mock.close();restore();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await db.close();}
});
