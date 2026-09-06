import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthenticatedFetch } from '../src/lib/authenticatedFetch.js';
import { ROLE_PERMISSIONS, getAppAccess } from '../api/_lib/app-access.js';
import { META_ACTION_PERMISSIONS, canRunMetaAction } from '../api/_lib/meta-permissions.js';
import callback from '../api/shopify-callback.js';
import { resolvePublicUrl } from '../api/_lib/safe-fetch.js';
import { ensureOperationJournal, runExternalStep, rememberProviderRead } from '../api/_lib/operation-journal.js';
import metaHandler, { logLaunch } from '../api/meta.js';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { resolveEmail, verifiedUserEmail } from '../api/_lib/auth.js';
import { claimWork, finishWork, recordProviderUsage } from '../api/_lib/work-controls.js';
import { initializeSchema } from '../api/db/schema.js';
import { enqueueCreativeAssetAnalysis, enqueueCreativeAnalyses, claimCreativeAnalysisJob, claimManualCreativeAnalysis, completeCreativeAnalysisJob, failCreativeAnalysisJob } from '../api/_lib/creative-analysis-queue.js';
import { saveSessionEdits } from '../api/_lib/session-edits.js';
import { reserveOperationBudget } from '../api/_lib/operation-budget.js';
import { completeRender } from '../api/_lib/render-completion.js';
import { syncCreativeAnalytics } from '../api/_lib/meta/sync.js';
import { assertLaunchReady } from '../api/_lib/launch-preflight.js';
import { ensureLaunchDrafts, saveLaunchDraft } from '../api/_lib/launch-drafts.js';
import { recoverRenders } from '../api/_lib/render-recovery.js';
import { boundedWork, workSignal, checkWork } from '../api/_lib/bounded-work.js';
import { approveDeliverable, ensureApprovalSnapshots } from '../api/_lib/approval-snapshots.js';
import { journalMediaUpload } from '../api/_lib/provider-media.js';
import { creativeVariant, readCreativeVariants, ensureCreativeVariants, ensureVariantObservations } from '../api/_lib/creative-variants.js';
import { ensureExperiments, validateProtocol, bindExperimentAds, experimentEvidence } from '../api/_lib/experiments.js';
import { ensureAuthIdentities, resolveWorkspaceIdentity } from '../api/_lib/auth-identities.js';
import { claimTranscription, saveTranscription } from '../api/_lib/transcription-jobs.js';
import { verifyRecoveredMetaAd } from '../api/_lib/operation-recovery.js';

const db = new PGlite();
const sql = async (parts, ...values) => {
  const query = parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
  return (await db.query(query, values)).rows;
};
test.after(() => db.close());

test('retired Shopify callback never performs a token exchange', async () => {
  let status;
  await callback({ query: { code: 'anything', shop: 'attacker.example' } }, {
    setHeader() {}, status(value) { status = value; return this; }, json() {},
  });
  assert.equal(status, 410);
});

test('workspace membership uses only a verified primary email, ignoring custom email claims', async () => {
  const user={primaryEmailAddressId:'primary',emailAddresses:[
    {id:'primary',emailAddress:'unverified@example.test',verification:{status:'unverified'}},
    {id:'secondary',emailAddress:'verified-secondary@example.test',verification:{status:'verified'}},
  ]};
  assert.equal(verifiedUserEmail(user),null);
  assert.equal(await resolveEmail('claim-test','owner@example.test',async()=>user),null);
  user.emailAddresses[0].verification.status='verified';
  assert.equal(verifiedUserEmail(user),'unverified@example.test');
});

test('tokens stay on origin; Request/Headers/URL input is preserved', async () => {
  const calls = [];
  let tokenCalls = 0;
  const authenticated = createAuthenticatedFetch(async (input, init) => calls.push({ input, init }), async () => { tokenCalls++; return 'test-token'; }, 'https://howl.example');
  for (const input of ['https://other.example/api/x', '//other.example/api/x', new URL('https://other.example/api/x'), new Request('https://other.example/api/x'), '/logos/api-image.png']) await authenticated(input);
  assert.equal(tokenCalls, 0);
  const request = new Request('https://howl.example/api/data', { headers: { 'x-original': 'yes' } });
  await authenticated(request, { headers: new Headers({ 'x-added': 'yes' }) });
  assert.equal(tokenCalls, 1);
  assert.equal(calls.at(-1).init.headers.get('authorization'), 'Bearer test-token');
  assert.equal(calls.at(-1).init.headers.get('x-original'), 'yes');
  assert.equal(calls.at(-1).init.headers.get('x-added'), 'yes');
});

test('every Meta dispatch has a permission; read-only roles cannot mutate', async () => {
  const source = await readFile(new URL('../api/meta.js', import.meta.url), 'utf8');
  const actions = [...source.matchAll(/case '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(actions.sort(), Object.keys(META_ACTION_PERMISSIONS).sort());
  for (const role of ['viewer', 'analyst']) {
    const access = { permissions: ROLE_PERMISSIONS[role] };
    for (const [action, permissions] of Object.entries(META_ACTION_PERMISSIONS)) {
      if (permissions.some(value => !value.endsWith('.read'))) assert.equal(canRunMetaAction(access, action), false, `${role}: ${action}`);
    }
  }
  assert.equal(canRunMetaAction({ permissions: ['*'] }, 'unregistered_action'), false);
});

test('URL imports reject internal DNS answers and literal/private IPv6 addresses', async () => {
  for (const url of ['http://127.0.0.1', 'https://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'https://[::ffff:127.0.0.1]', 'https://user:password@example.com', 'http://example.com:8080']) {
    await assert.rejects(resolvePublicUrl(url, async () => [{ address: '127.0.0.1', family: 4 }]));
  }
  await assert.rejects(resolvePublicUrl('https://example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]));
  assert.equal((await resolvePublicUrl('https://example.com', async () => [{ address: '93.184.216.34', family: 4 }])).addresses[0].address, '93.184.216.34');
});

test('complete schema bootstraps an empty PostgreSQL database', async () => {
  await initializeSchema(sql);
  await ensureOperationJournal(sql);
});

test('suspended users have no permissions; expired invitations cannot grant access', async () => {
  process.env.NODE_ENV = 'production'; process.env.ADMIN_EMAILS = '';
  await sql`INSERT INTO app_users (user_id,email,role,status) VALUES ('suspended','suspended@example.test','producer','suspended')`;
  const suspended = await getAppAccess({ userId: 'suspended', email: 'suspended@example.test' }, sql);
  assert.deepEqual(suspended.permissions, []);
  await sql`INSERT INTO app_invitations (email,role,expires_at) VALUES ('expired@example.test','admin',now()-interval '1 hour')`;
  const expired = await getAppAccess({ userId: 'expired', email: 'expired@example.test' }, sql);
  assert.equal(expired.user, null);
  assert.deepEqual(expired.permissions, []);
});

test('refresh preserves a launch absent from analytics; final crashed lease becomes failed', async () => {
  await enqueueCreativeAssetAnalysis(sql, 'new-launch', 'launch');
  await enqueueCreativeAnalyses(sql);
  let job = await claimCreativeAnalysisJob(sql);
  assert.equal(job.group_key, 'new-launch');
  await sql`UPDATE creative_analysis_queue SET attempts = max_attempts, started_at = now()-interval '20 minutes' WHERE group_key = 'new-launch'`;
  assert.equal(await claimCreativeAnalysisJob(sql), null);
  const [row] = await sql`SELECT status FROM creative_analysis_queue WHERE group_key = 'new-launch'`;
  assert.equal(row.status, 'failed');
});

test('invitation acceptance provisions exactly one identity and consumes only on success', async () => {
  await sql`INSERT INTO app_invitations (email,role) VALUES ('race@example.test','producer')`;
  const outcomes = await Promise.all(['race-a', 'race-b'].map(userId => getAppAccess({ userId, email: 'race@example.test' }, sql)));
  assert.equal(outcomes.filter(item => item.user).length, 1);
  const [invite] = await sql`SELECT * FROM app_invitations WHERE email = 'race@example.test'`;
  assert.equal(invite.status, 'accepted');
  assert.equal(invite.accepted_by, outcomes.find(item => item.user).user.user_id);
  const replay = await getAppAccess({ userId: invite.accepted_by, email: invite.email }, sql);
  assert.equal(replay.role, 'producer');
  await sql`INSERT INTO app_invitations (email,role) VALUES ('suspended@example.test','admin')`;
  assert.equal((await getAppAccess({ userId: 'duplicate-email', email: 'suspended@example.test' }, sql)).user, null);
  const [unconsumed] = await sql`SELECT status FROM app_invitations WHERE email = 'suspended@example.test'`;
  assert.equal(unconsumed.status, 'pending');
});

test('a replaced queue worker cannot complete or fail the current lease', async () => {
  await enqueueCreativeAssetAnalysis(sql, 'lease-test');
  const first = await claimCreativeAnalysisJob(sql);
  await sql`UPDATE creative_analysis_queue SET started_at = now()-interval '20 minutes' WHERE group_key = ${first.group_key}`;
  const second = await claimCreativeAnalysisJob(sql);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal(await completeCreativeAnalysisJob(sql, first.group_key, first), false);
  await failCreativeAnalysisJob(sql, first, 'late failure');
  const [row] = await sql`SELECT status, lease_token FROM creative_analysis_queue WHERE group_key = ${second.group_key}`;
  assert.equal(row.status, 'processing');
  assert.equal(row.lease_token, second.lease_token);
  assert.equal(await completeCreativeAnalysisJob(sql, second.group_key, second), true);
  await enqueueCreativeAssetAnalysis(sql, second.group_key);
  assert.equal((await claimCreativeAnalysisJob(sql)).attempts, 1);
});

test('parallel/retried external operations do not duplicate a provider mutation', async () => {
  let calls = 0;
  const operation = { operationKey: 'launch', stepKey: 'ad', payload: { name: 'test' }, actorId: 'test' };
  const perform = async () => { calls++; return { adId: 'provider-ad' }; };
  const results = await Promise.allSettled([runExternalStep(sql, operation, perform), runExternalStep(sql, operation, perform)]);
  assert.ok(results.some(item => item.status === 'fulfilled'));
  assert.equal(calls, 1);
  assert.deepEqual(await runExternalStep(sql, operation, perform), { adId: 'provider-ad' });
  assert.equal(calls, 1);
  await assert.rejects(runExternalStep(sql, { ...operation, payload: { name: 'changed' } }, perform));
  const uncertain = { ...operation, operationKey: 'uncertain' };
  await assert.rejects(runExternalStep(sql, uncertain, async () => { throw new Error('lost response'); }));
  await assert.rejects(runExternalStep(sql, uncertain, perform), /uncertain/);
  assert.equal(calls, 1);
});

test('editor writes are atomic, detect stale revisions, and preserve server render state', async () => {
  const [session] = await sql`INSERT INTO ugc_sessions (video_url, title, settings) VALUES ('https://test.example/video.mp4','before','{"remotion_render":{"render_id":"current"}}'::jsonb) RETURNING id`;
  assert.ok(await saveSessionEdits(sql, session.id, { title: 'after', settings: { captionScale: 2, remotion_render: { render_id: 'forged' } } }, 0));
  assert.equal(await saveSessionEdits(sql, session.id, { title: 'stale' }, 0), null);
  const [row] = await sql`SELECT * FROM ugc_sessions WHERE id = ${session.id}`;
  assert.equal(row.title, 'after');
  assert.equal(row.settings.remotion_render.render_id, 'current');
  assert.equal(row.settings.captionScale, 2);
  assert.equal(row.revision, 1);
});

test('shared draft writes survive reload and reject conflicting device revisions', async () => {
  await ensureLaunchDrafts(sql);
  const first = await saveLaunchDraft(sql,'cross-device',{name:'Original'},null,'device-a');
  assert.equal(first.revision,0);
  const attempts = await Promise.all(['First edit','Second edit'].map(name => saveLaunchDraft(sql,'cross-device',{name},0,'device-b')));
  assert.equal(attempts.filter(Boolean).length,1);
  const [persisted] = await sql`SELECT * FROM launch_drafts WHERE id = 'cross-device'`;
  assert.equal(persisted.revision,1);
  assert.deepEqual(persisted.payload, attempts.find(Boolean).payload);
  assert.equal(await saveLaunchDraft(sql,'cross-device',{name:'Duplicate'},null,'device-c'),null);
});

test('analysis deadline aborts work and prevents subsequent writes', async () => {
  await assert.rejects(boundedWork(async () => {
    await new Promise(resolve => workSignal().addEventListener('abort',resolve,{once:true}));
    checkWork();
  },10), /time budget/);
});

test('background recovery completes abandoned renders and quarantines unknown starts', async () => {
  const [known] = await sql`INSERT INTO ugc_sessions (video_url,status,settings) VALUES ('source','rendering','{"remotion_render":{"render_id":"abandoned","bucket_name":"bucket","region":"us-east-1","function_name":"function"}}'::jsonb) RETURNING id`;
  const [unknown] = await sql`INSERT INTO ugc_sessions (video_url,status,settings,updated_at) VALUES ('source','rendering','{"remotion_render":{"provider":"starting"}}'::jsonb,now()-interval '10 minutes') RETURNING id`;
  const results = await recoverRenders(sql, async () => ({done:true,outputFile:'recovered.mp4'}));
  assert.equal(results.find(row => row.id === known.id).status,'completed');
  assert.equal(results.find(row => row.id === unknown.id).status,'unknown');
  const [saved] = await sql`SELECT rendered_url FROM ugc_sessions WHERE id = ${known.id}`;
  assert.equal(saved.rendered_url,'recovered.mp4');
});

test('daily seeding reservations are atomic and retries reuse their reservation', async () => {
  const results = await Promise.allSettled(['a','b','c','d'].map(key => reserveOperationBudget(sql, 'test.seed', key, 2)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  const accepted = ['a','b','c','d'][results.findIndex(result => result.status === 'fulfilled')];
  await reserveOperationBudget(sql, 'test.seed', accepted, 2);
  const [row] = await sql`SELECT used FROM app_operation_budgets WHERE scope = 'test.seed'`;
  assert.equal(row.used, 2);
});

test('stale render completion cannot replace a current render or regress a launched deliverable', async () => {
  const [creator] = await sql`INSERT INTO creators (name) VALUES ('Render test') RETURNING id`;
  const [deliverable] = await sql`INSERT INTO creator_deliverables (creator_id,title,status,output_url) VALUES (${creator.id},'Approved output','launched','approved.mp4') RETURNING id`;
  const [session] = await sql`INSERT INTO ugc_sessions (video_url,creator_id,deliverable_id,settings)
    VALUES ('source.mp4',${creator.id},${deliverable.id},'{"captionScale":2,"remotion_render":{"render_id":"B"}}'::jsonb) RETURNING id`;
  assert.equal(await completeRender(sql, session.id, { render_id: 'A' }, 'old.mp4'), null);
  assert.ok(await completeRender(sql, session.id, { render_id: 'B' }, 'new.mp4'));
  assert.ok(await completeRender(sql, session.id, { render_id: 'B' }, 'new.mp4'));
  const [saved] = await sql`SELECT * FROM ugc_sessions WHERE id = ${session.id}`;
  assert.equal(saved.settings.captionScale, 2);
  assert.equal(saved.settings.remotion_renders.length, 1);
  assert.equal(saved.rendered_url, 'new.mp4');
  const [output] = await sql`SELECT status,output_url FROM creator_deliverables WHERE id = ${deliverable.id}`;
  assert.equal(output.status, 'launched');
  assert.equal(output.output_url, 'approved.mp4');
});

test('analytics sync checkpoints pages, resumes, and only marks complete after insights finish', async () => {
  let failInsights = true;
  const fetchedAds = [];
  const mockFetch = async value => {
    const url = new URL(value);
    const page = Number(url.searchParams.get('page') || 1);
    if (url.pathname.endsWith('/ads')) {
      fetchedAds.push(page);
      return Response.json({ data: [{ id: `ad-${page}`, name: `Ad ${page}`, creative: { id: `creative-${page}`, image_hash: 'shared-media' } }],
        paging: page < 6 ? { next: `https://graph.facebook.com/v21.0/act_test/ads?page=${page+1}&access_token=must-not-persist` } : {} });
    }
    if (failInsights) throw new Error('provider unavailable');
    return Response.json({ data: [{ ad_id: 'ad-1', date_start: '2026-09-01', spend: '12' }] });
  };
  const args = { sql, accessToken: 'test-token', adAccountId: 'act_test', fetch: mockFetch };
  const partial = await syncCreativeAnalytics(args);
  assert.equal(partial.complete, false);
  assert.equal(partial.adsUpserted, 5);
  await assert.rejects(syncCreativeAnalytics(args), /provider unavailable/);
  let [run] = await sql`SELECT * FROM app_sync_state WHERE name = 'meta-insights:act_test:30'`;
  assert.equal(run.last_completed_at, null);
  assert.equal(run.state.phase, 'insights');
  assert.ok(!JSON.stringify(run.state).includes('must-not-persist'));
  failInsights = false;
  const finished = await syncCreativeAnalytics(args);
  assert.equal(finished.complete, true);
  assert.deepEqual(fetchedAds, [1,2,3,4,5,6]);
  [run] = await sql`SELECT * FROM app_sync_state WHERE name = 'meta-insights:act_test:30'`;
  assert.ok(run.last_completed_at);
  const [insight] = await sql`SELECT spend FROM creative_insights_daily WHERE ad_id = 'ad-1'`;
  assert.equal(Number(insight.spend), 12);
});

test('external creator launches require approval and current accepted paid-media rights', async () => {
  await assert.rejects(assertLaunchReady(sql, { creatorId: 123 }), /deliverable/);
  const [creator] = await sql`INSERT INTO creators (name) VALUES ('Rights test') RETURNING id`;
  const [engagement] = await sql`INSERT INTO creator_engagements (creator_id,status,paid_media_included,usage_term_months) VALUES (${creator.id},'active',true,12) RETURNING id`;
  const [deliverable] = await sql`INSERT INTO creator_deliverables (creator_id,engagement_id,title,status,approved_at) VALUES (${creator.id},${engagement.id},'Test','approved',now()) RETURNING id`;
  const input = { creatorId: creator.id, deliverableId: deliverable.id, sourceVideoUrl:'https://media.example/approved.mp4' };
  await ensureApprovalSnapshots(sql);
  const [review] = await sql`UPDATE creator_deliverables SET output_url = ${input.sourceVideoUrl} WHERE id = ${deliverable.id} RETURNING *`;
  assert.ok(await approveDeliverable(sql,deliverable.id,creator.id,review.updated_at,'reviewer',{sha256:'approved-digest'}));
  await assert.rejects(assertLaunchReady(sql, input), /agreement/);
  await sql`INSERT INTO creator_agreements (creator_id,engagement_id,title,agreement_body,status,accepted_at) VALUES (${creator.id},${engagement.id},'Test','Terms','accepted',now())`;
  await assertLaunchReady(sql, input);
  await sql`UPDATE creator_agreements SET accepted_at = now()-interval '2 years' WHERE engagement_id = ${engagement.id}`;
  await assert.rejects(assertLaunchReady(sql, input), /agreement/);
  await assertLaunchReady(sql, { sourceType: 'tool_generated' });
});

test('shared media keeps different copy and carousel revisions distinct', async () => {
  const first = {id:'a',creative:{id:'c',image_hash:'shared',object_story_spec:{link_data:{message:'First hook',child_attachments:[{image_hash:'one'},{image_hash:'two'}]}}}};
  const second = structuredClone(first);
  second.creative.object_story_spec.link_data.message = 'Different hook';
  assert.notEqual(creativeVariant(first).key,creativeVariant(second).key);
  second.creative.object_story_spec.link_data.message = 'First hook';
  second.creative.object_story_spec.link_data.child_attachments[1].image_hash = 'three';
  assert.notEqual(creativeVariant(first).key,creativeVariant(second).key);
  const thumb = structuredClone(first); thumb.creative.thumbnail_url='https://temporary.example';
  assert.equal(creativeVariant(first).key,creativeVariant(thumb).key);
  const rows = await readCreativeVariants(sql,365);
  const sameMedia = rows.filter(row => row.media_keys.includes('shared-media'));
  assert.equal(sameMedia.length,6);
  assert.equal(sameMedia.reduce((total,row) => total+row.spend,0),12);
});

test('upload retries reuse media receipts and approval snapshots reject a changed output', async () => {
  let uploads=0;
  const req={body:{action:'upload_video_url',videoUrl:'https://media.example/approved.mp4'}};
  const perform=async()=>{uploads++;return {videoId:'approved-video',sourceVideoUrl:req.body.videoUrl,contentHash:'approved-digest'};};
  await journalMediaUpload(sql,req,'uploader','act_test','video',perform);
  await journalMediaUpload(sql,req,'uploader','act_test','video',perform);
  assert.equal(uploads,1);
  const [deliverable] = await sql`SELECT * FROM creator_deliverables WHERE title = 'Test' AND approval_id IS NOT NULL LIMIT 1`;
  await sql`UPDATE creator_agreements SET accepted_at = now() WHERE engagement_id = ${deliverable.engagement_id}`;
  const input={creatorId:deliverable.creator_id,deliverableId:deliverable.id,videoId:'approved-video'};
  await assertLaunchReady(sql,input);
  await assert.rejects(assertLaunchReady(sql,{...input,videoId:'unregistered-video',sourceVideoUrl:req.body.videoUrl}),/fingerprint|verified source/);
  await assert.rejects(assertLaunchReady(sql,{...input,videoId:undefined,creativeId:'unregistered-creative',sourceVideoUrl:req.body.videoUrl}),/creation receipt/);
  await assert.rejects(assertLaunchReady(sql,{creatorId:deliverable.creator_id,deliverableId:deliverable.id,sourceVideoUrl:'https://media.example/unapproved.mp4'}),/differs/);
  const [snapshot] = await sql`SELECT snapshot FROM deliverable_approvals WHERE id = ${deliverable.approval_id}`;
  await sql`UPDATE creator_deliverables SET output_url = 'https://media.example/new.mp4', updated_at = now() WHERE id = ${deliverable.id}`;
  assert.equal(await approveDeliverable(sql,deliverable.id,deliverable.creator_id,deliverable.updated_at,'reviewer',{sha256:'approved-digest'}),null);
  const [unchanged] = await sql`SELECT snapshot FROM deliverable_approvals WHERE id = ${deliverable.approval_id}`;
  assert.deepEqual(unchanged.snapshot,snapshot.snapshot);
});

test('a definite provider rejection can retry; failed reads do not poison retry state', async () => {
  const step={operationKey:'rejected-action',stepKey:'create',payload:{name:'same request'}};
  await assert.rejects(runExternalStep(sql,step,async()=>{throw Object.assign(new Error('Rejected'),{definitelyNotApplied:true});}));
  assert.deepEqual(await runExternalStep(sql,step,async()=>({id:'accepted'})),{id:'accepted'});
  await assert.rejects(rememberProviderRead(sql,'thumbnail','video',async()=>{throw new Error('not ready');}));
  assert.deepEqual(await rememberProviderRead(sql,'thumbnail','video',async()=>({url:'stable.jpg'})),{url:'stable.jpg'});
  assert.deepEqual(await rememberProviderRead(sql,'thumbnail','video',async()=>({url:'changed.jpg'})),{url:'stable.jpg'});
});

test('replayed launch bookkeeping produces one history and media record', async () => {
  const input={ad_id:'replayed-ad',ad_name:'Replay test',source_video_url:'https://media.example/replayed.mp4'};
  const first=await logLaunch(input,sql);
  const replay=await logLaunch(input,sql);
  assert.equal(first.id,replay.id);
  const [history]=await sql`SELECT count(*)::int AS count FROM launch_history WHERE ad_id = 'replayed-ad'`;
  const [media]=await sql`SELECT count(*)::int AS count FROM creative_assets WHERE ad_id = 'replayed-ad'`;
  assert.equal(history.count,1); assert.equal(media.count,1);
});

test('Meta endpoint recovers a DB failure after provider acceptance without creating another ad', async () => {
  const savedEnv = {...process.env};
  const originalFetch = globalThis.fetch;
  let providerCreates=0, failLog=true;
  const restoreDatabase = useTestDatabase(db,query=>{
    if (failLog && /INSERT INTO launch_history/.test(query)) {failLog=false;throw new Error('Injected bookkeeping failure');}
  });
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://test:test@test.neon.tech/test',META_ACCESS_TOKEN:'synthetic',META_AD_ACCOUNT_ID:'test'});
  globalThis.fetch = async url => {
    assert.equal(String(url),'https://graph.facebook.com/v21.0/act_test/ads');
    providerCreates++; return Response.json({id:'endpoint-replay-ad'});
  };
  const invoke = async () => {
    const response={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},setHeader(){}};
    await metaHandler({method:'POST',headers:{},body:{action:'create_ad_from_creative',creativeId:'synthetic-creative',adsetId:'synthetic-adset',adName:'Endpoint replay',sourceType:'tool_generated'}},response);
    return response;
  };
  try {
    const first=await invoke();
    assert.equal(first.statusCode,503);
    const replay=await invoke();
    assert.equal(replay.statusCode,200);
    assert.equal(replay.body.adId,'endpoint-replay-ad');
    assert.equal(providerCreates,1);
    const [count]=await sql`SELECT count(*)::int AS count FROM launch_history WHERE ad_id = 'endpoint-replay-ad'`;
    assert.equal(count.count,1);
  } finally {
    globalThis.fetch=originalFetch; restoreDatabase();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env,savedEnv);
  }
});

test('paid-work concurrency is atomic across users and usage survives completion', async () => {
  const ids=await Promise.all(['a','a','b','b','c','c'].map(actor=>claimWork(sql,'test-generation',actor,{globalLimit:2,userLimit:1})));
  const accepted=ids.filter(Boolean);
  assert.equal(accepted.length,2);
  await recordProviderUsage(sql,accepted[0],{provider:'test',model:'synthetic',inputTokens:40,outputTokens:10});
  await finishWork(sql,accepted[0],'test-generation',200);
  assert.ok(await claimWork(sql,'test-generation','next',{globalLimit:2,userLimit:1}));
  assert.equal(await claimWork(sql,'test-generation','overflow',{globalLimit:2,userLimit:1}),null);
  const [run]=await sql`SELECT * FROM app_work_runs WHERE id=${accepted[0]}`;
  assert.equal(run.status,'completed'); assert.equal(Number(run.input_tokens),40); assert.equal(Number(run.output_tokens),10);
  assert.equal(run.cost_usd,null);
});

test('identity migration is explicit, issuer-bound, single-use, and preserves suspension', async () => {
  await ensureAuthIdentities(sql);
  await sql`INSERT INTO app_users (user_id,email,role,status) VALUES ('legacy-identity','migration@example.test','producer','suspended')`;
  const identity={issuer:'https://clerk.example.test',subject:'new-production-subject',email:'migration@example.test'};
  assert.equal(await resolveWorkspaceIdentity(sql,identity),identity.subject);
  await sql`INSERT INTO app_auth_migrations (issuer,email,user_id,expires_at) VALUES (${identity.issuer},${identity.email},'legacy-identity',now()+interval '1 day')`;
  assert.equal(await resolveWorkspaceIdentity(sql,{...identity,issuer:'https://wrong.example.test'}),identity.subject);
  assert.equal(await resolveWorkspaceIdentity(sql,{...identity,email:null}),identity.subject);
  assert.equal(await resolveWorkspaceIdentity(sql,identity),'legacy-identity');
  assert.equal(await resolveWorkspaceIdentity(sql,{...identity,subject:'another-subject'}),'another-subject');
  assert.equal(await resolveWorkspaceIdentity(sql,identity),'legacy-identity');
  const access=await getAppAccess({userId:'legacy-identity',email:identity.email},sql);
  assert.equal(access.user.status,'suspended');assert.deepEqual(access.permissions,[]);
});

test('comparison protocols freeze assignments and withhold conclusions for changed creative or insufficient evidence', async () => {
  await ensureExperiments(sql);
  await ensureCreativeVariants(sql);
  await ensureVariantObservations(sql);
  assert.throws(()=>validateProtocol({variants:'not-an-array'}));
  const input={variants:['variant:experiment-a','variant:experiment-b'],metric:'roas',days:7,minPurchases:20,minImpressions:1000};
  const protocol=validateProtocol(input);
  assert.ok(Date.parse(protocol.since)>Date.now());
  await assert.rejects(bindExperimentAds(sql,protocol),/ingested ad/);
  for(const [index,key] of input.variants.entries()) {
    await sql`INSERT INTO creative_performance (ad_id,variant_key) VALUES (${`experiment-ad-${index}`},${key})`;
    await sql`INSERT INTO creative_insights_daily (ad_id,date,spend,impressions,purchases,purchase_value)
      VALUES (${`experiment-ad-${index}`},${protocol.since},10,1000,20,100)`;
  }
  const bound=await bindExperimentAds(sql,protocol);
  const [{registered_at:registeredAt}]=await sql`SELECT clock_timestamp()::text AS registered_at`;
  assert.equal((await experimentEvidence(sql,{protocol:bound,created_at:registeredAt})).sufficient,false);
  const after=new Date(protocol.until+'T01:00:00Z');
  assert.equal((await experimentEvidence(sql,{protocol:bound,created_at:registeredAt},after)).sufficient,true);
  await sql`UPDATE creative_performance SET variant_key='variant:changed' WHERE ad_id='experiment-ad-0'`;
  assert.equal((await experimentEvidence(sql,{protocol:bound,created_at:registeredAt},after)).sufficient,false);
  await sql`UPDATE creative_performance SET variant_key='variant:experiment-a' WHERE ad_id='experiment-ad-0'`;
  assert.equal((await experimentEvidence(sql,{protocol:bound,created_at:registeredAt},after)).sufficient,false, 'changing back cannot erase observed contamination');
  const observations=await sql`SELECT variant_key FROM creative_variant_observations WHERE ad_id='experiment-ad-0' ORDER BY id`;
  assert.deepEqual(observations.map(row=>row.variant_key), ['variant:experiment-a','variant:changed','variant:experiment-a']);
});

test('provider receipt recovery rejects an unrelated ad or account',()=>{
  const time=new Date().toISOString();
  const step={step_key:'1:/v21.0/act_123/ads',created_at:time,updated_at:time,request_payload:{name:'Original',adset_id:'456',creative:'{"creative_id":"789"}',status:'PAUSED'}};
  const ad={id:'1000',name:'Original',account_id:'123',adset_id:'456',creative:{id:'789'},created_time:time};
  assert.equal(verifyRecoveredMetaAd(step,ad,'123').body.id,'1000');
  assert.throws(()=>verifyRecoveredMetaAd(step,{...ad,account_id:'other'},'123'),/different account/);
  assert.throws(()=>verifyRecoveredMetaAd(step,{...ad,creative:{id:'other'}},'123'),/does not match/);
  assert.throws(()=>verifyRecoveredMetaAd(step,{...ad,created_time:'2000-01-01'},'123'),/creation time/);
});

test('transcription cannot run twice or replace edits made while processing',async()=>{
  const [session]=await sql`INSERT INTO ugc_sessions (user_id,title,video_url,status) VALUES ('test','Transcription test','https://example.test/source.mp4','uploaded') RETURNING id`;
  const source='https://example.test/source.mp4';
  const job=await claimTranscription(sql,session.id,source);assert.ok(job);
  assert.equal(await claimTranscription(sql,session.id,source),null);
  await sql`UPDATE ugc_sessions SET revision=revision+1,words='[{"word":"edited"}]' WHERE id=${session.id}`;
  assert.equal(await saveTranscription(sql,session.id,source,job,{words:[{word:'stale'}],duration:1,audioUrl:'https://example.test/audio.mp3'}),false);
  const [saved]=await sql`SELECT words FROM ugc_sessions WHERE id=${session.id}`;
  assert.equal(saved.words[0].word,'edited');
});


test('manual analysis shares queue ownership and cannot replace an active worker', async () => {
  const group='manual-lease-fixture';
  const first=await claimManualCreativeAnalysis(sql,group);
  assert.ok(first?.lease_token);
  assert.equal(await claimManualCreativeAnalysis(sql,group),null);
  await sql`UPDATE creative_analysis_queue SET started_at=now()-interval '16 minutes' WHERE group_key=${group}`;
  const second=await claimManualCreativeAnalysis(sql,group);
  assert.notEqual(first.lease_token,second.lease_token);
  assert.equal(await completeCreativeAnalysisJob(sql,group,first),false);
  assert.equal(await completeCreativeAnalysisJob(sql,group,second),true);
});


test('expired manual analysis is not retried without its request-local transcript', async () => {
  const group='expired-manual-fixture';
  await claimManualCreativeAnalysis(sql,group);
  await enqueueCreativeAssetAnalysis(sql,group,'launch');
  await sql`UPDATE creative_analysis_queue SET started_at=now()-interval '16 minutes' WHERE group_key=${group}`;
  await claimCreativeAnalysisJob(sql);
  const [row]=await sql`SELECT status,source FROM creative_analysis_queue WHERE group_key=${group}`;
  assert.deepEqual(row,{status:'failed',source:'manual'});
});
