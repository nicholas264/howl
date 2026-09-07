import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {initializeSchema} from '../api/db/schema.js';
import {ensureMediaObjects} from '../api/_lib/media-objects.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {contractReferences,migrateContractReferences} from '../scripts/lib/contract-migration.mjs';

test('contract migration atomically moves registered references and rejects changed snapshots',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),sql=neon('postgresql://test:test@fixture.local/test');
 try{
  await initializeSchema(sql);await ensureMediaObjects(sql);
  const old='https://fixture.public.blob.vercel-storage.com/creator-contracts/original.pdf';
  const destination='https://fixture.private.blob.vercel-storage.com/creator-contracts/migrated/fixture.pdf';
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Migration fixture') RETURNING id`;
  const [row]=await sql`INSERT INTO creator_agreements(creator_id,title,agreement_body,status,source_type,source_pdf_url,created_by)
    VALUES (${creator.id},'Contract',${'File: '+old},'uploaded','uploaded_pdf',${old},'fixture-owner') RETURNING id`;
  await sql`INSERT INTO creator_activity(creator_id,kind,summary,metadata,user_id) VALUES (${creator.id},'agreement_uploaded','Uploaded',${JSON.stringify({agreement_id:row.id,source_pdf_url:old})}::jsonb,'fixture-owner')`;
  const [{agreement}]=await sql`SELECT to_jsonb(a) AS agreement FROM creator_agreements a WHERE id=${row.id}`;
  const activities=(await sql`SELECT to_jsonb(a) AS activity FROM creator_activity a WHERE creator_id=${creator.id}`).map(row=>row.activity);
  const entry={agreement,activities,destination,pathname:'creator-contracts/migrated/fixture.pdf',sha256:'fixture',bytes:123};
  assert.deepEqual(await contractReferences(sql,old),{creator_activity:1,creator_agreements:1});
  await db.exec(`CREATE FUNCTION fail_private_registration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected registry failure'; END $$; CREATE TRIGGER fail_private_registration BEFORE INSERT ON app_media_objects FOR EACH ROW EXECUTE FUNCTION fail_private_registration()`);
  await assert.rejects(migrateContractReferences(sql,entry),/Injected registry failure/);
  assert.deepEqual(await contractReferences(sql,old),{creator_activity:1,creator_agreements:1});
  assert.equal((await sql`SELECT count(*)::int AS n FROM creator_activity WHERE kind='contract_media_migrated'`)[0].n,0);
  await db.exec('DROP TRIGGER fail_private_registration ON app_media_objects');
  await sql`UPDATE creator_activity SET summary='Concurrent change' WHERE creator_id=${creator.id}`;
  await assert.rejects(migrateContractReferences(sql,entry),/division by zero/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM app_media_objects`)[0].n,0);
  assert.equal((await sql`SELECT source_pdf_url FROM creator_agreements WHERE id=${row.id}`)[0].source_pdf_url,old);
  await sql`UPDATE creator_activity SET summary='Uploaded' WHERE creator_id=${creator.id}`;
  await sql`UPDATE creator_agreements SET status='accepted' WHERE id=${row.id}`;
  await assert.rejects(migrateContractReferences(sql,entry),/changed after/);
  await sql`UPDATE creator_agreements SET status='uploaded' WHERE id=${row.id}`;
  await migrateContractReferences(sql,entry);
  assert.deepEqual(await contractReferences(sql,old),{});
  const [migrated]=await sql`SELECT * FROM creator_agreements WHERE id=${row.id}`;
  assert.equal(migrated.source_pdf_url,destination);assert.equal(migrated.agreement_body,'File: '+destination);assert.equal(migrated.status,'uploaded');assert.equal(migrated.created_by,'fixture-owner');assert.equal(migrated.version,1);
  assert.equal((await sql`SELECT owner_id FROM app_media_objects WHERE url=${destination}`)[0].owner_id,'fixture-owner');
  await assert.rejects(migrateContractReferences(sql,entry),/changed after/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM creator_activity WHERE kind='contract_media_migrated'`)[0].n,1);
 }finally{restore();await db.close();}
});
