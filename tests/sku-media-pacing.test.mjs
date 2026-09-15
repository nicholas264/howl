import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSku, allocateCoreMedia, coreCostCap, sumRows } from '../src/lib/sku-media-pacing.js';

const pacing = { daysInMonth: 30, elapsedDays: 15, remainingDays: 15 };
const assumptions = { price: 1000, discountPct: 0, cogsPct: 40, variablePct: 5, fulfillment: 10, returnRate: 0, targetCmPct: 35, unitMultiplier: 100, unitOverride: '', spendToDate: '', returningRevenuePct: 20 };
const model = (sku, units, overrides = {}, spend = 0, ordered = 0) => modelSku({ sku, units: [units] }, { ...assumptions, ...overrides }, 0, 0, 0, pacing, spend, { units: ordered });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('accessories support core acquisition budgets without their own paid targets', () => {
  const raw = [model('R1 Campfire', 100, {}, 10000, 40), model('R1 HaulBag', 50, { price: 100 }, 25, 15)];
  const [core, bag] = allocateCoreMedia(raw, pacing);
  near(core.mediaBudget, 19500);
  near(bag.mediaBudget, 0);
  near(core.costCap, 243.75); // $19,500 / 80 new core units
  near(coreCostCap([core, bag]), 243.75);
  near(core.paceTargetToDate, 9750);
  near(core.paceDelta, 250);
  near(core.requiredDaily, 9500 / 15);
  near(core.projectedUnits, 80);
  near(bag.unitPaceDelta, -10); // Unit status still applies to accessories.
  near(sumRows([core, bag]).mediaBudget, sumRows(raw).mediaBudget);
  near(sumRows([core, bag]).postMediaContribution, sumRows(raw).postMediaContribution);
  near(sumRows([core, bag]).spendToDate, 10025); // Never discard actual spend.
});

test('mix is limited to R1/R3/R4 and totals 100 percent despite accessory orders', () => {
  const rows = allocateCoreMedia([model('R1 Campfire', 100, {}, 0, 10), model('R3 Campfire', 100, {}, 0, 20), model('R4 Campfire', 100, {}, 0, 30), model('R1 HaulBag', 100, {}, 0, 75)], pacing);
  near(rows.slice(0, 3).reduce((sum, row) => sum + row.productMix, 0), 1);
  assert.equal(rows[3].productMix, null);
  near(rows[0].productMix, 1 / 6);
});

test('unloaded actuals are distinguished from a successful zero result', () => {
  const item = { sku: 'R1 Campfire', units: [100] };
  const missing = modelSku(item, assumptions, 0, 0, 0, pacing);
  assert.equal(missing.hasSpendData, false);
  assert.equal(missing.hasUnitData, false);
  const zero = model('R1 Campfire', 100);
  assert.equal(zero.hasSpendData, true);
  assert.equal(zero.hasUnitData, true);
  assert.equal(allocateCoreMedia([zero], pacing)[0].productMix, null);
  const manual = modelSku(item, { ...assumptions, spendToDate: '0' }, 0, 0, 0, pacing);
  assert.equal(manual.hasSpendData, true);
  assert.equal(manual.hasUnitData, false);
});

test('no core plan produces no invented Cost Cap or paid budget', () => {
  const rows = allocateCoreMedia([model('R1 Campfire', 0), model('R1 HaulBag', 50, { price: 100 })], pacing);
  assert.equal(coreCostCap(rows), 0);
  assert.equal(sumRows(rows).mediaBudget, 0);
  assert.ok(rows.every(row => Number.isFinite(row.requiredDaily)));
});
