import { ensureRateLimits } from '../api/_lib/rate-limit.js';
import { ensureWorkControls } from '../api/_lib/work-controls.js';
import { ensureOperationBudgets } from '../api/_lib/operation-budget.js';
import { ensureCreatorOpsTables } from '../api/_lib/creator-ops.js';
import { ensureAnalysisSchema } from '../api/_lib/analysis-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { initializeSchema } from '../api/db/schema.js';
import { useTestDatabase } from './neon-test-adapter.mjs';
import generate from '../api/generate.js';
import workflow from '../api/creator-workflow.js';
import planner from '../api/creator-campaign-planner.js';
import { SCRIPTWRITING_VERSION, buildFounderScriptRequest } from '../api/_lib/howl-scriptwriting.js';

const response = () => ({
  statusCode: 200, headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  once(event, callback) { if (event === 'finish') this.onFinish = callback; },
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; this.onFinish?.(); return this; },
});

test('every script-generating route sends the studied method to the provider and preserves its output contract', async () => {
  const db = new PGlite();
  const previous = { ...process.env }, previousFetch = globalThis.fetch;
  const restore = useTestDatabase(db);
  const sql = async (parts, ...values) => (await db.query(parts.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, ''), values)).rows;
  const calls = [];
  let providerResult;
  try {
    Object.assign(process.env, { NODE_ENV: 'development', AUTH_DISABLED: 'true', DATABASE_URL: 'postgresql://fixture:fixture@fixture.test/db', ANTHROPIC_API_KEY: 'fixture-key' });
    await initializeSchema(sql);
    await ensureRateLimits(sql); await ensureWorkControls(sql); await ensureOperationBudgets(sql); await ensureCreatorOpsTables(sql); await ensureAnalysisSchema(sql);
    const [creator] = await sql`INSERT INTO creators(name,status,niche) VALUES ('Script fixture','qualified','weekend camping') RETURNING id`;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages', 'no unrelated provider calls');
      calls.push(JSON.parse(init.body));
      return Response.json({ content: [{ type: 'text', text: typeof providerResult === 'string' ? providerResult : JSON.stringify(providerResult) }] });
    };
    const call = async (handler, body, expectedStatus = 200) => {
      const res = response();
      await handler({ method: 'POST', headers: {}, query: {}, body }, res);
      assert.equal(res.statusCode, expectedStatus, JSON.stringify(res.body));
      // Wait for the response-finish lease cleanup before closing the fixture.
      for (let attempt = 0; attempt < 100; attempt++) {
        const pending = await sql`SELECT id FROM app_work_runs WHERE status = 'running'`;
        if (!pending.length) break;
        await new Promise(resolve => setImmediate(resolve));
        if (attempt === 99) assert.fail('Response work lease did not finish');
      }
      return res;
    };
    providerResult = 'HOOK: Still cold?\nSTORY: Meet the R3.\nPROOF: It has a radiant tube.\nCTA: See the R3.';
    const founder = await call(generate, { task: 'founder_script', brief: { scriptType: 'tech', product: 'r3', length: '30', tone: 'direct', customContext: 'Show the real tube.' }, system: 'stale browser instructions', model: 'not-allowed', max_tokens: 20000 });
    assert.equal(founder.headers['X-HOWL-Scriptwriting-Version'], SCRIPTWRITING_VERSION);
    assert.equal(founder.body.content[0].text, providerResult);
    assert.equal(calls.at(-1).model, 'claude-sonnet-4-6');
    assert.equal(calls.at(-1).max_tokens, 8192);
    assert.ok(!calls.at(-1).system.includes('stale browser instructions'));
    assert.match(calls.at(-1).messages[0].content, /PRODUCT: R3/);

    providerResult = [{ concept_name: 'Packing test', product: 'r1', script: 'A portable warm-season campfire.' }];
    await call(generate, { task: 'winner_concepts', system: 'Return ONLY a JSON array with concept_name and script.', messages: [{ role: 'user', content: 'Preserve the supplied control.' }] });
    assert.match(calls.at(-1).system, /Return ONLY a JSON array/);

    const concept = { title: 'Camp warmth', concept_name: 'Camp warmth', product: 'R3', objective: 'New buyers', angle: 'Warmth at camp', format: 'demonstration', creator_fit: 'Camping demonstrations', hypothesis: 'Test a radiant explanation', opening_visual: 'Camper by a flame', hook: 'Still cold beside the flame?', hooks: ['Still cold?', 'Where is the warmth?', 'What about the coals?'], body_beats: ['Recognition', 'Introduce R3', 'Explain tube', 'Show packing'], brief: 'Show a real R3 outside.', script: 'The R3 pairs a flame with radiant warmth. See the R3.', shot_list: ['0-3s: camper. Text: Still cold?', '3-10s: R3 tube close-up.'], cta: 'See the R3', ctas: ['See the R3', 'Compare the lineup'], deliverables: ['One video'], guardrails: [] };
    providerResult = concept;
    const brief = await call(workflow, { action: 'generate_brief', creator_id: creator.id, product: 'R3' }, 201);
    assert.equal(brief.body.brief.script, concept.script);
    assert.match(calls.at(-1).messages[0].content, /onramp choice/);
    providerResult = [concept];
    const concepts = await call(workflow, { action: 'generate_concepts', creator_id: creator.id, count: 1, product_context: { title: 'R3', description: 'Selected Shopify fixture' } }, 201);
    assert.equal(concepts.body.concepts.length, 1);
    assert.equal(concepts.body.briefs[0].script, concept.script);
    assert.match(calls.at(-1).messages[0].content, /Selected Shopify fixture/);

    providerResult = { strategy_summary: 'Two original demonstrations', allocation_logic: 'New creator', assignments: [1, 2].map(n => ({ ...concept, creator_id: creator.id, concept_name: `Demonstration ${n}`, full_script: concept.script.repeat(3), creator_match: 'Camping niche', performance_logic: 'No prior account results; test hypothesis only.', format: n === 1 ? 'demonstration' : 'founder story' })) };
    await call(planner, { action: 'generate', asset_count: 2, proven_percent: 0, product_context: { title: 'R3' } }, 201);
    assert.equal(calls.length, 5);
    for (const payload of calls) {
      assert.match(payload.system, /PROBLEM MECHANISM AND SOLUTION MECHANISM/);
      assert.match(payload.system, /ONRAMP AND INTRODUCTION/);
      assert.match(payload.system, /nine topics are a menu/);
      assert.match(payload.system, /NO BarCoal/);
      assert.match(payload.system, /SINGLE control/);
      assert.match(payload.system, /INDEPENDENT heat\/flame controls/);
      assert.match(payload.system, /preserve narrator/);
    }
    providerResult = 'Existing non-script response';
    await call(generate, { system: 'Overlay task', messages: [{ role: 'user', content: 'One overlay' }] });
    assert.equal(calls.at(-1).system, 'Overlay task', 'non-script callers retain their contract');
    const count = calls.length;
    await call(generate, { task: 'founder_script', brief: { product: 'unknown' } }, 400);
    assert.equal(calls.length, count, 'invalid briefs never reach the paid provider');
  } finally {
    globalThis.fetch = previousFetch; restore();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); await db.close();
  }
});

test('founder variants support all models and keep the four-section spoken output', () => {
  for (const product of ['r1', 'r3', 'r4mkii', 'both', 'all']) {
    const request = buildFounderScriptRequest({ scriptType: 'customer_result', product, length: '60', tone: 'storyteller' });
    assert.match(request.system, /HOOK, STORY, PROOF, CTA/);
    assert.match(request.messages[0].content, /without pretending someone experienced a result/);
    assert.match(request.messages[0].content, /132 spoken words/);
  }
  assert.throws(() => buildFounderScriptRequest({ scriptType: 'tech', product: 'r1', length: '60', tone: 'direct', customContext: 'x'.repeat(6001) }), /6,000/);
});
