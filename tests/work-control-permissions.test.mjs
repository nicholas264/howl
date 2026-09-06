import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureWorkControls, finishWork, recoverExpiredWork, recordProviderUsage } from '../api/_lib/work-controls.js';
import { ensureOperationBudgets } from '../api/_lib/operation-budget.js';
import { ensureRateLimits } from '../api/_lib/rate-limit.js';
import { reservePaidWork } from '../api/_lib/paid-work.js';

test('paid work enforces limits with a runtime role that cannot create or alter schema', async () => {
  const db = new PGlite();
  const sql = async (parts, ...values) => (await db.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values)).rows;
  const prior = process.env.HOWL_DAILY_ANALYSIS_LIMIT;
  try {
    await ensureWorkControls(sql);
    await ensureOperationBudgets(sql);
    await ensureRateLimits(sql);
    await db.exec(`CREATE ROLE limited_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO limited_worker;
      GRANT SELECT, INSERT, UPDATE ON app_work_lanes, app_work_runs, app_operation_budgets, app_rate_limits TO limited_worker;
      SET ROLE limited_worker;`);
    await assert.rejects(sql`CREATE TABLE forbidden_schema_change(id int)`, {code:'42501'});
    await assert.rejects(sql`ALTER TABLE app_work_runs ADD COLUMN forbidden int`, {code:'42501'});
    process.env.HOWL_DAILY_ANALYSIS_LIMIT = '1';
    const id = await reservePaidWork(sql, 'analysis', 'limited-worker', {hourlyLimit: 2});
    assert.ok(id);
    await recordProviderUsage(sql, id, {provider:'fixture', inputTokens:12, outputTokens:3});
    await finishWork(sql, id, 'analysis', 200);
    await assert.rejects(reservePaidWork(sql, 'analysis', 'limited-worker', {hourlyLimit:2}), /Daily operation limit/);
    await assert.rejects(reservePaidWork(sql, 'analysis', 'limited-worker', {hourlyLimit:2}), /Hourly work limit/);
    await recoverExpiredWork(sql);
    const [run] = await sql`SELECT status,input_tokens,output_tokens FROM app_work_runs WHERE id=${id}`;
    assert.equal(run.status,'completed');
    assert.equal(Number(run.input_tokens),12);
    assert.equal(Number(run.output_tokens),3);
    const [lane] = await sql`SELECT leases FROM app_work_lanes WHERE kind='analysis'`;
    assert.deepEqual(lane.leases,[]);
  } finally {
    if(prior === undefined) delete process.env.HOWL_DAILY_ANALYSIS_LIMIT;
    else process.env.HOWL_DAILY_ANALYSIS_LIMIT = prior;
    await db.close();
  }
});
