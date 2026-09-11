import test from 'node:test';
import assert from 'node:assert/strict';
import {requestUploadToken} from '../src/lib/upload-token-retry.js';
test('rate limiting waits for the server reset and retries before uploading media',async()=>{
 let calls=0;const waits=[];
 const result=await requestUploadToken(async()=>++calls===1?new Response('',{status:429,headers:{'Retry-After':'600'}}):new Response('token'),async ms=>waits.push(ms));
 assert.equal(result.status,200);assert.equal(calls,2);assert.deepEqual(waits,[601000]);
});
test('auth and other errors are not retried and rate-limit retries are bounded',async()=>{
 let calls=0;
 assert.equal((await requestUploadToken(async()=>{calls++;return new Response('',{status:401});})).status,401);assert.equal(calls,1);
 calls=0;const waits=[];
 assert.equal((await requestUploadToken(async()=>{calls++;return new Response('',{status:429});},async ms=>waits.push(ms))).status,429);
 assert.equal(calls,4);assert.deepEqual(waits,[61000,61000,61000]);
});
