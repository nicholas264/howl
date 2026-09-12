import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureApprovalSnapshots} from '../api/_lib/approval-snapshots.js';
import {assertLaunchReady,assertApprovalMediaMatches} from '../api/_lib/launch-preflight.js';
import {launchEvidenceVerifier} from '../api/_lib/launch-packets.js';
import {verifyReviewedLaunch} from '../api/_lib/reviewed-launch.js';
import {digest} from '../api/_lib/operation-journal.js';
import {pairedPlacementRules} from '../src/lib/launch-review.js';

test('outside-approved creator pairs require explicit confirmation and bind the exact files to review',async()=>{
 const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureApprovalSnapshots(sql);
  const [creator]=await sql`INSERT INTO creators(name,source) VALUES ('Existing creator','launcher') RETURNING id`;
  const input={action:'launch_meta_ad',creatorId:creator.id,sourceType:'external_creator',pair:{feedFileId:'feed',storyFileId:'story'}};
  const hashes={feed:'a'.repeat(32),story:'b'.repeat(32)},options={driveDigest:async id=>hashes[id]};
  await assert.rejects(assertLaunchReady(sql,input,options),/approval is missing/);
  await assert.rejects(assertLaunchReady(sql,{...input,externalApprovalConfirmed:'true'},options),/approval is missing/);
  const confirmed={...input,externalApprovalConfirmed:true};
  const evidence=await assertLaunchReady(sql,confirmed,options);
  assert.equal(evidence.externalApproval.creator_id,creator.id);assert.equal(evidence.approval,undefined);
  assert.deepEqual(evidence.driveDigests,hashes);
  const media=[{role:'feed',drive_file_id:'feed',drive_md5:hashes.feed},{role:'story',drive_file_id:'story',drive_md5:hashes.story}];
  assertApprovalMediaMatches(evidence,media);
  assert.throws(()=>assertApprovalMediaMatches(evidence,[{...media[0],drive_md5:'c'.repeat(32)},media[1]]),/Media changed/);
  const adset={id:'set',campaign_id:'campaign',targeting:{age_min:18}},rules=pairedPlacementRules();
  const review={version:1,confirmed:true,ad_name:'Pair',approval_hash:digest([evidence]),fields:{page_id:'page',instagram_user_id:'',headline:'Title',primary_text:'Copy',dest_url:'https://example.test',url_tags:''},media,placement_rules:rules,target:{mode:'existing',id:'set',snapshot:adset}};
  const context={payload:{name:'Pair'},adset,creative:{object_story_spec:{page_id:'page'},asset_feed_spec:{images:[{hash:'feedHash',adlabels:[{name:'image_feed'}]},{hash:'storyHash',adlabels:[{name:'image_story'}]}],bodies:[{text:'Copy'}],titles:[{text:'Title'}],link_urls:[{website_url:'https://example.test'}],asset_customization_rules:rules}},media:{receipts:[]},driveUploads:[{step_key:'feed',result:{imageHash:'feedHash',contentMd5:hashes.feed}},{step_key:'story',result:{imageHash:'storyHash',contentMd5:hashes.story}}],evidence:{approvals:[evidence]}};
  assert.ok(await verifyReviewedLaunch(sql,review,context));
  await assert.rejects(verifyReviewedLaunch(sql,review,{...context,evidence:{approvals:[null]}}),/approval or rights evidence/);
  const recheck=launchEvidenceVerifier(sql,[confirmed],[evidence],options);hashes.feed='d'.repeat(32);
  await assert.rejects(recheck(),/Approval evidence changed/);
  await assert.rejects(assertLaunchReady(sql,{...confirmed,creatorId:999999},options),/existing creator/);
  await assert.rejects(assertLaunchReady(sql,{...confirmed,briefId:77},options),/managed brief/);
  const [deliverable]=await sql`INSERT INTO creator_deliverables(creator_id,title,status,drive_file_id) VALUES (${creator.id},'Managed output','received','managed') RETURNING id`;
  await assert.rejects(assertLaunchReady(sql,{...confirmed,pair:undefined,fileId:'managed'},options),/Approve the deliverable/);
  await assert.rejects(assertLaunchReady(sql,{...confirmed,pair:undefined,fileId:'other',deliverableId:deliverable.id},options),/Approve the deliverable/);
 }finally{await db.close();}
});
