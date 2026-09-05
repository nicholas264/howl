import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthenticatedFetch } from '../src/lib/authenticatedFetch.js';
import { ROLE_PERMISSIONS, getAppAccess } from '../api/_lib/app-access.js';
import { META_ACTION_PERMISSIONS, canRunMetaAction } from '../api/_lib/meta-permissions.js';
import callback from '../api/shopify-callback.js';
import { resolvePublicUrl } from '../api/_lib/safe-fetch.js';
import { ensureOperationJournal, runExternalStep } from '../api/_lib/operation-journal.js';
import { initializeSchema } from '../api/db/schema.js';
import { enqueueCreativeAssetAnalysis, enqueueCreativeAnalyses, claimCreativeAnalysisJob } from '../api/_lib/creative-analysis-queue.js';
import { saveSessionEdits } from '../api/_lib/session-edits.js';
import { reserveOperationBudget } from '../api/_lib/operation-budget.js';
import { completeRender } from '../api/_lib/render-completion.js';
import { syncCreativeAnalytics } from '../api/_lib/meta/sync.js';
import { assertLaunchReady } from '../api/_lib/launch-preflight.js';

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
  const input = { creatorId: creator.id, deliverableId: deliverable.id };
  await assert.rejects(assertLaunchReady(sql, input), /agreement/);
  await sql`INSERT INTO creator_agreements (creator_id,engagement_id,title,agreement_body,status,accepted_at) VALUES (${creator.id},${engagement.id},'Test','Terms','accepted',now())`;
  await assertLaunchReady(sql, input);
  await sql`UPDATE creator_agreements SET accepted_at = now()-interval '2 years' WHERE engagement_id = ${engagement.id}`;
  await assert.rejects(assertLaunchReady(sql, input), /agreement/);
  await assertLaunchReady(sql, { sourceType: 'tool_generated' });
});
