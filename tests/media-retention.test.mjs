import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {del} from '@vercel/blob';
import {MockAgent, getGlobalDispatcher, setGlobalDispatcher} from 'undici';
import {initializeSchema} from '../api/db/schema.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {submissionTokenHash} from '../api/_lib/creator-submissions.js';
import submit from '../api/creator-submit.js';
import sessions from '../api/db/ugc-sessions.js';
import images from '../api/db/callout-images.js';
import layouts from '../api/db/callout-layouts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}});

test('record deletions and a lost submission acknowledgement never delete shared media',async()=>{
 const db=new PGlite(),previous={...process.env},previousFetch=globalThis.fetch;
 let loseAcknowledgement=false,deleted=0,heads=0;
 const dispatcher=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
 mock.get('https://vercel.com').intercept({path:'/api/blob/delete',method:'POST'}).reply(()=>{deleted++;return {statusCode:200,data:'{}',responseOptions:{headers:{'content-type':'application/json'}}};}).persist();
 const restore=useTestDatabase(db,()=>{},query=>{if(loseAcknowledgement && /WITH claimed AS/.test(query)){loseAcknowledgement=false;throw new Error('Injected lost acknowledgement');}});
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_fixture_test'});
  globalThis.fetch=async(url,init={})=>{if(init.method==='HEAD'){heads++;return new Response(null,{headers:{'content-type':'video/mp4'}});}if(String(url).includes('/delete')){deleted++;return Response.json({});}throw new Error('Unexpected external request');};
  // Prove the mock observes actual SDK deletions before checking the routes.
  await del('https://fixture.public.blob.vercel-storage.com/canary');assert.equal(deleted,1);deleted=0;
  await initializeSchema(sql);await ensureLocalReceipts(sql);await ensureRateLimits(sql);
  const shared='https://fixture.public.blob.vercel-storage.com/shared.mp4';
  const [image]=await sql`INSERT INTO callout_images(user_id,url) VALUES ('local-dev',${shared}) RETURNING id`;
  const [layout]=await sql`INSERT INTO callout_layouts(user_id,image_url) VALUES ('local-dev',${shared}) RETURNING id`;
  const [session]=await sql`INSERT INTO ugc_sessions(user_id,title,video_url) VALUES ('local-dev','Fixture',${shared}) RETURNING id`;
  for(const [handler,id] of [[images,image.id],[layouts,layout.id],[sessions,session.id]]){const res=response();await handler({method:'DELETE',query:{id},headers:{}},res);assert.equal(res.statusCode,200);}
  assert.equal(deleted,0);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Submission fixture') RETURNING id`;
  const token='synthetic_submission_token_123456789012345';
  const [link]=await sql`INSERT INTO creator_submission_links(token_hash,creator_id,title,expires_at) VALUES (${submissionTokenHash(token)},${creator.id},'Footage',now()+interval '1 day') RETURNING id`;
  const video=`https://fixture.public.blob.vercel-storage.com/creator-submissions/${link.id}/video.mp4`;
  const req={method:'POST',headers:{},body:{token,video_url:video,file_name:'video.mp4'}};
  loseAcknowledgement=true;const failed=response();await submit(req,failed);assert.equal(failed.statusCode,500);
  assert.equal((await sql`SELECT count(*) AS n FROM ugc_sessions WHERE video_url=${video}`)[0].n,1);assert.equal(deleted,0);
  const retry=response();await submit(req,retry);assert.equal(retry.statusCode,201);assert.equal(retry.body.ok,true);assert.equal(heads,1);
  const changed=response();await submit({...req,body:{...req.body,video_url:video+'-different'}},changed);assert.equal(changed.statusCode,409);assert.equal(deleted,0);
 }finally{setGlobalDispatcher(dispatcher);await mock.close();restore();globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
