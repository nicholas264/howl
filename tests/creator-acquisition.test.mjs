import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import handler from '../api/creator-acquisition.js';
import { initializeSchema } from '../api/db/schema.js';
import { ensureCreatorOpsTables } from '../api/_lib/creator-ops.js';
import { useTestDatabase } from './neon-test-adapter.mjs';

test('talent decisions work without scores or qualification requirements', async () => {
  const db = new PGlite();
  const sql = async (parts, ...values) => (await db.query(parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values)).rows;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const restoreDatabase = useTestDatabase(db);
  Object.assign(process.env, { NODE_ENV: 'development', AUTH_DISABLED: 'true', DATABASE_URL: 'postgresql://test:test@test.neon.tech/test', RESEND_API_KEY: 'synthetic' });
  let failEmail = false;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    if (failEmail) return Response.json({ message: 'Email unavailable' }, { status: 503 });
    sent.push(JSON.parse(init.body));
    return Response.json({ id: 'test-email' });
  };
  const invoke = async body => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
    await handler({ method: 'PATCH', headers: {}, body }, res);
    return res;
  };
  try {
    await initializeSchema(sql);
    await ensureCreatorOpsTables(sql);
    const [application] = await sql`INSERT INTO creator_applications (application_code, name, email) VALUES ('APP-TEST', 'Unscored applicant', 'applicant@example.test') RETURNING *`;
    const approved = await invoke({ action: 'promote', type: 'application', id: application.id });
    assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
    assert.ok(approved.body.creator.id);
    const [stored] = await sql`SELECT status, promoted_creator_id, review_scorecard FROM creator_applications WHERE id = ${application.id}`;
    assert.equal(stored.status, 'approved');
    assert.equal(String(stored.promoted_creator_id), String(approved.body.creator.id));
    assert.deepEqual(stored.review_scorecard, {});
    const repeated = await invoke({ action: 'promote', type: 'application', id: application.id });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.creator.id, approved.body.creator.id);

    const [candidate] = await sql`INSERT INTO creator_candidates (name, source) VALUES ('Unscored prospect', 'manual') RETURNING *`;
    const promotedCandidate = await invoke({ action: 'promote', type: 'candidate', id: candidate.id });
    assert.equal(promotedCandidate.statusCode, 200, JSON.stringify(promotedCandidate.body));

    const [denied] = await sql`INSERT INTO creator_applications (application_code, name, email) VALUES ('APP-DENY', 'Denial applicant', 'denial@example.test') RETURNING *`;
    const denial = { action: 'deny_application', type: 'application', id: denied.id, send_email: true, denial_subject: 'Thank you for applying', denial_body: 'Thank you for your interest.' };
    failEmail = true;
    const failed = await invoke(denial);
    assert.notEqual(failed.statusCode, 200);
    const [unchanged] = await sql`SELECT status FROM creator_applications WHERE id = ${denied.id}`;
    assert.equal(unchanged.status, 'new');
    failEmail = false;
    const result = await invoke(denial);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.body.record.status, 'denied');
    assert.equal(result.body.record.enrichment.denial.status, 'sent');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['denial@example.test']);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDatabase();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await db.close();
  }
});
