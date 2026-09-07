import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureMediaObjects} from '../api/_lib/media-objects.js';import {migrateVideoReference} from '../scripts/lib/video-migration.mjs';

test('video migration atomically preserves session data and ownership and rejects concurrent edits',async()=>{
 const db=new PGlite(),sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureMediaObjects(sql);
  const [{session}]=await sql`INSERT INTO ugc_sessions(user_id,video_url,status,words,settings) VALUES ('owner','https://fixture.public.blob.vercel-storage.com/source.mp4','rendered','[{"word":"preserved"}]','{"captionScale":1}') RETURNING to_jsonb(ugc_sessions) AS session`;
  const pathname=`ugc-source/migrated/${session.id}-${'a'.repeat(64)}.mp4`,url=`https://fixture.private.blob.vercel-storage.com/${pathname}`;
  await sql`UPDATE ugc_sessions SET title='Concurrent edit' WHERE id=${session.id}`;
  assert.equal(await migrateVideoReference(sql,session,{url,pathname}),false);
  const [{session:current}]=await sql`SELECT to_jsonb(u) AS session FROM ugc_sessions u WHERE id=${session.id}`;
  await sql`ALTER TABLE app_media_objects ADD CONSTRAINT migration_failure CHECK (owner_id<>'owner')`;
  await assert.rejects(migrateVideoReference(sql,current,{url,pathname}));
  assert.equal((await sql`SELECT video_url FROM ugc_sessions WHERE id=${session.id}`)[0].video_url,session.video_url);
  await sql`ALTER TABLE app_media_objects DROP CONSTRAINT migration_failure`;
  assert.equal(await migrateVideoReference(sql,current,{url,pathname}),true);
  const [saved]=await sql`SELECT * FROM ugc_sessions WHERE id=${session.id}`;
  assert.equal(saved.revision,current.revision+1);assert.equal(saved.title,current.title);assert.deepEqual(saved.words,current.words);assert.deepEqual(saved.settings,current.settings);
  assert.equal((await sql`SELECT owner_id FROM app_media_objects WHERE url=${url}`)[0].owner_id,'owner');
  assert.equal(await migrateVideoReference(sql,current,{url,pathname}),false);
 }finally{await db.close();}
});
