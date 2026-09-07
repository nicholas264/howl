import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadPolicy} from '../api/_lib/upload-policy.js';

test('upload grants enforce purpose-specific permissions, content and processing limits',()=>{
 const contract=uploadPolicy('creator-contracts/contract.pdf');assert.equal(contract.permission,'creators.write');assert.deepEqual(contract.allowedContentTypes,['application/pdf']);assert.equal(contract.maximumSizeInBytes,20*1024*1024);
 const footage=uploadPolicy('creator-footage/123/source.mov');assert.equal(footage.permission,'creators.write');assert.ok(!footage.allowedContentTypes.includes('application/pdf'));assert.equal(footage.maximumSizeInBytes,2*1024*1024*1024);
 for(const path of ['ugc-source/source.mp4','static-studio/reference/ref.png','callout-photos/image.webp','drafts/source.mp4'])assert.equal(uploadPolicy(path).permission,'assets.write');
 assert.ok(!uploadPolicy('static-studio/output/image.png').allowedContentTypes.includes('video/mp4'));
 for(const path of ['other/file','creator-footage/not-an-id/file','creator-contracts/../file','/ugc-source/file','ugc-source//file','ugc-source/','ugc-source/evil\\file','ugc-source/evil\nfile'])assert.throws(()=>uploadPolicy(path));
});

import {PGlite} from '@electric-sql/pglite';
import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import uploadToken from '../api/blob/upload-token.js';

test('the real Blob token encodes the selected upload constraints without session credentials',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env};
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
 try{
  Object.assign(process.env,{DATABASE_URL:'postgresql://test:test@fixture.local/test',NODE_ENV:'development',AUTH_DISABLED:'true',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_fixture_test',HOWL_PRIVATE_READ_WRITE_TOKEN:'vercel_blob_rw_privatefixture_test',VERCEL_BLOB_CALLBACK_URL:'https://fixture.example.test'});
  await ensureRateLimits(sql);
  const req={method:'POST',url:'/api/blob/upload-token',headers:{},body:{type:'blob.generate-client-token',payload:{pathname:'creator-contracts/fixture.pdf',clientPayload:'private-session-fixture'}}};
  const res=response();await uploadToken(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.access,'private');
  const envelope=Buffer.from(res.body.clientToken.split('_').slice(4).join('_'),'base64').toString();
  const payload=JSON.parse(Buffer.from(envelope.slice(envelope.indexOf('.')+1),'base64').toString());
  assert.equal(payload.maximumSizeInBytes,20*1024*1024);assert.deepEqual(payload.allowedContentTypes,['application/pdf']);assert.equal(payload.pathname,'creator-contracts/fixture.pdf');assert.deepEqual(JSON.parse(payload.onUploadCompleted.tokenPayload),{v:1,ownerId:'local-dev',scope:'creators'});
  assert.equal(res.body.uploadLimits.maximumSizeInBytes,payload.maximumSizeInBytes);assert.ok(!JSON.stringify(payload).includes('private-session-fixture'));
  const invalid=response();await uploadToken({...req,body:{...req.body,payload:{...req.body.payload,pathname:'other/file'}}},invalid);assert.equal(invalid.statusCode,400);assert.equal(invalid.body.clientToken,undefined);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
