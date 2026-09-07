import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingSeedRequest} from '../src/lib/seedRequest.js';

test('browser seed retries retain their identity across reloads and reject changed unresolved orders',async()=>{
 const map=new Map(),storage={getItem:key=>map.get(key) || null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
 let lock=Promise.resolve();
 const locks={request(_key,fn){const result=lock.then(fn);lock=result.catch(()=>{});return result;}};
 const locked=(storage,actor,payload)=>pendingSeedRequest(storage,actor,payload,globalThis.crypto,locks);
 const payload={creator_id:1,variant_id:'variant',quantity:1,notes:'private note'};
 const [first,concurrent]=await Promise.all([locked(storage,'owner',payload),locked(storage,'owner',payload)]);
 assert.equal(first.requestKey,concurrent.requestKey);
 assert.equal((await locked(storage,'owner',{...payload})).requestKey,first.requestKey);
 assert.ok(![...map.values()].join('').includes('private note'));
 await assert.rejects(locked(storage,'owner',{...payload,quantity:2}),/unresolved/);
 const other=await locked(storage,'other',payload);assert.notEqual(other.requestKey,first.requestKey);
 await first.complete();const next=await locked(storage,'owner',payload);assert.notEqual(next.requestKey,first.requestKey);
 await first.complete();assert.equal((await locked(storage,'owner',payload)).requestKey,next.requestKey);
 await assert.rejects(locked({getItem(){throw new Error('Storage unavailable');}},'owner',payload),/Storage unavailable/);
});
