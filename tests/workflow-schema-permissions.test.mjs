import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema } from '../api/db/schema.js';
import { ensureProviderMedia, journalMediaUpload } from '../api/_lib/provider-media.js';
import { ensureLaunchDrafts, saveLaunchDraft } from '../api/_lib/launch-drafts.js';
import { ensureTranscriptionJobs, claimTranscription, saveTranscription } from '../api/_lib/transcription-jobs.js';
import { ensureApprovalSnapshots } from '../api/_lib/approval-snapshots.js';
import { ensureLocalReceipts } from '../api/_lib/local-receipts.js';
import { assertLaunchReady } from '../api/_lib/launch-preflight.js';

test('upload replay, draft revisions, transcription and launch preflight run without schema privileges', async () => {
  const db=new PGlite();
  const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
  try {
    await initializeSchema(sql);
    for(const migrate of [ensureProviderMedia,ensureLaunchDrafts,ensureTranscriptionJobs,ensureApprovalSnapshots,ensureLocalReceipts]) await migrate(sql);
    const source='https://example.test/source.mp4';
    const [session]=await sql`INSERT INTO ugc_sessions(user_id,title,video_url,status) VALUES ('fixture','Restricted workflow',${source},'uploaded') RETURNING id`;
    await db.exec(`CREATE ROLE workflow_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO workflow_runtime;
      GRANT SELECT ON creative_assets,creator_deliverables TO workflow_runtime;
      GRANT SELECT,INSERT,UPDATE ON app_operation_steps,provider_media,launch_drafts,ugc_sessions TO workflow_runtime;
      SET ROLE workflow_runtime;`);
    await assert.rejects(sql`ALTER TABLE provider_media ADD COLUMN forbidden int`,{code:'42501'});
    let uploads=0;
    const request={headers:{'idempotency-key':'permission-upload'},body:{action:'uploadVideo',videoUrl:source}};
    const perform=async()=>{uploads++;return {videoId:'fixture-video',sourceVideoUrl:source,contentHash:'fixture-digest'};};
    await journalMediaUpload(sql,request,'fixture','act_fixture','video',perform);
    await journalMediaUpload(sql,request,'fixture','act_fixture','video',perform);
    assert.equal(uploads,1);
    const [receipt]=await sql`SELECT content_hash FROM provider_media WHERE provider_id='fixture-video'`;
    assert.equal(receipt.content_hash,'fixture-digest');
    await assert.rejects(journalMediaUpload(sql,{...request,body:{...request.body,videoUrl:'https://example.test/changed.mp4'}},'fixture','act_fixture','video',perform),/operation changed/);
    assert.equal(uploads,1);
    const draft=await saveLaunchDraft(sql,'draft',{id:'draft'},null,'fixture');
    assert.ok(await saveLaunchDraft(sql,'draft',{id:'draft',title:'new'},draft.revision,'fixture'));
    assert.equal(await saveLaunchDraft(sql,'draft',{id:'draft',title:'stale'},draft.revision,'fixture'),null);
    const job=await claimTranscription(sql,session.id,source);
    assert.ok(job);
    assert.equal(await claimTranscription(sql,session.id,source),null);
    assert.equal(await saveTranscription(sql,session.id,source,job,{words:[{word:'hello'}],duration:1,audioUrl:null}),true);
    assert.equal(await saveTranscription(sql,session.id,source,job,{words:[],duration:0,audioUrl:null}),false);
    await assertLaunchReady(sql,{});
    await assert.rejects(assertLaunchReady(sql,{sourceType:'external_creator'}),/Link the approved creator deliverable/);
  } finally {await db.close();}
});
