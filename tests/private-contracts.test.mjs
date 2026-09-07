import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Writable} from 'node:stream';
import {PGlite} from '@electric-sql/pglite';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {initializeSchema} from '../api/db/schema.js';
import {ensureMediaObjects} from '../api/_lib/media-objects.js';
import {CONTRACT_MAX_BYTES,getPrivateContract,privateContractPath,requireRegisteredContract} from '../api/_lib/private-contracts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import upload from '../api/blob/upload-token.js';
import intake from '../api/creator-investment-intake.js';
import download from '../api/creator-contract.js';

const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});

test('private contracts require signed ownership and only authenticated agreement reads receive storage bytes',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env};
 const dispatcher=getGlobalDispatcher(),mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const url='https://privatefixture.private.blob.vercel-storage.com/creator-contracts/signed.pdf';
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_publicfixture_test',HOWL_PRIVATE_READ_WRITE_TOKEN:'vercel_blob_rw_privatefixture_test'});
  await initializeSchema(sql);await ensureMediaObjects(sql);
  for(const value of [url.replace('privatefixture','other'),url.replace('.private.','.public.'),url+'?x=1',url.replace('creator-contracts/','ugc-source/'),'http://127.0.0.1/contract.pdf'])assert.throws(()=>privateContractPath(value));
  const payload={blob:{url,pathname:'creator-contracts/signed.pdf',contentType:'application/pdf'},tokenPayload:JSON.stringify({v:1,ownerId:'local-dev',scope:'creators'})};
  const body={type:'blob.upload-completed',payload};
  const callback=async(token)=>{const res=response();await upload({method:'POST',headers:{'x-vercel-signature':createHmac('sha256',token).update(JSON.stringify(body)).digest('hex')},body},res);return res;};
  assert.equal((await callback(process.env.BLOB_READ_WRITE_TOKEN)).statusCode,400);
  // Unverified/missing files are rejected before intake changes any creator rows.
  const missing=response();await intake({method:'POST',headers:{},body:{creator_name:'Must not be inserted',contract_pdf_url:url}},missing);assert.equal(missing.statusCode,409);
  assert.equal((await sql`SELECT count(*) AS n FROM creators`)[0].n,0);
  assert.equal((await callback(process.env.HOWL_PRIVATE_READ_WRITE_TOKEN)).statusCode,200);
  assert.equal((await callback(process.env.HOWL_PRIVATE_READ_WRITE_TOKEN)).statusCode,200);
  assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,1);
  await assert.rejects(requireRegisteredContract(sql,url,'another-member'),/another member/);
  let providerCalls=0;
  const pdf='%PDF-1.7\nsynthetic fixture';
  mock.get('https://privatefixture.private.blob.vercel-storage.com').intercept({path:'/creator-contracts/signed.pdf',method:'GET',headers:{authorization:`Bearer ${process.env.HOWL_PRIVATE_READ_WRITE_TOKEN}`}}).reply(()=>{providerCalls++;return {statusCode:200,data:pdf,responseOptions:{headers:{'content-type':'application/pdf','content-length':String(Buffer.byteLength(pdf)),etag:'"fixture"','last-modified':'Mon, 07 Sep 2026 00:00:00 GMT'}}};}).persist();
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Private contract fixture') RETURNING id`;
  const [agreement]=await sql`INSERT INTO creator_agreements(creator_id,title,agreement_body,status,source_type,source_pdf_url,source_file_name) VALUES (${creator.id},'Contract','Fixture','uploaded','uploaded_pdf',${url},'Contract … signed.pdf') RETURNING id`;
  class DownloadResponse extends Writable {
   constructor(){super();this.statusCode=200;this.headers={};this.chunks=[];}
   _write(chunk,_encoding,done){this.headersSent=true;this.chunks.push(Buffer.from(chunk));done();}
   setHeader(k,v){assert.ok(!/[^\x00-\x7f]/.test(v));this.headers[k]=v;}
   status(n){this.statusCode=n;return this;}
   json(body){this.body=body;return this;}
  }
  const res=new DownloadResponse();await download({method:'GET',query:{id:agreement.id},headers:{}},res);
  assert.equal(res.statusCode,200);assert.equal(Buffer.concat(res.chunks).toString(),pdf);assert.equal(providerCalls,1);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.match(res.headers['Content-Disposition'],/%E2%80%A6/);
  delete process.env.AUTH_DISABLED;
  process.env.CLERK_SECRET_KEY='sk_test_validfixture';delete process.env.HOWL_USE_PRODUCTION_AUTH;
  const denied=response();await download({method:'GET',query:{id:agreement.id},headers:{}},denied);assert.equal(denied.statusCode,401);assert.equal(providerCalls,1);
  let cancelled=false;
  await assert.rejects(getPrivateContract(sql,url,undefined,async()=>({statusCode:200,blob:{contentType:'application/pdf',size:CONTRACT_MAX_BYTES+1},stream:{cancel:async()=>{cancelled=true;}}})),/size limit/);assert.equal(cancelled,true);
  await assert.rejects(getPrivateContract(sql,url.replace('privatefixture','other'),undefined,async()=>{throw Error('MUST NOT FETCH');}),/configured private store/);
 }finally{setGlobalDispatcher(dispatcher);await mock.close();restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});

test('browser uploads use the server-selected access mode and keep credentialed upload failures visible',async()=>{
 const {uploadPublicBlob}=await import('../src/utils/blobUpload.js');
 const previousFetch=globalThis.fetch,previousXHR=globalThis.XMLHttpRequest;
 let selected='private',last;
 class XHR {
  constructor(){this.upload={};this.headers={};last=this;}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(k,v){this.headers[k]=v;}
  send(){this.status=200;this.responseText=JSON.stringify({url:`https://fixture.${selected}.blob.vercel-storage.com/contract.pdf`});this.onload();}
 }
 try{
  globalThis.XMLHttpRequest=XHR;
  globalThis.fetch=async()=>Response.json({clientToken:'fixture-client-token',access:selected,uploadLimits:{maximumSizeInBytes:20,allowedContentTypes:['application/pdf']}});
  const file=new Blob(['%PDF-1.7'],{type:'application/pdf'});
  await uploadPublicBlob('creator-contracts/fixture.pdf',file,{clientPayload:'fixture-session',contentType:file.type});assert.equal(last.headers['x-vercel-blob-access'],'private');
  selected='public';await uploadPublicBlob('drafts/fixture',file,{clientPayload:'fixture-session',contentType:file.type});assert.equal(last.headers['x-vercel-blob-access'],'public');
  globalThis.fetch=async()=>Response.json({error:'Upload storage is not configured for this destination'},{status:503});
  await assert.rejects(uploadPublicBlob('creator-contracts/fixture.pdf',file,{clientPayload:'fixture-session'}),/503/);
 }finally{globalThis.fetch=previousFetch;globalThis.XMLHttpRequest=previousXHR;}
});
