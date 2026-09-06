import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStudioDrive, MAX_ORIGINAL_BYTES } from '../api/_lib/static-studio-drive.js';
const original=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3,4,5]);
function fixture({metadata={},bytes=original,mediaStatus=200,uploadError=false}={}) {
 const uploads=[],requests=[];
 const drive=createStudioDrive({token:'test-token',fetchImpl:async(url,options)=>{
   requests.push({url,options});
   if(url.includes('alt=media'))return new Response(bytes,{status:mediaStatus});
   if(url.includes('/files?'))return Response.json({files:[{id:'image_fixture_01',name:'R3.png'}],nextPageToken:'next/with+symbols'});
   return Response.json({id:'image_fixture_01',name:'R3.png',mimeType:'image/png',size:String(original.length),md5Checksum:createHash('md5').update(original).digest('hex'),modifiedTime:'2026-09-06T00:00:00Z',...metadata});
 },putImpl:async(key,buffer,options)=>{if(uploadError)throw new Error('Blob unavailable');uploads.push({key,buffer,options});return {url:'https://fixture.public.blob.vercel-storage.com/original.png'};}});
 return {drive,uploads,requests};
}
test('Drive intake copies the exact original bytes and records its fingerprint and revision',async()=>{
 const {drive,uploads,requests}=fixture();const record=await drive.importOriginal('image_fixture_01');
 assert.equal(uploads.length,1);assert.deepEqual(uploads[0].buffer,original);assert.equal(uploads[0].options.contentType,'image/png');
 assert.equal(record.sha256,createHash('sha256').update(original).digest('hex'));assert.equal(record.driveModified,'2026-09-06T00:00:00Z');
 assert.ok(requests.every(r=>r.url.startsWith('https://www.googleapis.com/drive/v3/') && r.options.headers.Authorization==='Bearer test-token'));
});
test('Drive intake rejects truncated, changed, mislabeled and oversized originals before storage',async()=>{
 for(const options of [{bytes:original.subarray(0,10)},{metadata:{md5Checksum:'0'.repeat(32)}},{metadata:{mimeType:'image/jpeg'}},{metadata:{mimeType:'image/svg+xml'}},{metadata:{size:String(MAX_ORIGINAL_BYTES+1)}},{metadata:{size:'0'}}]){
 const {drive,uploads}=fixture(options);await assert.rejects(drive.importOriginal('image_fixture_01'));assert.equal(uploads.length,0);
 }
});
test('Drive download and storage failures remain failures instead of returning partial assets',async()=>{
 const failedDownload=fixture({mediaStatus:403});await assert.rejects(failedDownload.drive.importOriginal('image_fixture_01'),/403/);assert.equal(failedDownload.uploads.length,0);
 await assert.rejects(fixture({uploadError:true}).drive.importOriginal('image_fixture_01'),/Blob unavailable/);
});
test('Drive listings preserve page cursors, shared-drive flags and exact folder scope',async()=>{
 const {drive,requests}=fixture();const result=await drive.list('https://drive.google.com/drive/folders/folder_fixture_01','next/with+symbols');
 const url=new URL(requests[0].url);assert.ok(url.searchParams.get('q').startsWith("'folder_fixture_01' in parents"));assert.equal(url.searchParams.get('pageToken'),'next/with+symbols');assert.equal(url.searchParams.get('supportsAllDrives'),'true');assert.equal(result.nextPageToken,'next/with+symbols');
 await assert.rejects(drive.list("x' or trashed=true"));await assert.rejects(drive.importOriginal('../another-file'));assert.equal(requests.length,1);
});

test('Studio Drive uses the signed-in user with read scope and never falls back after a personal token failure',async()=>{
 const {studioDriveToken,STUDIO_DRIVE_SCOPE}=await import('../api/_lib/static-studio-auth.js');
 const access={sql:'fixture',userId:'owner'};let shared=0;
 const deps={connection:async()=>({scopes:[STUDIO_DRIVE_SCOPE]}),personal:async(sql,id)=>{assert.equal(id,'owner');return 'personal-token';},shared:async()=>{shared++;return 'shared-token';}};
 assert.equal(await studioDriveToken(access,deps),'personal-token');assert.equal(shared,0);
 await assert.rejects(studioDriveToken(access,{...deps,personal:async()=>{throw Error('Reconnect personal account');}}),/Reconnect/);assert.equal(shared,0);
 assert.equal(await studioDriveToken(access,{...deps,connection:async()=>null}),'shared-token');
 await assert.rejects(studioDriveToken(access,{...deps,connection:async()=>null,shared:async()=>{throw Error('denied');}}),/Connect my Drive/);
});
