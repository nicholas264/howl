import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import {
  SKU_MEDIA_FORECAST,
  SKU_MEDIA_FORECAST_SOURCE,
  SKU_MEDIA_MONTHS,
} from '../data/skuMediaForecast';

const STORAGE_KEY = 'howl_sku_media_pacing_assumptions_v3';

const DEFAULT_GLOBALS = {
  discountPct: 0,
  cogsPct: 42,
  variablePct: 7,
  fulfillment: 12,
  returnRate: 3,
  targetCmPct: 35,
  unitMultiplier: 100,
  returningRevenuePct: 18,
  returningRevenueOverride: '',
};

const fmtMoney = (value) => (Number(value) || 0).toLocaleString(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const fmtNumber = (value, digits = 0) => (Number(value) || 0).toLocaleString(undefined, {
  maximumFractionDigits: digits,
});
const fmtPct = (value, digits = 1) => `${fmtNumber(value, digits)}%`;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function monthKeyForIndex(index, year = 2026) {
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

function getMonthPacing(index, asOf = new Date(), year = 2026) {
  const daysInMonth = new Date(year, index + 1, 0).getDate();
  const isPast = year < asOf.getFullYear() || (year === asOf.getFullYear() && index < asOf.getMonth());
  const isFuture = year > asOf.getFullYear() || (year === asOf.getFullYear() && index > asOf.getMonth());
  const elapsedDays = isPast ? daysInMonth : isFuture ? 0 : clamp(asOf.getDate(), 1, daysInMonth);
  return {
    daysInMonth,
    elapsedDays,
    remainingDays: Math.max(0, daysInMonth - elapsedDays),
  };
}

function defaultSkuAssumption(item) {
  return {
    price: item.dtcPrice,
    discountPct: DEFAULT_GLOBALS.discountPct,
    cogsPct: DEFAULT_GLOBALS.cogsPct,
    variablePct: DEFAULT_GLOBALS.variablePct,
    fulfillment: DEFAULT_GLOBALS.fulfillment,
    returnRate: DEFAULT_GLOBALS.returnRate,
    targetCmPct: DEFAULT_GLOBALS.targetCmPct,
    unitMultiplier: DEFAULT_GLOBALS.unitMultiplier,
    unitOverride: '',
    spendToDate: '',
    returningRevenuePct: '',
  };
}

function getInitialState() {
  const base = {
    globals: DEFAULT_GLOBALS,
    skus: Object.fromEntries(SKU_MEDIA_FORECAST.map(item => [item.sku, defaultSkuAssumption(item)])),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return base;
    return {
      globals: { ...base.globals, ...(saved.globals || {}) },
      skus: Object.fromEntries(SKU_MEDIA_FORECAST.map(item => [
        item.sku,
        { ...base.skus[item.sku], ...(saved.skus?.[item.sku] || {}) },
      ])),
    };
  } catch {
    return base;
  }
}

function historicalFromRows(rows = []) {
  const months = rows
    .map(row => {
      const source = row.shopify || {};
      const netSales = Number(source.netSales || source.shopifyNetSales || 0);
      const newRevenue = Number(source.newRevenue || 0);
      const returningRevenue = Number(source.returningRevenue || 0);
      const classified = newRevenue + returningRevenue;
      const customers = Number(source.newCustomers || 0) + Number(source.returningCustomers || 0);
      const returningCustomerPct = customers > 0
        ? Number(source.returningCustomers || 0) / customers
        : 0;
      const classifiedCoverage = netSales > 0 ? classified / netSales : 0;
      const rawRevenuePct = classified > 0 ? returningRevenue / classified : 0;
      const returningRevenuePct = classifiedCoverage >= 0.5 && classifiedCoverage <= 1.25
        ? rawRevenuePct
        : returningCustomerPct;
      return {
        month: row.month,
        netSales,
        newRevenue,
        returningRevenue,
        returningRevenuePct: clamp(returningRevenuePct, 0, 0.75),
        returningCustomerPct: clamp(returningCustomerPct, 0, 0.75),
        snapshotAt: source.snapshotAt || row.updated_at || null,
      };
    })
    .filter(row => row.netSales > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
  const recent = months.slice(-6);
  const recentSales = recent.reduce((sum, row) => sum + row.netSales, 0);
  const recentReturning = recent.reduce((sum, row) => sum + row.returningRevenue, 0);
  const recentReturningPct = recentSales > 0 ? recentReturning / recentSales : 0;
  const byCalendarMonth = {};
  for (const row of months) {
    const calendarIndex = Number(row.month.slice(5, 7)) - 1;
    byCalendarMonth[calendarIndex] = row.returningRevenuePct;
  }
  return {
    months,
    recentReturningPct,
    byCalendarMonth,
    latestSnapshotAt: months.reduce((latest, row) => {
      const t = row.snapshotAt ? new Date(row.snapshotAt).getTime() : 0;
      return t > latest ? t : latest;
    }, 0),
  };
}

function modelSku(item, assumption, monthIndex, monthReturningRevenue, monthRevenue, monthPacing) {
  const forecastUnits = Number(item.units[monthIndex]) || 0;
  const override = assumption.unitOverride === '' ? null : Number(assumption.unitOverride);
  const plannedUnits = Math.max(0, override ?? forecastUnits * ((Number(assumption.unitMultiplier) || 0) / 100));
  const soldUnits = plannedUnits * (1 - (Number(assumption.returnRate) || 0) / 100);
  const realizedPrice = Math.max(0, Number(assumption.price) || 0) * (1 - (Number(assumption.discountPct) || 0) / 100);
  const revenue = soldUnits * realizedPrice;
  const returningPctOverride = assumption.returningRevenuePct === '' ? null : clamp(assumption.returningRevenuePct, 0, 75) / 100;
  const revenueShare = monthRevenue > 0 ? revenue / monthRevenue : 0;
  const returningRevenue = Math.min(revenue, returningPctOverride == null
    ? monthReturningRevenue * revenueShare
    : revenue * returningPctOverride);
  const newRevenue = Math.max(0, revenue - returningRevenue);
  const acquiredUnits = realizedPrice > 0 ? newRevenue / realizedPrice : 0;
  const cogs = revenue * ((Number(assumption.cogsPct) || 0) / 100);
  const variableCost = revenue * ((Number(assumption.variablePct) || 0) / 100);
  const fulfillment = soldUnits * (Number(assumption.fulfillment) || 0);
  const contributionBeforeMedia = revenue - cogs - variableCost - fulfillment;
  const targetContribution = revenue * (clamp(assumption.targetCmPct, 35, 80) / 100);
  const mediaBudget = Math.max(0, contributionBeforeMedia - targetContribution);
  const costCap = acquiredUnits > 0 ? mediaBudget / acquiredUnits : 0;
  const spendToDate = assumption.spendToDate === '' ? 0 : Math.max(0, Number(assumption.spendToDate) || 0);
  const dailyTarget = monthPacing.daysInMonth > 0 ? mediaBudget / monthPacing.daysInMonth : 0;
  const paceTargetToDate = dailyTarget * monthPacing.elapsedDays;
  const remainingSpend = Math.max(0, mediaBudget - spendToDate);
  const requiredDaily = monthPacing.remainingDays > 0 ? remainingSpend / monthPacing.remainingDays : 0;
  const paceDelta = spendToDate - paceTargetToDate;
  const paceRatio = paceTargetToDate > 0 ? spendToDate / paceTargetToDate : null;
  const postMediaContribution = revenue - cogs - variableCost - fulfillment - mediaBudget;
  const cmPct = revenue > 0 ? postMediaContribution / revenue : 0;

  return {
    sku: item.sku,
    forecastUnits,
    plannedUnits,
    acquiredUnits,
    returningUnits: Math.max(0, plannedUnits - acquiredUnits),
    revenue,
    newRevenue,
    returningRevenue,
    mediaBudget,
    costCap,
    spendToDate,
    dailyTarget,
    paceTargetToDate,
    remainingSpend,
    requiredDaily,
    paceDelta,
    paceRatio,
    postMediaContribution,
    cmPct,
  };
}

function sumRows(rows) {
  return rows.reduce((acc, row) => ({
    plannedUnits: acc.plannedUnits + row.plannedUnits,
    acquiredUnits: acc.acquiredUnits + row.acquiredUnits,
    returningUnits: acc.returningUnits + row.returningUnits,
    revenue: acc.revenue + row.revenue,
    newRevenue: acc.newRevenue + row.newRevenue,
    returningRevenue: acc.returningRevenue + row.returningRevenue,
    mediaBudget: acc.mediaBudget + row.mediaBudget,
    spendToDate: acc.spendToDate + row.spendToDate,
    paceTargetToDate: acc.paceTargetToDate + row.paceTargetToDate,
    remainingSpend: acc.remainingSpend + row.remainingSpend,
    postMediaContribution: acc.postMediaContribution + row.postMediaContribution,
  }), {
    plannedUnits: 0,
    acquiredUnits: 0,
    returningUnits: 0,
    revenue: 0,
    newRevenue: 0,
    returningRevenue: 0,
    mediaBudget: 0,
    spendToDate: 0,
    paceTargetToDate: 0,
    remainingSpend: 0,
    postMediaContribution: 0,
  });
}

export default function SkuMediaPacingTool() {
  const currentMonth = Math.min(11, Math.max(0, new Date().getMonth()));
  const [monthIndex, setMonthIndex] = useState(currentMonth);
  const [state, setState] = useState(getInitialState);
  const [sortKey, setSortKey] = useState('mediaBudget');
  const [history, setHistory] = useState({ months: [], recentReturningPct: 0, byCalendarMonth: {}, latestSnapshotAt: 0 });
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [useSeasonalReturnCurve, setUseSeasonalReturnCurve] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await apiJson('/api/db/monthly-metrics', undefined, 'Shopify history failed');
      setHistory(historicalFromRows(data.rows || []));
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  const applyGlobal = (patch) => {
    setState(prev => {
      const globals = { ...prev.globals, ...patch };
      const skuPatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => key !== 'returningRevenuePct' && key !== 'returningRevenueOverride')
      );
      const skus = Object.fromEntries(Object.entries(prev.skus).map(([sku, value]) => [
        sku,
        { ...value, ...skuPatch },
      ]));
      return { globals, skus };
    });
  };

  const updateSku = (sku, patch) => {
    setState(prev => ({
      ...prev,
      skus: { ...prev.skus, [sku]: { ...prev.skus[sku], ...patch } },
    }));
  };

  const rowsByMonth = useMemo(() => SKU_MEDIA_MONTHS.map((month, index) => {
    const monthPacing = getMonthPacing(index);
    const preRows = SKU_MEDIA_FORECAST.map(item => {
      const assumption = state.skus[item.sku];
      const forecastUnits = Number(item.units[index]) || 0;
      const override = assumption.unitOverride === '' ? null : Number(assumption.unitOverride);
      const plannedUnits = Math.max(0, override ?? forecastUnits * ((Number(assumption.unitMultiplier) || 0) / 100));
      const realizedPrice = Math.max(0, Number(assumption.price) || 0) * (1 - (Number(assumption.discountPct) || 0) / 100);
      const soldUnits = plannedUnits * (1 - (Number(assumption.returnRate) || 0) / 100);
      return { item, revenue: soldUnits * realizedPrice };
    });
    const monthRevenue = preRows.reduce((sum, row) => sum + row.revenue, 0);
    const historicalPct = useSeasonalReturnCurve
      ? (history.byCalendarMonth[index] ?? history.recentReturningPct)
      : history.recentReturningPct;
    const returnPct = clamp(
      state.globals.returningRevenueOverride === ''
        ? (history.months.length ? historicalPct : (Number(state.globals.returningRevenuePct) || 0) / 100)
        : Number(state.globals.returningRevenueOverride) / 100,
      0,
      0.75,
    );
    const monthReturningRevenue = Math.max(0, monthRevenue * returnPct);
    const rows = SKU_MEDIA_FORECAST.map(item => modelSku(
      item,
      state.skus[item.sku],
      index,
      monthReturningRevenue,
      monthRevenue,
      monthPacing,
    ));
    return { month, key: monthKeyForIndex(index), returnPct, pacing: monthPacing, rows, totals: sumRows(rows) };
  }), [history, state.globals.returningRevenueOverride, state.globals.returningRevenuePct, state.skus, useSeasonalReturnCurve]);

  const selected = rowsByMonth[monthIndex];
  const selectedRows = [...selected.rows]
    .filter(row => row.plannedUnits > 0 || row.forecastUnits > 0)
    .sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  const totalCmPct = selected.totals.revenue > 0
    ? selected.totals.postMediaContribution / selected.totals.revenue
    : 0;
  const blendedCostCap = selected.totals.acquiredUnits > 0
    ? selected.totals.mediaBudget / selected.totals.acquiredUnits
    : 0;
  const monthlyDailyTarget = selected.pacing.daysInMonth > 0
    ? selected.totals.mediaBudget / selected.pacing.daysInMonth
    : 0;
  const requiredDailyTotal = selected.pacing.remainingDays > 0
    ? selected.totals.remainingSpend / selected.pacing.remainingDays
    : 0;
  const totalPaceDelta = selected.totals.spendToDate - selected.totals.paceTargetToDate;
  const returnSource = history.months.length
    ? `${history.months.length} Shopify snapshot months`
    : 'manual fallback';
  const latestHistory = history.latestSnapshotAt
    ? new Date(history.latestSnapshotAt).toLocaleDateString()
    : 'No snapshot';

  const exportCsv = () => {
    const headings = ['Month', 'SKU', 'Planned units', 'New units', 'Returning units', 'Revenue', 'New revenue', 'Returning revenue', 'Cost cap', 'Monthly paid media', 'Daily target', 'Spend to date', 'Pace target to date', 'Required daily', 'Post-media CM %'];
    const lines = rowsByMonth.flatMap(month => month.rows.map(row => [
      month.month,
      row.sku,
      row.plannedUnits.toFixed(2),
      row.acquiredUnits.toFixed(2),
      row.returningUnits.toFixed(2),
      row.revenue.toFixed(2),
      row.newRevenue.toFixed(2),
      row.returningRevenue.toFixed(2),
      row.costCap.toFixed(2),
      row.mediaBudget.toFixed(2),
      row.dailyTarget.toFixed(2),
      row.spendToDate.toFixed(2),
      row.paceTargetToDate.toFixed(2),
      row.requiredDaily.toFixed(2),
      (row.cmPct * 100).toFixed(2),
    ]));
    const csv = [headings, ...lines].map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `howl_sku_media_pacing_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sku-pacing-workspace">
      <header className="sku-pacing-hero">
        <div className="sku-pacing-hero-copy">
          <span className="workspace-kicker">Contribution pacing</span>
          <h1>Fund the new-customer gap.</h1>
          <p>Monthly SKU targets from the 6/13 sales plan, adjusted for expected returning-customer revenue before paid media budgets and Cost Caps are set.</p>
          <small>{SKU_MEDIA_FORECAST_SOURCE.workbook} / {SKU_MEDIA_FORECAST_SOURCE.sheet}</small>
        </div>
        <div className="sku-pacing-command">
          <label>
            Planning month
            <select value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>
              {SKU_MEDIA_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
            </select>
          </label>
          <button type="button" onClick={exportCsv}>Export CSV</button>
        </div>
      </header>

      <section className="sku-pacing-metrics">
        <div className="primary">
          <span>{selected.month} paid media ceiling</span>
          <strong>{fmtMoney(selected.totals.mediaBudget)}</strong>
          <small>{fmtMoney(selected.totals.returningRevenue)} returning revenue removed from paid demand</small>
        </div>
        <div>
          <span>Account Cost Cap</span>
          <strong>{fmtMoney(blendedCostCap)}</strong>
          <small>{fmtNumber(selected.totals.acquiredUnits)} paid-attributed units</small>
        </div>
        <div>
          <span>Returning mix</span>
          <strong>{fmtPct(selected.returnPct * 100)}</strong>
          <small>{returnSource} / {latestHistory}</small>
        </div>
        <div>
          <span>Post-media CM</span>
          <strong>{fmtPct(totalCmPct * 100)}</strong>
          <small>{fmtMoney(selected.totals.postMediaContribution)} contribution</small>
        </div>
      </section>

      <section className="sku-pacing-daily">
        <div>
          <span>{selected.month} daily target</span>
          <strong>{fmtMoney(monthlyDailyTarget)}</strong>
          <small>{selected.pacing.elapsedDays} of {selected.pacing.daysInMonth} days elapsed</small>
        </div>
        <div className={totalPaceDelta < 0 ? 'behind' : 'ahead'}>
          <span>Spend pace</span>
          <strong>{totalPaceDelta < 0 ? '-' : '+'}{fmtMoney(Math.abs(totalPaceDelta))}</strong>
          <small>{fmtMoney(selected.totals.spendToDate)} spent vs {fmtMoney(selected.totals.paceTargetToDate)} pace</small>
        </div>
        <div>
          <span>Required daily</span>
          <strong>{fmtMoney(requiredDailyTotal)}</strong>
          <small>{fmtMoney(selected.totals.remainingSpend)} left across {selected.pacing.remainingDays} days</small>
        </div>
      </section>

      <section className="sku-pacing-layout">
        <aside className="sku-pacing-panel">
          <header>
            <strong>Control assumptions</strong>
            <button type="button" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? 'Loading' : 'Refresh Shopify'}
            </button>
          </header>
          {historyError ? <p className="sku-pacing-error">{historyError}</p> : null}
          <label className="sku-pacing-toggle">
            <input
              type="checkbox"
              checked={useSeasonalReturnCurve}
              onChange={event => setUseSeasonalReturnCurve(event.target.checked)}
            />
            Use seasonal returning curve
          </label>
          <div className="sku-pacing-fields">
            {[
              ['returningRevenueOverride', 'Returning revenue %', 0, 75],
              ['unitMultiplier', 'Unit plan %', 0, 250],
              ['discountPct', 'Discount %', 0, 80],
              ['cogsPct', 'COGS %', 0, 100],
              ['variablePct', 'Variable %', 0, 50],
              ['fulfillment', 'Fulfillment $', 0, 100],
              ['returnRate', 'Returns %', 0, 50],
              ['targetCmPct', 'Target CM %', 35, 80],
            ].map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={key === 'fulfillment' ? 1 : 0.5}
                  placeholder={key === 'returningRevenueOverride' ? fmtPct(selected.returnPct * 100) : undefined}
                  value={state.globals[key]}
                  onChange={event => applyGlobal({
                    [key]: event.target.value === ''
                      ? ''
                      : key === 'targetCmPct'
                        ? clamp(event.target.value, 35, 80)
                        : Number(event.target.value),
                  })}
                />
              </label>
            ))}
          </div>
          <div className="sku-pacing-history">
            {history.months.slice(-6).map(row => (
              <div key={row.month}>
                <span>{row.month}</span>
                <strong>{fmtPct(row.returningRevenuePct * 100)}</strong>
                <small>{fmtMoney(row.returningRevenue)}</small>
              </div>
            ))}
          </div>
        </aside>

        <main className="sku-pacing-main">
          <div className="sku-pacing-month-strip">
            {rowsByMonth.map((month, index) => (
              <button
                key={month.month}
                type="button"
                className={index === monthIndex ? 'active' : ''}
                onClick={() => setMonthIndex(index)}
              >
                <span>{month.month.slice(0, 3)}</span>
                <strong>{fmtMoney(month.totals.mediaBudget)}</strong>
                <small>{fmtPct(month.returnPct * 100)} ret</small>
              </button>
            ))}
          </div>

          <div className="sku-pacing-table-wrap">
            <div className="sku-pacing-table-toolbar">
              <strong>{selected.month} SKU pacing</strong>
              <label>
                Sort
                <select value={sortKey} onChange={event => setSortKey(event.target.value)}>
                  <option value="mediaBudget">Paid media</option>
                  <option value="costCap">Cost Cap</option>
                  <option value="requiredDaily">Required daily</option>
                  <option value="paceDelta">Pace delta</option>
                  <option value="acquiredUnits">New units</option>
                  <option value="returningRevenue">Returning revenue</option>
                  <option value="revenue">Revenue</option>
                </select>
              </label>
            </div>
            <div className="sku-pacing-table">
              <div className="sku-pacing-row sku-pacing-row-head">
                <span>SKU</span>
                <span>Units</span>
                <span>New units</span>
                <span>Returning rev</span>
                <span>Cost Cap</span>
                <span>Monthly target</span>
                <span>Spend to date</span>
                <span>Daily pace</span>
              </div>
              {selectedRows.map(row => {
                const assumption = state.skus[row.sku];
                return (
                  <div className="sku-pacing-row" key={row.sku}>
                    <span className="sku-pacing-name">
                      <strong>{row.sku}</strong>
                      <small>{fmtMoney(row.revenue)} revenue / {fmtPct(row.cmPct * 100)} CM</small>
                    </span>
                    <label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder={fmtNumber(row.forecastUnits, 0)}
                        value={assumption.unitOverride}
                        onChange={event => updateSku(row.sku, { unitOverride: event.target.value })}
                      />
                    </label>
                    <b>{fmtNumber(row.acquiredUnits)}</b>
                    <b>{fmtMoney(row.returningRevenue)}</b>
                    <b>{fmtMoney(row.costCap)}</b>
                    <b>{fmtMoney(row.mediaBudget)}</b>
                    <label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="$0"
                        value={assumption.spendToDate}
                        onChange={event => updateSku(row.sku, { spendToDate: event.target.value })}
                      />
                    </label>
                    <span className={row.paceDelta < 0 ? 'sku-pacing-status behind' : 'sku-pacing-status ahead'}>
                      <strong>{fmtMoney(row.requiredDaily)}</strong>
                      <small>{row.paceDelta < 0 ? 'Behind' : 'Ahead'} {fmtMoney(Math.abs(row.paceDelta))}</small>
                    </span>
                    <div className="sku-pacing-inline">
                      <label>
                        Price
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={assumption.price}
                          onChange={event => updateSku(row.sku, { price: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        COGS %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={assumption.cogsPct}
                          onChange={event => updateSku(row.sku, { cogsPct: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Ret %
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          placeholder={fmtNumber(selected.returnPct * 100, 1)}
                          value={assumption.returningRevenuePct}
                          onChange={event => updateSku(row.sku, { returningRevenuePct: event.target.value })}
                        />
                      </label>
                      <label>
                        Target CM
                        <input
                          type="number"
                          min="35"
                          max="80"
                          step="0.5"
                          value={assumption.targetCmPct}
                          onChange={event => updateSku(row.sku, { targetCmPct: clamp(event.target.value, 35, 80) })}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </section>
    </div>
  );
}
