import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {signUgcSourceToken,verifyUgcSourceToken} from '../api/ugc-source-token.js';
import source from '../api/ugc-source.js';

test('playback grants have bounded expiry, strict framing and source binding without a production fallback',()=>{
 const previous={...process.env},clock=Date.now;
 try{
  process.env.NODE_ENV='production';process.env.UGC_SOURCE_TOKEN_SECRET='playback-fixture-key';Date.now=()=>1800000000000;
  const url='https://fixture.public.blob.vercel-storage.com/source.mp4',token=signUgcSourceToken(1,url);
  assert.equal(verifyUgcSourceToken(token,1,url),true);assert.equal(verifyUgcSourceToken(token,2,url),false);assert.equal(verifyUgcSourceToken(token,1,url+'-new'),false);
  for(const invalid of [token+'.ignored',token+'=',token.replace('.', '..'),token.slice(0,-3),null,'x'.repeat(2001)])assert.equal(verifyUgcSourceToken(invalid,1,url),false);
  assert.throws(()=>signUgcSourceToken(1,url,601));assert.throws(()=>signUgcSourceToken(-1,url));
  const forge=data=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url');return payload+'.'+createHmac('sha256',process.env.UGC_SOURCE_TOKEN_SECRET).update(payload).digest('base64url');};
  const data=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
  for(const changed of [{...data,v:1},{...data,exp:data.iat+601},{...data,iat:data.iat+100,exp:data.exp+100},{...data,iat:'1800000000'},{...data,src:'bad'}])assert.equal(verifyUgcSourceToken(forge(changed),1,url),false);
  Date.now=()=>1800000600000;assert.equal(verifyUgcSourceToken(token,1,url),false);
  delete process.env.UGC_SOURCE_TOKEN_SECRET;process.env.CLERK_SECRET_KEY='legacy-clerk-must-not-sign';process.env.DATABASE_URL='postgresql://fixture:fixture@fixture.test/db';process.env.AUTH_DISABLED='true';
  assert.throws(()=>signUgcSourceToken(1,url),/not configured/);assert.equal(verifyUgcSourceToken(token,1,url),false);
 }finally{Date.now=clock;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});

test('the source endpoint rejects a valid old grant after the stored video changes, before provider access',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},originalFetch=globalThis.fetch;
 class Response extends EventEmitter{constructor(){super();this.headers={};this.statusCode=200;}setHeader(k,v){assert.ok(!/[^\x00-\x7f]/.test(String(v)));this.headers[k]=v;}status(n){this.statusCode=n;return this;}json(body){this.body=body;return this;}end(){this.ended=true;}}
 try{
  process.env.DATABASE_URL='postgresql://fixture:fixture@fixture.test/db';process.env.UGC_SOURCE_TOKEN_SECRET='playback-fixture-key';
  const url='https://fixture.public.blob.vercel-storage.com/source.mp4';
  await db.exec('CREATE TABLE ugc_sessions(id bigint PRIMARY KEY,video_url text,file_name text)');await db.query('INSERT INTO ugc_sessions VALUES (1,$1,$2)',[url,'Source … 😀.mp4']);
  let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,status:200,headers:new Headers({'content-length':'10','content-type':'video/mp4'})};};
  const token=signUgcSourceToken(1,url),request={method:'HEAD',query:{id:'1',token},headers:{}};
  const valid=new Response();await source(request,valid);assert.equal(valid.statusCode,200);assert.equal(valid.ended,true);assert.equal(calls,1);assert.match(valid.headers['Content-Disposition'],/%E2%80%A6/);
  await db.query('UPDATE ugc_sessions SET video_url=$1 WHERE id=1',[url+'-replacement']);
  const stale=new Response();await source(request,stale);assert.equal(stale.statusCode,401);assert.match(stale.body.error,/source changed/);assert.equal(calls,1);
 }finally{globalThis.fetch=originalFetch;restore();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await db.close();}
});
