import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/DashboardTool.jsx', import.meta.url), 'utf8').split('const allRows = recent24.map')[1];
// Evaluate the actual dashboard expressions with a fixed mid-month fixture.
function calculate(name, values) {
  const expression = source.match(new RegExp(`const ${name} = ([^;]+);`))?.[1];
  assert.ok(expression, `Missing ${name} calculation`);
  return Math.round(Function(...Object.keys(values), `return ${expression}`)(...Object.values(values)) * 100) / 100;
}
test('deferred recognition adds revenue once without additional processing fees', () => {
  for (const deferredRevenue of [0, 12345.67]) {
    const values = { dtcRevenue: 100000, dtcNetRevenue: 90000, dealerRevenue: 20000, offPlatformRevenue: 0, deferredRevenue };
    assert.equal(calculate('revenue', values), 120000 + deferredRevenue);
    const netRevenue = calculate('netRevenue', values);
    assert.equal(netRevenue, 110000 + deferredRevenue);
    assert.equal(calculate('paymentFees', { netRevenue, deferredRevenue, paymentFeePct: 3, orders: 100, paymentFeeFixed: 0.3 }), 3330);
    assert.equal(calculate('projectedCm3', { isCurrent: true, cm3: 50000 + deferredRevenue, deferredRevenue, paceFactor: 2 }), 100000 + deferredRevenue);
    assert.equal(calculate('projRevenue', { isCurrent: true, actRevenue: 120000 + deferredRevenue, deferredRevenue, paceFactor: 2 }), 240000 + deferredRevenue);
    assert.equal(calculate('projCm3', { isCurrent: true, actCm3: 50000 + deferredRevenue, deferredRevenue, paceFactor: 2 }), 100000 + deferredRevenue);
  }
});
