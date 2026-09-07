import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import schema,{initializeSchema} from '../api/db/schema.js';
import {ensureLibrarySchema,ensureDriveLibrarySchema} from '../api/_lib/library-schema.js';
import copy from '../api/db/copy-library.js';
import images from '../api/db/image-library.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}});

test('HTTP schema setup is retired for every method',async()=>{
 for(const method of ['GET','POST','DELETE']){const res=response();await schema({method},res);assert.equal(res.statusCode,410);}
});

test('library requests preserve explicitly cleared product tags and need no schema privileges',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},previousFetch=globalThis.fetch;
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test'});
  await initializeSchema(sql);await ensureLibrarySchema(sql);await ensureDriveLibrarySchema(sql);
  await db.exec(`CREATE ROLE library_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO library_runtime;
   GRANT SELECT,INSERT,UPDATE,DELETE ON copy_library,image_library TO library_runtime;
   GRANT USAGE ON SEQUENCE copy_library_id_seq,image_library_id_seq TO library_runtime;SET ROLE library_runtime;`);
  await assert.rejects(sql`ALTER TABLE copy_library ADD COLUMN forbidden int`,{code:'42501'});
  const added=response();await copy({method:'POST',body:{action:'add',headline:'Meet the R1'},headers:{}},added);assert.equal(added.statusCode,200);const id=added.body.row.id;
  const cleared=response();await copy({method:'POST',body:{action:'update_products',id,productIds:[]},headers:{}},cleared);assert.equal(cleared.statusCode,200);
  const read=response();await copy({method:'GET',headers:{}},read);assert.equal(read.statusCode,200);assert.deepEqual(read.body.rows.find(row=>row.id===id).product_ids,[]);
  const image=response();await images({method:'POST',body:{url:'https://example.test/fixture.png',file_name:'fixture.png'},headers:{}},image);assert.equal(image.statusCode,201);
  const listing=response();await images({method:'GET',query:{},headers:{}},listing);assert.equal(listing.statusCode,200);assert.equal(listing.body.images.length,1);
  await sql`INSERT INTO image_library(user_id,url) VALUES ('other-user','https://example.test/fixture.png')`;
  let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw new Error('Unexpected media deletion');};
  const removed=response();await images({method:'DELETE',query:{id:image.body.image.id},headers:{}},removed);assert.equal(removed.statusCode,200);assert.equal(externalCalls,0);
  assert.equal((await sql`SELECT count(*) AS n FROM image_library WHERE user_id='other-user'`)[0].n,1);
 }finally{globalThis.fetch=previousFetch;restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
