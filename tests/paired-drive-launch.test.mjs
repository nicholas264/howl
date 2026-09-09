import {launchApprovalRecords} from '../src/lib/launch-review.js';
import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureApprovalSnapshots,approveDeliverable} from '../api/_lib/approval-snapshots.js';
import {assertLaunchReady} from '../api/_lib/launch-preflight.js';import {launchEvidenceVerifier} from '../api/_lib/launch-packets.js';
import {recordPairedDriveLaunch} from '../api/_lib/paired-drive-launch.js';

test('Drive pairs verify both approvals and retain independent deliverable launch attribution',async()=>{
 const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureApprovalSnapshots(sql);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Pair fixture') RETURNING id`;
  const [engagement]=await sql`INSERT INTO creator_engagements(creator_id,status,paid_media_included) VALUES (${creator.id},'active',true) RETURNING id`;
  await sql`INSERT INTO creator_agreements(creator_id,engagement_id,title,agreement_body,status,accepted_at,source_metadata)
    SELECT ${creator.id},id,'Terms','Fixture','accepted',now(),jsonb_build_object('terms_version',1,'engagement_snapshot',to_jsonb(e)) FROM creator_engagements e WHERE id=${engagement.id}`;
  const [brief]=await sql`INSERT INTO creator_briefs(creator_id,title) VALUES (${creator.id},'Pair brief') RETURNING id`;
  const rows=[];const hashes={feed:'a'.repeat(32),story:'b'.repeat(32)};
  for(const file of ['feed','story']){
    const [d]=await sql`INSERT INTO creator_deliverables(creator_id,engagement_id,brief_id,title,drive_file_id,expected_asset_count)
      VALUES (${creator.id},${engagement.id},${brief.id},${file},${file},3) RETURNING *`;
    rows.push(await approveDeliverable(sql,d.id,creator.id,d.updated_at,'reviewer',{drive_md5:hashes[file]}));
    await sql`INSERT INTO creative_assets(drive_file_id,creator_id,deliverable_id) VALUES (${file},${creator.id},${d.id})`;
    await sql`INSERT INTO flow_cards(title,stage,creator_id,brief_id,deliverable_id) VALUES (${file},'produce',${creator.id},${brief.id},${d.id})`;
  }
  const input={action:'launch_meta_ad',pair:{feedFileId:'feed',storyFileId:'story'},creatorId:creator.id,briefId:brief.id,deliverableId:rows[0].id};
  const options={driveDigest:async id=>hashes[id]};
  const evidence=await assertLaunchReady(sql,input,options);assert.deepEqual(evidence.driveDigests,hashes);assert.equal(launchApprovalRecords([evidence]).length,2);
  assert.equal(evidence.pairedApprovals.feed.deliverable_id,rows[0].id);assert.equal(evidence.pairedApprovals.story.deliverable_id,rows[1].id);
  const [duplicate]=await sql`INSERT INTO creator_deliverables(creator_id,title,drive_file_id) VALUES (${creator.id},'Ambiguous reference','feed') RETURNING id`;
  await assert.rejects(assertLaunchReady(sql,input,options),/separately approved/);
  await sql`DELETE FROM creator_deliverables WHERE id=${duplicate.id}`;
  const [other]=await sql`INSERT INTO creators(name) VALUES ('Other owner') RETURNING id`;
  await sql`UPDATE creative_assets SET creator_id=${other.id} WHERE drive_file_id='story'`;
  await assert.rejects(assertLaunchReady(sql,input,options),/Mixed creators/);
  await sql`UPDATE creative_assets SET creator_id=${creator.id} WHERE drive_file_id='story'`;
  const verify=launchEvidenceVerifier(sql,[input],[evidence],options);await verify();
  await assert.rejects(assertLaunchReady(sql,input,{driveDigest:async()=> 'c'.repeat(32)}),/content changed/);
  await assert.rejects(assertLaunchReady(sql,{...input,creatorId:999},options),/ownership/);
  await assert.rejects(assertLaunchReady(sql,{...input,deliverableId:999},options),/not part/);
  await assert.rejects(assertLaunchReady(sql,{...input,pair:{feedFileId:'feed',storyFileId:'feed'},fileId:'story'},options),/separately approved/);
  await sql`UPDATE creator_deliverables SET status='requested' WHERE id=${rows[1].id}`;
  await assert.rejects(assertLaunchReady(sql,input,options),/Approve the deliverable/);
  await sql`UPDATE creator_deliverables SET status='approved' WHERE id=${rows[1].id}`;
  const [changed]=await sql`SELECT * FROM creator_deliverables WHERE id=${rows[1].id}`;
  await approveDeliverable(sql,changed.id,creator.id,changed.updated_at,'another-reviewer',{drive_md5:hashes.story});
  await assert.rejects(verify(),/Approval evidence changed/);
  const current=await assertLaunchReady(sql,input,options);
  const assets=[{fileId:'feed',role:'feed',imageHash:'feed-hash'},{fileId:'story',role:'story',imageHash:'story-hash'}];
  const launch={adId:'paired-ad',assets,pairedApprovals:current.pairedApprovals,creator:'Pair fixture'};
  await recordPairedDriveLaunch(sql,launch);await recordPairedDriveLaunch(sql,launch);
  const saved=await sql`SELECT drive_file_id,deliverable_id,placement_role,ad_id FROM creative_assets ORDER BY drive_file_id`;
  assert.deepEqual(saved.map(row=>[row.drive_file_id,row.deliverable_id,row.placement_role,row.ad_id]),[['feed',rows[0].id,'feed','paired-ad'],['story',rows[1].id,'story','paired-ad']]);
  const progress=await sql`SELECT status,completed_asset_count,shipped_asset_count,expected_asset_count FROM creator_deliverables ORDER BY id`;
  assert.ok(progress.every(row=>row.status==='launched'&&row.completed_asset_count===1&&row.shipped_asset_count===1&&row.expected_asset_count===3));
  const cards=await sql`SELECT title,group_key FROM flow_cards ORDER BY title`;
  assert.deepEqual(cards.map(row=>[row.title,row.group_key]),[['feed','feed-hash'],['story','story-hash']]);
  await sql`UPDATE creator_deliverables SET approval_id=NULL WHERE id=${rows[1].id}`;
  await assert.rejects(recordPairedDriveLaunch(sql,launch),/changed after dispatch/);
  await sql`UPDATE creator_agreements SET status='revoked' WHERE creator_id=${creator.id}`;
  await assert.rejects(assertLaunchReady(sql,input,options),/agreement/);
 }finally{await db.close();}
});
