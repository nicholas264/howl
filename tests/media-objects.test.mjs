import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {ensureMediaObjects} from '../api/_lib/media-objects.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import uploadToken from '../api/blob/upload-token.js';

test('only signed Blob callbacks register immutable upload ownership and replays are idempotent',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env};
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
 try{
  Object.assign(process.env,{DATABASE_URL:'postgresql://test:test@fixture.local/test',BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_fixture_test'});
  await ensureMediaObjects(sql);
  const body={type:'blob.upload-completed',payload:{blob:{url:'https://fixture.public.blob.vercel-storage.com/creator-contracts/file.pdf',pathname:'creator-contracts/file.pdf',contentType:'application/pdf'},tokenPayload:JSON.stringify({v:1,ownerId:'owner',scope:'creators'})}};
  const invoke=async(body,signed=true)=>{const res=response();const signature=signed?createHmac('sha256',process.env.BLOB_READ_WRITE_TOKEN).update(JSON.stringify(body)).digest('hex'):'00';await uploadToken({method:'POST',headers:{'x-vercel-signature':signature},body},res);return res;};
  assert.equal((await invoke(body,false)).statusCode,400);assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,0);
  assert.equal((await invoke(body)).statusCode,200);assert.equal((await invoke(body)).statusCode,200);
  assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,1);
  const conflict={...body,payload:{...body.payload,tokenPayload:JSON.stringify({v:1,ownerId:'other',scope:'creators'})}};
  assert.equal((await invoke(conflict)).statusCode,503);assert.equal((await sql`SELECT owner_id FROM app_media_objects`)[0].owner_id,'owner');
  const wrongStore={...body,payload:{...body.payload,blob:{...body.payload.blob,url:body.payload.blob.url.replace('fixture.public','other.public')}}};
  assert.equal((await invoke(wrongStore)).statusCode,503);
  assert.equal((await invoke({...body,payload:{...body.payload,tokenPayload:''}})).statusCode,200);assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,1);
  await db.exec(`CREATE FUNCTION fail_media_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected registration failure'; END $$; CREATE TRIGGER fail_media_record BEFORE INSERT ON app_media_objects FOR EACH ROW EXECUTE FUNCTION fail_media_record()`);
  const next={...body,payload:{...body.payload,blob:{...body.payload.blob,url:body.payload.blob.url.replace('file.pdf','next.pdf'),pathname:'creator-contracts/next.pdf'}}};
  assert.equal((await invoke(next)).statusCode,503);assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,1);
  await db.exec('DROP TRIGGER fail_media_record ON app_media_objects');assert.equal((await invoke(next)).statusCode,200);assert.equal((await sql`SELECT count(*) AS n FROM app_media_objects`)[0].n,2);

 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
