import {quantile, validateDemandAssumptions} from './creative-demand.js';

const DAY = 86400000;
const toDay = date => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY;
const iso = day => new Date(day * DAY).toISOString().slice(0, 10);
const addMonth = (month, n) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const monthStart = month => toDay(`${month}-01`);
const monthEnd = month => monthStart(addMonth(month, 1)) - 1;
const total = (rows, field) => rows.reduce((sum, row) => sum + (row[field] || 0), 0);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const qualifies = (row, a) => row.spend >= a.minWinnerSpend && row.purchases >= a.minPurchases && row.revenue / row.spend >= a.roasFloor;
const empty = () => ({spend: 0, revenue: 0, purchases: 0});

// Prefix sums make repeated point-in-time evaluations cheap; no future rows are read.
function makeSeries(input) {
  const rows = new Map();
  for (const r of input.daily || []) {
    const date = toDay(r.date);
    if (date > toDay(input.asOf)) continue;
    if (!rows.has(r.key)) rows.set(r.key, new Map());
    const byDate = rows.get(r.key), entry = byDate.get(date) || empty();
    for (const field of ['spend', 'revenue', 'purchases']) entry[field] += Number(r[field] || 0);
    byDate.set(date, entry);
  }
  return (input.groups || []).filter(g => g.mapped).map(g => {
    const dates = [...(rows.get(g.key)?.keys() || [])].sort((a, b) => a - b);
    const sums = [empty()];
    dates.forEach(date => {
      const prev = sums.at(-1), next = rows.get(g.key).get(date);
      sums.push({spend: prev.spend + next.spend, revenue: prev.revenue + next.revenue, purchases: prev.purchases + next.purchases});
    });
    const upper = date => {let l = 0, r = dates.length; while (l < r) {const mid = (l + r) >>> 1; if (dates[mid] <= date) l = mid + 1; else r = mid;} return l;};
    const window = (from, through) => {
      const left = sums[upper(from - 1)], right = sums[upper(through)];
      return {spend: right.spend - left.spend, revenue: right.revenue - left.revenue, purchases: right.purchases - left.purchases};
    };
    return {...g, first: g.firstDate ? toDay(g.firstDate) : null, dates, window};
  });
}

function cohortCurves(series, knownThrough, historyStart, assumptions) {
  return [0, 1, 2].map(block => {
    // All included launches have this entire age window observed. Zeros stay in the mean.
    const eligible = series.filter(s => s.first != null && s.first >= historyStart && s.first + block * 30 + 29 <= knownThrough);
    const rows = eligible.map(s => {
      const first = s.window(s.first, s.first + 29), window = s.window(s.first + block * 30, s.first + block * 30 + 29);
      const winner = qualifies(first, assumptions), activeWinner = winner && qualifies(window, assumptions);
      return {winner, activeWinner, spend: window.spend, qualified: activeWinner ? window.spend : 0,
        unsuccessful: winner ? 0 : window.spend};
    });
    const winners = rows.filter(r => r.winner);
    return {block, fromDay: block * 30 + 1, throughDay: block * 30 + 30, sample: rows.length, winners: winners.length,
      totalPerLaunch: mean(rows.map(r => r.spend)), qualifiedPerLaunch: mean(rows.map(r => r.qualified)),
      unsuccessfulPerLaunch: mean(rows.map(r => r.unsuccessful)),
      winnerMean: mean(winners.map(r => r.spend)), winnerMedian: quantile(winners.map(r => r.spend), .5),
      winnerRetention: winners.length ? winners.filter(r => r.activeWinner).length / winners.length : null};
  });
}

function currentLibrary(series, end, assumptions) {
  return series.flatMap(s => {
    const row = s.window(end - 29, end);
    return qualifies(row, assumptions) ? [{key: s.key, name: s.name, firstDate: s.firstDate, ...row, roas: row.revenue / row.spend}] : [];
  });
}

function libraryObservations(series, input, assumptions, gapDays, maxHorizon = 3) {
  const result = [];
  for (let month = input.dailyHistoryStart.slice(0, 7); monthStart(month) <= toDay(input.asOf); month = addMonth(month, 1)) {
    const baselineEnd = monthStart(month) - gapDays;
    if (baselineEnd - 29 < toDay(input.dailyHistoryStart)) continue;
    const library = currentLibrary(series, baselineEnd, assumptions);
    if (!library.length) continue;
    const keys = new Set(library.map(r => r.key)), members = series.filter(s => keys.has(s.key));
    for (let horizon = 1; horizon <= maxHorizon; horizon++) {
      const targetMonth = addMonth(month, horizon - 1), end = monthEnd(targetMonth);
      if (end + 7 > toDay(input.asOf)) continue;
      const future = members.map(s => s.window(monthStart(targetMonth), end));
      result.push({month, targetMonth, horizon, decisionDay: baselineEnd + 7, availableDay: end + 7,
        librarySize: library.length, baseline: total(library, 'spend'), gross: total(future, 'spend'),
        qualified: total(future.filter(r => qualifies(r, assumptions)), 'spend')});
    }
  }
  return result;
}

function fitLibrary(observations, horizon, decisionDay) {
  const sample = observations.filter(o => o.horizon === horizon && o.availableDay <= decisionDay);
  const base = total(sample, 'baseline');
  return {windows: sample.length, assetObservations: total(sample, 'librarySize'),
    grossRatio: base > 0 ? total(sample, 'gross') / base : null,
    qualifiedRatio: base > 0 ? total(sample, 'qualified') / base : null};
}

function errorRate(rows, estimate, actual) {
  const denominator = total(rows, actual);
  return denominator > 0 ? rows.reduce((sum, r) => sum + Math.abs(r[estimate] - r[actual]), 0) / denominator : null;
}

export function buildLifecycleEvidence(input, supplied = {}) {
  const assumptions = validateDemandAssumptions(supplied), series = makeSeries(input);
  const cutoff = toDay(input.asOf), knownThrough = cutoff - 7, historyStart = toDay(input.dailyHistoryStart);
  const curves = cohortCurves(series, knownThrough, historyStart, assumptions);
  const complete90 = series.filter(s => s.first != null && s.first >= historyStart && s.first + 89 <= knownThrough);
  const lifecycleAssets = complete90.map(s => {
    let winDay = null;
    for (let age = 0; age < 90; age++) {
      if (qualifies(s.window(s.first, s.first + age), assumptions)) {winDay = age + 1; break;}
    }
    const windows = [0, 1, 2].map(block => s.window(s.first + block * 30, s.first + block * 30 + 29));
    return {key: s.key, name: s.name, firstDate: s.firstDate, winDay, firstWinner: qualifies(windows[0], assumptions),
      spend30: windows[0].spend, spend60: windows[0].spend + windows[1].spend, spend90: total(windows, 'spend'),
      qualifiedBlocks: windows.map(w => qualifies(w, assumptions))};
  });
  const firstWinners = lifecycleAssets.filter(s => s.firstWinner);
  const library = currentLibrary(series, knownThrough, assumptions), baseline = total(library, 'spend');
  const firstTarget = (input.targets || []).filter(t => monthStart(t.month) > cutoff).sort((a, b) => a.month.localeCompare(b.month))[0]?.month || addMonth(input.asOf.slice(0, 7), 1);
  const gapDays = monthStart(firstTarget) - knownThrough;
  const observations = libraryObservations(series, input, assumptions, gapDays);
  const backtests = observations.flatMap(o => {
    const fit = fitLibrary(observations, o.horizon, o.decisionDay);
    if (fit.windows < 3 || fit.assetObservations < 10) return [];
    return [{...o, trainingWindows: fit.windows, predictedGross: o.baseline * fit.grossRatio,
      predictedQualified: o.baseline * fit.qualifiedRatio, persistence: o.baseline}];
  });
  const forecasts = [1, 2, 3].map(horizon => {
    const fit = fitLibrary(observations, horizon, cutoff), checks = backtests.filter(b => b.horizon === horizon);
    const grossError = errorRate(checks, 'predictedGross', 'gross'), qualifiedError = errorRate(checks, 'predictedQualified', 'qualified');
    const sufficient = fit.windows >= 3 && fit.assetObservations >= 10;
    return {...fit, horizon, month: addMonth(firstTarget, horizon - 1), baseline,
      gross: sufficient ? baseline * fit.grossRatio : null, qualified: sufficient ? baseline * fit.qualifiedRatio : null,
      holdouts: checks.length, grossError, qualifiedError, persistenceError: errorRate(checks, 'persistence', 'qualified'),
      validated: sufficient && checks.length >= 3 && grossError != null && grossError <= .5 && qualifiedError != null && qualifiedError <= .5};
  });
  // Monthly launch-cohort holdouts use only age windows that were mature at the decision date.
  const cohortBacktests = [];
  for (let month = input.dailyHistoryStart.slice(0, 7); monthEnd(month) + 89 + 7 <= cutoff; month = addMonth(month, 1)) {
    const launchers = series.filter(s => s.first != null && iso(s.first).startsWith(month));
    const training = cohortCurves(series, monthStart(month) - 8, historyStart, assumptions);
    if (!launchers.length || training.some(c => c.sample < 20 || c.winners < 3)) continue;
    const actual = launchers.reduce((sum, s) => {
      if (!qualifies(s.window(s.first, s.first + 29), assumptions)) return sum;
      return sum + [0, 1, 2].reduce((n, block) => {const w = s.window(s.first + block * 30, s.first + block * 30 + 29); return n + (qualifies(w, assumptions) ? w.spend : 0);}, 0);
    }, 0);
    cohortBacktests.push({month, launches: launchers.length, trainingAssets: training[2].sample,
      predicted: launchers.length * total(training, 'qualifiedPerLaunch'), actual});
  }
  return {asOf: input.asOf, knownThrough: iso(knownThrough), baselineStart: iso(knownThrough - 29), gapDays,
    curves, lifecycleAssets, complete90: complete90.length, firstWinners90: firstWinners.length,
    medianWinDay: quantile(firstWinners.map(s => s.winDay).filter(Number.isFinite), .5),
    lateQualifiers: lifecycleAssets.filter(s => s.winDay > 30).length,
    cumulative: [30, 60, 90].map(days => ({days, sample: firstWinners.length, mean: mean(firstWinners.map(s => s[`spend${days}`])), median: quantile(firstWinners.map(s => s[`spend${days}`]), .5)})),
    library, forecasts, backtests, cohortBacktests, cohortError: errorRate(cohortBacktests, 'predicted', 'actual')};
}

// Calendar-day allocation uses the mean of fully observed 30-day age blocks.
// It deliberately makes no claim about incremental demand or intra-block pacing.
export function cohortContribution(curves, launchDate, month) {
  const start = toDay(launchDate), from = monthStart(month), end = monthEnd(month);
  const result = {gross: 0, qualified: 0, unsuccessful: 0};
  for (const curve of curves) {
    const days = Math.max(0, Math.min(end, start + curve.throughDay - 1) - Math.max(from, start + curve.fromDay - 1) + 1);
    result.gross += (curve.totalPerLaunch || 0) * days / 30;
    result.qualified += (curve.qualifiedPerLaunch || 0) * days / 30;
    result.unsuccessful += (curve.unsuccessfulPerLaunch || 0) * days / 30;
  }
  return result;
}

export function planFundedCreative(input, lifecycle, supplied = {}, amer = 4.55, planningDate = input.asOf) {
  const a = validateDemandAssumptions(supplied);
  if (!Number.isFinite(amer) || amer <= 0) throw new Error('A positive aMER is required.');
  const date = toDay(planningDate);
  if (!Number.isFinite(date) || planningDate < input.asOf) throw new Error('A valid planning date is required.');
  const targets = (input.targets || []).filter(t => monthEnd(t.month) >= date).sort((x, y) => x.month.localeCompare(y.month));
  const rows = targets.map(target => {
    if (!Number.isFinite(target.dtcRevenue) || target.dtcRevenue < 0) throw new Error('Nonnegative DTC revenue is required.');
    const totalBudget = target.dtcRevenue * (1 - a.returnsPct / 100) * a.newCustomerShare / 100 / amer;
    const metaBudget = Math.max(0, totalBudget - a.otherSpend), reserve = metaBudget * a.testBudgetPct / 100;
    const forecast = lifecycle.forecasts.find(f => f.month === target.month);
    // Scenario forecasts are capped to the budget. Scaling down preserves the forecast quality mix.
    const existingGross = forecast?.gross == null ? null : Math.min(metaBudget, forecast.gross);
    const scale = forecast?.gross > 0 ? existingGross / forecast.gross : 0;
    return {month: target.month, dtcRevenue: target.dtcRevenue, totalBudget, metaBudget, reserve,
      existingGross, existingQualified: existingGross == null ? null : forecast.qualified * scale,
      forecast, cohortGross: 0, cohortQualified: 0, cohortUnsuccessful: 0, launches: 0, launchReserveCommitment: 0, launchGrossCommitment: 0, batches: []};
  });
  const ready = lifecycle.curves.every(c => c.sample >= 20 && c.winners >= 3) && rows.every(r => r.existingGross != null);
  const batches = [];
  const earliestLaunch = Math.max(date + a.productionLeadDays, rows.length ? monthStart(rows[0].month) : date + a.productionLeadDays);
  const weeklyDates = [];
  if (rows.length) for (let d = earliestLaunch; d <= monthEnd(rows.at(-1).month); d += 7) weeklyDates.push(d);
  // Continuous weekly slots prevent two month-boundary batches from exceeding weekly capacity.
  for (const row of rows) {
    const dates = weeklyDates.filter(d => d >= monthStart(row.month) && d <= monthEnd(row.month));
    const firstSlot = dates.length ? cohortContribution(lifecycle.curves, iso(dates[0]), row.month) : null;
    const startingGap = Math.max(0, row.metaBudget - row.reserve - (row.existingQualified || 0) - row.cohortQualified);
    row.requiredAtFirstSlot = ready && firstSlot?.qualified > 0 ? Math.ceil(startingGap / firstSlot.qualified) : null;
    for (const launch of dates) {
      const launchDate = iso(launch), effects = rows.map(r => cohortContribution(lifecycle.curves, launchDate, r.month));
      const currentIndex = rows.indexOf(row), current = effects[currentIndex];
      const qualifiedGap = Math.max(0, row.metaBudget - row.reserve - (row.existingQualified || 0) - row.cohortQualified);
      const desired = current.qualified > 0 ? Math.ceil(qualifiedGap / current.qualified) : 0;
      let allowed = ready ? desired : 0;
      // Reserve remaining weekly slots rather than spending the whole test budget in week one.
      const remainingSlots = dates.filter(d => d >= launch).length;
      const first30 = lifecycle.curves[0];
      // Fully fund the first 30 days at launch, even when delivery crosses month-end.
      // These are commitments, not additional spend in the calendar projection.
      if (first30.unsuccessfulPerLaunch > 0) allowed = Math.min(allowed, Math.floor(Math.max(0, row.reserve - row.launchReserveCommitment) / first30.unsuccessfulPerLaunch / remainingSlots));
      const fullTestCost = Math.max(a.minTestSpend, first30.totalPerLaunch || 0);
      allowed = Math.min(allowed, Math.floor(Math.max(0, row.metaBudget - (row.existingGross || 0) - row.launchGrossCommitment) / fullTestCost / remainingSlots));
      for (let i = currentIndex; i < rows.length; i++) {
        const r = rows[i], effect = effects[i], spread = i === currentIndex ? remainingSlots : 1;
        const grossRemaining = Math.max(0, r.metaBudget - (r.existingGross || 0) - r.cohortGross);
        const unsuccessfulRemaining = Math.max(0, r.reserve - r.cohortUnsuccessful);
        if (effect.gross > 0) allowed = Math.min(allowed, Math.floor((grossRemaining + 1e-8) / effect.gross / spread));
        if (effect.unsuccessful > 0) allowed = Math.min(allowed, Math.floor((unsuccessfulRemaining + 1e-8) / effect.unsuccessful / spread));
      }
      if (a.weeklyCapacity > 0) allowed = Math.min(allowed, Math.floor(a.weeklyCapacity));
      const assets = Math.max(0, allowed);
      const batch = {launchDate, briefBy: iso(launch - a.productionLeadDays), assets, desired, month: row.month,
        reviewBy: iso(launch + 36), testFunding: assets * lifecycle.curves[0].totalPerLaunch,
        minimumTestFunding: assets * a.minTestSpend};
      row.batches.push(batch); batches.push(batch); row.launches += assets;
      row.launchReserveCommitment += assets * lifecycle.curves[0].unsuccessfulPerLaunch;
      row.launchGrossCommitment += assets * fullTestCost;
      effects.forEach((effect, index) => {
        rows[index].cohortGross += assets * effect.gross;
        rows[index].cohortQualified += assets * effect.qualified;
        rows[index].cohortUnsuccessful += assets * effect.unsuccessful;
      });
    }
  }
  for (const row of rows) {
    row.projectedGross = row.existingGross == null ? null : row.existingGross + row.cohortGross;
    row.projectedQualified = row.existingQualified == null ? null : row.existingQualified + row.cohortQualified;
    row.unallocated = row.projectedGross == null ? null : Math.max(0, row.metaBudget - row.projectedGross);
    row.qualifiedGap = row.projectedQualified == null ? null : Math.max(0, row.metaBudget - row.reserve - row.projectedQualified);
    row.priorCohortQualified = batches.filter(b => b.month < row.month).reduce((sum, b) => sum + b.assets * cohortContribution(lifecycle.curves, b.launchDate, row.month).qualified, 0);
    row.flags = [];
    if (!ready) row.flags.push('Insufficient complete lifecycle or existing-library evidence.');
    if (!row.forecast?.validated) row.flags.push('Existing-library forecast has not passed the historical error threshold.');
    if (lifecycle.cohortBacktests.length < 3 || lifecycle.cohortError == null || lifecycle.cohortError > .5) row.flags.push('New-cohort forecast has not passed the historical error threshold.');
    if (row.totalBudget < a.otherSpend) row.flags.push('Other-channel spend exceeds the allowable budget.');
    if (row.qualifiedGap > 1) row.flags.push('Funded production leaves a qualified-spend gap.');
    if (!row.batches.length) row.flags.push('Production lead time leaves no launch date in this month.');
    row.status = row.flags.length ? 'Calibration plan' : 'Provisional estimate';
    row.expectedWinners = row.launches * (lifecycle.curves[0].sample ? lifecycle.curves[0].winners / lifecycle.curves[0].sample : 0);
  }
  const lastMonth = rows.at(-1)?.month;
  const tail = lastMonth ? [1, 2, 3].map(n => {
    const month = addMonth(lastMonth, n);
    return {month, gross: batches.reduce((sum, b) => sum + b.assets * cohortContribution(lifecycle.curves, b.launchDate, month).gross, 0)};
  }).filter(t => t.gross > .01) : [];
  return {amer, planningDate, earliestLaunch: iso(earliestLaunch), ready, rows, batches, tail,
    assumptions: a, totalLaunches: total(rows, 'launches')};
}
