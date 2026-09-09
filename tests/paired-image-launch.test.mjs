import {readLaunchPacket} from '../api/_lib/launch-packets.js';
import {neon} from '@neondatabase/serverless';
import metaHandler from '../api/meta.js';import {useTestDatabase} from './neon-test-adapter.mjs';
import {ensureOperationJournal} from '../api/_lib/operation-journal.js';
import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureApprovalSnapshots,approveDeliverable} from '../api/_lib/approval-snapshots.js';
import {ensureProviderMedia} from '../api/_lib/provider-media.js';import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {assertLaunchReady,assertApprovalMediaMatches} from '../api/_lib/launch-preflight.js';import {recordPairedImageLaunch} from '../api/_lib/paired-image-launch.js';
import {digest} from '../api/_lib/operation-journal.js';import {launchApprovalRecords,pairedPlacementRules,effectiveMetaUrlTags} from '../src/lib/launch-review.js';

test('paired image approvals survive upload and record two independently approved outputs',async t=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 Object.assign(process.env,{META_AD_ACCOUNT_ID:'fixture',META_ACCESS_TOKEN:'fixture-token',AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureApprovalSnapshots(sql);await ensureProviderMedia(sql);await ensureLocalReceipts(sql);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Paired images') RETURNING id`;
  const [engagement]=await sql`INSERT INTO creator_engagements(creator_id,status,paid_media_included) VALUES (${creator.id},'active',true) RETURNING id`;
  await sql`INSERT INTO creator_agreements(creator_id,engagement_id,title,agreement_body,status,accepted_at,source_metadata)
    SELECT ${creator.id},id,'Terms','Fixture','accepted',now(),jsonb_build_object('terms_version',1,'engagement_snapshot',to_jsonb(e)) FROM creator_engagements e WHERE id=${engagement.id}`;
  const outputs={},hashes={feed:'a'.repeat(64),story:'b'.repeat(64)},rows={};
  for(const role of ['feed','story']){
    outputs[role]=`https://example.test/${role}.png`;
    const [d]=await sql`INSERT INTO creator_deliverables(creator_id,engagement_id,title,output_url,expected_asset_count)
      VALUES (${creator.id},${engagement.id},${role},${outputs[role]},3) RETURNING *`;
    rows[role]=await approveDeliverable(sql,d.id,creator.id,d.updated_at,'reviewer',{sha256:hashes[role]});
    await sql`INSERT INTO provider_media(account_id,kind,provider_id,source_url,request_key,content_hash)
      VALUES ('act_fixture','image',${role},${outputs[role]},${role},${hashes[role]})`;
    await sql`INSERT INTO flow_cards(title,stage,creator_id,deliverable_id,group_key) VALUES (${role},'produce',${creator.id},${d.id},'old-group')`;
  }
  const common={action:'create_paired_image_ad',creatorId:creator.id,deliverableId:rows.feed.id};
  const preview={...common,review_sources:[{role:'feed',imageUrl:outputs.feed},{role:'story',imageUrl:outputs.story}]};
  const prepared=await assertLaunchReady(sql,preview);
  const reviewedMedia=['feed','story'].map(role=>({role,url:outputs[role],sha256:hashes[role]}));
  assertApprovalMediaMatches(prepared,reviewedMedia);
  assert.throws(()=>assertApprovalMediaMatches(prepared,[reviewedMedia[0],{...reviewedMedia[1],sha256:'changed'}]),/changed since output approval/);
  const input={...common,feedImageHash:'feed',storyImageHash:'story'};
  const uploaded=await assertLaunchReady(sql,input);
  assert.equal(digest(prepared),digest(uploaded),'confirmed approval evidence is independent of temporary upload IDs');
  assert.equal(launchApprovalRecords([prepared]).length,2);
  await sql`UPDATE provider_media SET content_hash='changed' WHERE provider_id='story'`;
  await assert.rejects(assertLaunchReady(sql,input),/fingerprint/);
  await sql`UPDATE provider_media SET content_hash=${hashes.story} WHERE provider_id='story'`;
  await assert.rejects(assertLaunchReady(sql,{...input,storyImageHash:'missing'}),/differs|fingerprint|verified/);
  await assert.rejects(assertLaunchReady(sql,{...preview,review_sources:[preview.review_sources[0],preview.review_sources[0]],imageUrl:outputs.story}),/each identify/);
  await assert.rejects(assertLaunchReady(sql,{...input,sourceVideoUrl:'https://example.test/extra.mp4'}),/additional unreviewed/);
  await assert.rejects(assertLaunchReady(sql,{...input,deliverableId:999}),/do not match/);
  const launch={adId:'paired-ad',adName:'Fixture',images:{feed:'feed',story:'story'},pairedApprovals:uploaded.pairedMediaApprovals};
  await recordPairedImageLaunch(sql,launch);await recordPairedImageLaunch(sql,launch);
  const assets=await sql`SELECT placement_role,deliverable_id,meta_image_hash FROM creative_assets ORDER BY placement_role`;
  assert.deepEqual(assets.map(row=>[row.placement_role,row.deliverable_id,row.meta_image_hash]),[['feed',rows.feed.id,'feed'],['story',rows.story.id,'story']]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM creative_assets`)[0].n,2);
  const counts=await sql`SELECT completed_asset_count,shipped_asset_count,expected_asset_count FROM creator_deliverables`;
  assert.ok(counts.every(row=>row.completed_asset_count===1&&row.shipped_asset_count===1&&row.expected_asset_count===3));
  const cards=await sql`SELECT title,group_key FROM flow_cards ORDER BY title`;assert.deepEqual(cards.map(row=>[row.title,row.group_key]),[['feed','feed'],['story','story']]);
  await ensureOperationJournal(sql);let creates=0,creatives=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(options.method!=='POST')return Response.json({id:'adset',account_id:'fixture',campaign_id:'campaign',targeting:{age_min:18}});
    if(String(url).endsWith('/adcreatives')){creatives++;return Response.json({id:'fixture-creative'});}
    if(String(url).endsWith('/ads')){creates++;return Response.json({id:'fixture-ad'});}
    throw new Error('Unexpected fixture provider request');
  });
  const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
  const request={method:'POST',headers:{},body:{...input,adName:'Campfire images',headline:'Campfire',primaryText:'Ready for the campsite',destUrl:'https://example.test/product',adsetId:'adset',pageId:'page'}};
  request.body.reviewed_plan={version:1,confirmed:true,ad_name:request.body.adName,approval_hash:digest(JSON.parse(JSON.stringify([await assertLaunchReady(neon(process.env.DATABASE_URL),structuredClone(preview))]))),
    fields:{headline:request.body.headline,primary_text:request.body.primaryText,dest_url:request.body.destUrl,url_tags:effectiveMetaUrlTags(request.body.urlParams),page_id:'page',instagram_user_id:''},
    media:['feed','story'].map(role=>({role,url:outputs[role],sha256:hashes[role]})),placement_rules:pairedPlacementRules(),
    target:{mode:'existing',id:'adset',snapshot:{id:'adset',account_id:'fixture',campaign_id:'campaign',targeting:{age_min:18}}}};
  assert.deepEqual(JSON.parse(JSON.stringify(await assertLaunchReady(sql,structuredClone(request.body)))),JSON.parse(JSON.stringify(prepared)));
  await db.exec("ALTER TABLE creative_assets ADD CONSTRAINT fixture_failure CHECK (placement_role <> 'story') NOT VALID");
  const failed=response();await metaHandler(structuredClone(request),failed);assert.equal(failed.statusCode,503,JSON.stringify(failed.body));assert.match(failed.body.error,/Meta ad fixture-ad exists/);
  await db.exec('ALTER TABLE creative_assets DROP CONSTRAINT fixture_failure');
  const resumed=response();await metaHandler(structuredClone(request),resumed);assert.equal(resumed.statusCode,200,JSON.stringify(resumed.body));
  assert.equal(creates,1);assert.equal(creatives,1);assert.equal(resumed.body.adId,'fixture-ad');
  const packet=await readLaunchPacket(sql,'fixture-ad');assert.equal(packet.snapshot.review.confirmed,true);assert.equal(packet.snapshot.media_receipts.length,2);assert.equal(launchApprovalRecords(packet.snapshot.evidence.approvals).length,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM creative_assets WHERE ad_id='fixture-ad'`)[0].n,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM launch_history WHERE ad_id='fixture-ad'`)[0].n,1);
  await sql`UPDATE creator_agreements SET status='revoked' WHERE creator_id=${creator.id}`;
  await assert.rejects(assertLaunchReady(sql,input),/agreement/);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
