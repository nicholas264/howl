import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLifecycleEvidence, cohortContribution, planFundedCreative} from '../src/lib/creative-lifecycle.js';
import {validateDemandAssumptions} from '../src/lib/creative-demand.js';
const DAY = 86400000;
const add = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const fixture = () => ({asOf: '2026-04-07', dailyHistoryStart: '2026-01-01', targets: [{month: '2026-05', dtcRevenue: 100000}],
  groups: ['a', 'b', 'c', 'unknown', 'old'].map(key => ({key, name: key, mapped: key !== 'unknown', firstDate: key === 'old' ? null : '2026-01-01', adIds: [key]})),
  daily: [{key: 'a', date: '2026-01-01', spend: 600, revenue: 3600, purchases: 2}, {key: 'a', date: '2026-01-01', spend: 600, revenue: 3600, purchases: 2},
    {key: 'a', date: '2026-01-31', spend: 2000, revenue: 12000, purchases: 4}, {key: 'a', date: '2026-03-02', spend: 500, revenue: 3000, purchases: 1},
    {key: 'b', date: '2026-01-01', spend: 100, revenue: 100, purchases: 1}, {key: 'c', date: '2026-01-01', spend: 1200, revenue: 7200, purchases: 4},
    {key: 'unknown', date: '2026-01-01', spend: 99000, revenue: 900000, purchases: 90}, {key: 'old', date: '2026-01-01', spend: 99000, revenue: 900000, purchases: 90}]});

test('90-day lifecycle uses exact age boundaries, duplicate sums, zeros, mapped launches and attribution maturity', () => {
  const input = fixture(), e = buildLifecycleEvidence(input);
  assert.equal(e.complete90, 3);
  assert.equal(e.firstWinners90, 2);
  assert.deepEqual(e.curves.map(c => c.sample), [3, 3, 3]);
  assert.equal(e.curves[1].winnerRetention, .5);
  assert.equal(e.curves[2].winnerRetention, 0);
  assert.equal(e.lifecycleAssets.find(a => a.key === 'a').spend90, 3700);
  assert.equal(e.curves[0].totalPerLaunch, 2500 / 3);
  input.asOf = '2026-04-06';
  assert.equal(buildLifecycleEvidence(input).complete90, 0);
});

test('late cumulative qualifiers are reported but do not become first-month cohort winners', () => {
  const input = fixture();
  input.daily.push({key: 'b', date: '2026-02-15', spend: 1000, revenue: 9000, purchases: 4});
  const e = buildLifecycleEvidence(input);
  assert.equal(e.lateQualifiers, 1);
  assert.equal(e.firstWinners90, 2);
  assert.equal(e.curves[1].qualifiedPerLaunch, 2000 / 3);
});

test('calendar projection prorates launches, includes later blocks, and ends at day 90', () => {
  const curves = [0, 1, 2].map(block => ({fromDay: block * 30 + 1, throughDay: block * 30 + 30, totalPerLaunch: 300, qualifiedPerLaunch: 180, unsuccessfulPerLaunch: 120}));
  assert.deepEqual(cohortContribution(curves, '2026-01-31', '2026-01'), {gross: 10, qualified: 6, unsuccessful: 4});
  assert.equal(cohortContribution(curves, '2026-01-31', '2026-02').gross, 280);
  assert.equal(cohortContribution(curves, '2026-01-31', '2026-04').gross, 300);
  assert.equal(cohortContribution(curves, '2026-01-31', '2026-05').gross, 0);
});

function usableModel() {
  return {curves: [0, 1, 2].map(block => ({fromDay: block * 30 + 1, throughDay: block * 30 + 30, sample: 100, winners: 20,
    totalPerLaunch: 1000, qualifiedPerLaunch: 500, unsuccessfulPerLaunch: 500})),
    forecasts: ['2026-10', '2026-11', '2026-12'].map(month => ({month, gross: 1000, qualified: 800, validated: true})),
    cohortBacktests: [{}, {}, {}], cohortError: .1};
}
const planInput = () => ({asOf: '2026-09-25', targets: ['2026-10', '2026-11', '2026-12'].map(month => ({month, dtcRevenue: 1000000}))});
const assumptions = {otherSpend: 0, newCustomerShare: 100, testBudgetPct: 20, productionLeadDays: 21};

test('funded plan respects gross and failure budgets, commits full tests, carries cohorts and exposes tail', () => {
  const p = planFundedCreative(planInput(), usableModel(), assumptions, 4, '2026-09-26');
  assert.equal(p.earliestLaunch, '2026-10-17');
  assert.ok(p.rows[1].priorCohortQualified > 0);
  assert.ok(p.rows[2].priorCohortQualified > 0);
  for (const r of p.rows) {
    assert.ok(r.projectedGross <= r.metaBudget + 1e-6);
    assert.ok(r.cohortUnsuccessful <= r.reserve + 1e-6);
    assert.ok(r.launchReserveCommitment <= r.reserve + 1e-6);
    assert.ok(r.launchGrossCommitment + r.existingGross <= r.metaBudget + 1e-6);
    assert.ok(r.batches.every(b => b.briefBy >= p.planningDate && b.launchDate >= p.earliestLaunch));
  }
  assert.ok(p.tail.length > 0);
  assert.equal(p.batches[0].reviewBy, add(p.batches[0].launchDate, 36));
});

test('weekly capacity spans month boundaries and later budget reductions constrain earlier launches', () => {
  const input = planInput(), model = usableModel();
  const p = planFundedCreative(input, model, {...assumptions, weeklyCapacity: 2}, 4, '2026-09-26');
  assert.ok(p.batches.every(b => b.assets <= 2));
  for (let i = 1; i < p.batches.length; i++) assert.equal((Date.parse(p.batches[i].launchDate) - Date.parse(p.batches[i - 1].launchDate)) / DAY, 7);
  const full = planFundedCreative(input, model, assumptions, 4, '2026-09-26');
  input.targets[2].dtcRevenue = 4000;
  const tight = planFundedCreative(input, model, assumptions, 4, '2026-09-26');
  assert.ok(tight.rows[0].launches < full.rows[0].launches);
  assert.ok(tight.rows[2].projectedGross <= tight.rows[2].metaBudget + 1e-6);
});

test('missing evidence does not become funded quotas; no launch slots after production lead time', () => {
  const model = usableModel(); model.forecasts[0].gross = null;
  const p = planFundedCreative(planInput(), model, assumptions, 4, '2026-09-26');
  assert.equal(p.ready, false); assert.equal(p.totalLaunches, 0); assert.equal(p.rows[0].projectedGross, null);
  const late = planFundedCreative(planInput(), usableModel(), {...assumptions, productionLeadDays: 180}, 4, '2026-09-26');
  assert.equal(late.batches.length, 0); assert.equal(late.totalLaunches, 0);
  assert.throws(() => planFundedCreative(planInput(), model, assumptions, 0));
  assert.throws(() => planFundedCreative(planInput(), model, assumptions, 4, '2026-09-01'));
  assert.throws(() => validateDemandAssumptions({weeklyCapacity: -1}));
  assert.throws(() => validateDemandAssumptions({weeklyCapacity: 2.5}));
  assert.throws(() => validateDemandAssumptions({productionLeadDays: 2.5}));
});

function longHistory() {
  const input = {asOf: '2026-09-25', dailyHistoryStart: '2025-01-01', groups: [], daily: [], targets: [{month: '2026-10', dtcRevenue: 1000000}]};
  for (let m = 0; m < 18; m++) {
    const launch = new Date(Date.UTC(2025, m, 1)).toISOString().slice(0, 10);
    for (let i = 0; i < 20; i++) {
      const key = `${m}-${i}`;
      input.groups.push({key, name: key, mapped: true, firstDate: launch, adIds: [key]});
      for (let block = 0; block < 4; block++) input.daily.push({key, date: add(launch, block * 30), spend: 1500, revenue: i < 4 ? 9000 : 3000, purchases: 4});
    }
  }
  return input;
}

test('library and 90-day holdouts cannot learn from later outcomes', () => {
  const input = longHistory(), initial = buildLifecycleEvidence(input);
  assert.ok(initial.backtests.length > 3); assert.ok(initial.cohortBacktests.length > 3);
  for (const r of input.daily) if (r.date >= '2026-06-01') {r.spend *= 100; r.revenue *= 100;}
  input.daily.push({key: '0-0', date: '2026-10-01', spend: 1e9, revenue: 1e10, purchases: 10000});
  const changed = buildLifecycleEvidence(input);
  const before = initial.backtests.filter(b => b.targetMonth < '2026-06');
  assert.deepEqual(changed.backtests.filter(b => b.targetMonth < '2026-06'), before);
  assert.deepEqual(changed.cohortBacktests.filter(b => b.month < '2026-03'), initial.cohortBacktests.filter(b => b.month < '2026-03'));
  const noFuture = structuredClone(input); noFuture.daily.pop();
  assert.deepEqual(buildLifecycleEvidence(noFuture), changed);
});
