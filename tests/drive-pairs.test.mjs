import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {ensureDriveLibrarySchema} from '../api/_lib/library-schema.js';
import {associateDrivePair} from '../api/_lib/drive-pairs.js';
import {useTestDatabase} from './neon-test-adapter.mjs';

test('pair replacement rolls back its deletion when insertion fails',async()=>{
 const db=new PGlite();let fail=false;
 const restore=useTestDatabase(db,(query)=>{if(fail && /INSERT INTO ugc_asset_pairs/.test(query))throw Object.assign(new Error('Injected insert failure'),{code:'XX000'});});
 const sql=neon('postgresql://test:test@fixture.local/test');
 try{
  await ensureDriveLibrarySchema(sql);
  const pair=await associateDrivePair(sql,{feedFileId:'feed',storyFileId:'story',userId:'fixture'});
  fail=true;
  await assert.rejects(associateDrivePair(sql,{feedFileId:'feed',storyFileId:'replacement',userId:'fixture'}),/Injected/);
  const old=await sql`SELECT * FROM ugc_asset_pairs`;assert.equal(old.length,1);assert.equal(old[0].id,pair.id);assert.equal(old[0].story_file_id,'story');
  fail=false;
  const changed=await associateDrivePair(sql,{feedFileId:'replacement',storyFileId:'feed',userId:'fixture'});
  assert.equal(changed.story_file_id,'feed');assert.equal((await sql`SELECT * FROM ugc_asset_pairs`).length,1);
  await assert.rejects(associateDrivePair(sql,{feedFileId:'same',storyFileId:'same',userId:'fixture'}),{statusCode:400});
 }finally{restore();await db.close();}
});
