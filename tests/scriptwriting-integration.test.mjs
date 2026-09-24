import { ensureRateLimits } from '../api/_lib/rate-limit.js';
import { ensureWorkControls } from '../api/_lib/work-controls.js';
import { ensureOperationBudgets } from '../api/_lib/operation-budget.js';
import { ensureCreatorOpsTables } from '../api/_lib/creator-ops.js';
import { ensureAnalysisSchema } from '../api/_lib/analysis-schema.js';
import { studioRequest, validateStudioBrief, parseStudioOutput, BREAKDOWN_LABELS } from '../api/_lib/script-studio.js';
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
  let providerResult, editorialResult;
  let stopReason='end_turn', providerStatus=200;
  try {
    Object.assign(process.env, { NODE_ENV: 'development', AUTH_DISABLED: 'true', DATABASE_URL: 'postgresql://fixture:fixture@fixture.test/db', ANTHROPIC_API_KEY: 'fixture-key' });
    await initializeSchema(sql);
    await ensureRateLimits(sql); await ensureWorkControls(sql); await ensureOperationBudgets(sql); await ensureCreatorOpsTables(sql); await ensureAnalysisSchema(sql);
    const [creator] = await sql`INSERT INTO creators(name,status,niche) VALUES ('Script fixture','qualified','weekend camping') RETURNING id`;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages', 'no unrelated provider calls');
      calls.push(JSON.parse(init.body));
      const responseValue=calls.at(-1).system.includes('EDITORIAL PASS') && editorialResult ? editorialResult : providerResult;
      return Response.json({stop_reason:stopReason, content: [...(calls.at(-1).model==='claude-opus-5-5'?[{type:'thinking',thinking:'',signature:'fixture'}]:[]), { type: 'text', text: typeof responseValue === 'string' ? responseValue : JSON.stringify(responseValue) }] }, {status:providerStatus});
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
    assert.equal(founder.body.content.find(b=>b.type==='text').text, providerResult);
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
    const studioOutput = { title: 'Warmth where you sit', angle: 'Radiant warmth at camp', strategy: 'Recognize the cold before explaining the tube.', script: 'Still cold beside the flame? The R3 adds radiant warmth from a BarCoal tube. See the R3.', cta: 'See the R3', hooks: [1,2,3].map(n => ({ spoken: `Opening ${n}`, next_line: 'Meet the R3.', visual: 'Camper outside', on_screen: 'Radiant warmth' })), shot_list: [1,2,3,4].map(n => ({ time: `${n * 5}s`, visual: 'Show the R3 outside', on_screen: 'Camp warmth' })), guardrails: ['Film outside with proper clearances.'] };
    studioOutput.breakdown = Object.fromEntries(Object.keys(BREAKDOWN_LABELS).map(key => [key, { used: key === 'hook', quote: key === 'hook' ? 'Still cold beside the flame?' : '', purpose: key === 'hook' ? 'Recognize the camper’s problem.' : 'Not needed in this short fixture.' }]));
    for (const delivery of ['founder', 'creator', 'voiceover']) {
      providerResult = studioOutput;
      const studio = await call(generate, { task: 'script_studio', brief: { product: 'r3', delivery, startingPoint: 'fresh', duration: 30, creatorId: creator.id }, max_tokens: 1, model: 'claude-haiku-4-5-20251001', temperature: 0.4 });
      assert.equal(studio.body.script.script, studioOutput.script);
      assert.equal(calls.at(-1).model, 'claude-opus-5-5', 'studio cannot downgrade through browser input');
      assert.equal(calls.at(-1).max_tokens, 16000);
      assert.equal(calls.at(-1).output_config.effort, 'high');
      assert.ok(!('temperature' in calls.at(-1)), 'Opus 5.5 rejects custom sampling');
      assert.equal(calls.at(-1).output_config.format.type, 'json_schema');
      assert.deepEqual(calls.at(-1).output_config.format.schema.properties.hooks.required, ['first', 'second', 'third']);
      assert.match(calls.at(-1).system, /EDITORIAL PASS/);
      const editInput=JSON.parse(calls.at(-1).messages[0].content);
      assert.equal(editInput.draft.script,studioOutput.script);
      const context = JSON.parse(editInput.brief);
      assert.equal(context.delivery, delivery);
      assert.equal(context.creator?.name || null, delivery === 'creator' ? 'Script fixture' : null);
      assert.match(calls.at(-1).system, /ONRAMP AND INTRODUCTION/);
    }
    editorialResult={...studioOutput, script:studioOutput.script.replace('Still cold beside the flame?','Cold at camp?'), breakdown:{...studioOutput.breakdown,hook:{used:true,quote:'Cold at camp?',purpose:'A revised opening.'}}};
    const editedStudio=await call(generate,{task:'script_studio',brief:{product:'r3',delivery:'voiceover',startingPoint:'fresh',duration:30}});
    assert.equal(editedStudio.body.script.script,editorialResult.script,'return the editorial rewrite rather than the first draft');
    assert.equal(editedStudio.body.script.breakdown_script,editorialResult.script);
    editorialResult=null;
    const savedStudio = await call(workflow, { action: 'save_studio_script', creator_id: creator.id, product: 'r3', script: studioOutput }, 201);
    assert.equal(savedStudio.body.brief.script, studioOutput.script);
    assert.equal(savedStudio.body.brief.generation_source, 'script_studio');
    assert.match(savedStudio.body.brief.brief, /Visual: Camper outside/);
    const cards = await sql`SELECT id FROM flow_cards WHERE creator_id = ${creator.id} AND title = ${studioOutput.title}`;
    assert.ok(cards.length, 'saved studio script appears on the Creative Board');
    await call(workflow, { action: 'save_studio_script', creator_id: creator.id, product: 'r3', script: {} }, 400);
    providerResult = { ...studioOutput, hooks: { first: studioOutput.hooks[0], second: studioOutput.hooks[1], third: studioOutput.hooks[2] } };
    const normalized = await call(generate, { task: 'script_studio', brief: { product: 'r3', delivery: 'voiceover', startingPoint: 'fresh', duration: 30 } });
    assert.equal(normalized.body.script.hooks.length, 3);
    await sql`INSERT INTO brand_guidelines(prohibited_phrases) VALUES (ARRAY['Still cold'])`;
    await call(generate, { task: 'script_studio', brief: { product: 'r3', delivery: 'voiceover', startingPoint: 'fresh', duration: 30 } }, 422);
    await sql`DELETE FROM brand_guidelines`;
    providerResult = studioOutput.breakdown;
    const labeled = await call(generate, { task: 'script_studio_breakdown', script: studioOutput.script });
    assert.equal(labeled.body.breakdown_script, studioOutput.script);
    assert.deepEqual(Object.keys(calls.at(-1).output_config.format).sort(), ['schema','type']);
    assert.equal(calls.at(-1).output_config.effort, 'high');
    assert.equal(calls.at(-1).model, 'claude-opus-5-5');
    providerResult = {...studioOutput.breakdown, hook:{used:true,quote:'Invented words',purpose:'Invalid quote'}};
    await call(generate, {task:'script_studio_breakdown',script:studioOutput.script}, 502);
    providerResult = studioOutput; stopReason='max_tokens';
    await call(generate, {task:'script_studio',brief:{product:'r3',delivery:'voiceover',startingPoint:'fresh',duration:30}}, 502);
    stopReason='end_turn'; providerStatus=503;
    const beforeUnavailable=calls.length;
    await call(generate, {task:'script_studio',brief:{product:'r3',delivery:'voiceover',startingPoint:'fresh',duration:30}}, 503);
    assert.equal(calls.length,beforeUnavailable+1,'provider failure must not silently fall back to a cheaper model');
    providerStatus=200;
    providerResult = 'truncated invalid json';
    await call(generate, { task: 'script_studio', brief: { product: 'r1', delivery: 'founder', startingPoint: 'fresh', duration: 30 } }, 502);
    const beforeInvalid = calls.length;
    await call(generate, { task: 'script_studio', brief: { product: 'r3', delivery: 'creator', creatorId: 999999, startingPoint: 'fresh', duration: 30 } }, 400);
    assert.equal(calls.length, beforeInvalid, 'missing creator never reaches provider');
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


test('studio routes every product and starting point through the shared method with validated briefs', () => {
  for (const product of ['r1', 'r3', 'r4mkii', 'all']) for (const startingPoint of ['fresh', 'winner', 'brief']) {
    const request = studioRequest({ product, startingPoint, delivery: 'voiceover', duration: 60, notes: 'Real campaign brief', references: 'Observed ad and results' });
    assert.match(request.system, /132 words/);
    assert.equal(JSON.parse(request.messages[0].content).references, startingPoint === 'winner' ? 'Observed ad and results' : '');
  }
  const base = { product: 'r1', startingPoint: 'fresh', delivery: 'founder', duration: 30 };
  for (const patch of [{ product: 'bad' }, { startingPoint: 'brief' }, { startingPoint: 'winner' }, { delivery: 'creator' }, { duration: 42 }, { notes: 'x'.repeat(6001) }, { references: 'x'.repeat(40001) }]) assert.throws(() => validateStudioBrief({ ...base, ...patch }));
  assert.throws(() => parseStudioOutput('{}'));
});
