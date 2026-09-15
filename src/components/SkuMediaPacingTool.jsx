import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { modelSku, sumRows, allocateCoreMedia, coreCostCap } from '../lib/sku-media-pacing.js';
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
const fmtPaceStatus = (value) => `${Number(value) < 0 ? 'Behind' : 'Ahead'} ${fmtNumber(Math.abs(Number(value) || 0))}`;
const fmtMoneyPaceStatus = (value) => `${Number(value) < 0 ? 'Behind' : 'Ahead'} ${fmtMoney(Math.abs(Number(value) || 0))}`;

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

export default function SkuMediaPacingTool() {
  const currentMonth = Math.min(11, Math.max(0, new Date().getMonth()));
  const [monthIndex, setMonthIndex] = useState(currentMonth);
  const [state, setState] = useState(getInitialState);
  const [sortKey, setSortKey] = useState('mediaBudget');
  const [history, setHistory] = useState({ months: [], recentReturningPct: 0, byCalendarMonth: {}, latestSnapshotAt: 0 });
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [useSeasonalReturnCurve, setUseSeasonalReturnCurve] = useState(true);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [editingSku, setEditingSku] = useState('');
  const [metaSpend, setMetaSpend] = useState({ byMonth: {}, loading: false, error: '' });
  const [shopifyUnits, setShopifyUnits] = useState({ byMonth: {}, loading: false, error: '' });

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

  const loadMetaSpend = useCallback(async (index = monthIndex) => {
    const monthKey = monthKeyForIndex(index);
    setMetaSpend(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await apiJson('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_sku_spend_pacing', monthKey }),
      }, 'Meta SKU spend failed');
      if (data.error) throw new Error(data.error);
      setMetaSpend(prev => ({
        ...prev,
        loading: false,
        error: '',
        byMonth: {
          ...prev.byMonth,
          [monthKey]: data,
        },
      }));
    } catch (err) {
      setMetaSpend(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, [monthIndex]);

  useEffect(() => { loadMetaSpend(monthIndex); }, [monthIndex, loadMetaSpend]);

  const loadShopifyUnits = useCallback(async (index = monthIndex) => {
    const monthKey = monthKeyForIndex(index);
    setShopifyUnits(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await apiJson('/api/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_sku_units', monthKey }),
      }, 'Shopify SKU units failed');
      if (data.error) throw new Error(data.error);
      setShopifyUnits(prev => ({
        ...prev,
        loading: false,
        error: '',
        byMonth: {
          ...prev.byMonth,
          [monthKey]: data,
        },
      }));
    } catch (err) {
      setShopifyUnits(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, [monthIndex]);

  useEffect(() => { loadShopifyUnits(monthIndex); }, [monthIndex, loadShopifyUnits]);

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
    const monthKey = monthKeyForIndex(index);
    const metaMonth = metaSpend.byMonth[monthKey] || null;
    const shopifyMonth = shopifyUnits.byMonth[monthKey] || null;
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
    const modeledRows = SKU_MEDIA_FORECAST.map(item => modelSku(
      item,
      state.skus[item.sku],
      index,
      monthReturningRevenue,
      monthRevenue,
      monthPacing,
      metaMonth ? (metaMonth.bySku?.[item.sku] || 0) : null,
      shopifyMonth ? (shopifyMonth.bySku?.[item.sku] || { units: 0, revenue: 0 }) : null,
    ));
    const rows = allocateCoreMedia(modeledRows, monthPacing);
    return { month, key: monthKey, meta: metaMonth, shopify: shopifyMonth, returnPct, pacing: monthPacing, rows, totals: sumRows(rows) };
  }), [history, metaSpend.byMonth, shopifyUnits.byMonth, state.globals.returningRevenueOverride, state.globals.returningRevenuePct, state.skus, useSeasonalReturnCurve]);

  const selected = rowsByMonth[monthIndex];
  const selectedRows = [...selected.rows]
    .filter(row => row.plannedUnits > 0 || row.forecastUnits > 0 || row.orderedUnits > 0 || row.spendToDate > 0)
    .sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  const totalCmPct = selected.totals.revenue > 0
    ? selected.totals.postMediaContribution / selected.totals.revenue
    : 0;
  const blendedCostCap = coreCostCap(selected.rows);
  const hasCoreSpendData = selected.rows.filter(row => row.isCoreProduct).every(row => row.hasSpendData);
  const requiredDailyTotal = selected.pacing.remainingDays > 0
    ? selected.totals.remainingSpend / selected.pacing.remainingDays
    : 0;
  const returnSource = state.globals.returningRevenueOverride !== ''
    ? 'Manual returning revenue assumption'
    : history.months.length
    ? `${history.months.length} Shopify snapshot months`
    : 'manual fallback';
  const latestHistory = history.latestSnapshotAt
    ? new Date(history.latestSnapshotAt).toLocaleDateString()
    : 'No snapshot';
  const selectedMeta = selected.meta || null;
  const selectedShopify = selected.shopify || null;
  const unmappedMetaSpend = selectedMeta
    ? Math.max(0, Number(selectedMeta.totalSpend || 0) - Number(selectedMeta.mappedSpend || 0))
    : 0;
  const unmappedShopifyUnits = selectedShopify
    ? (selectedShopify.unmapped || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    : 0;
  const metaSpendSource = selectedMeta
    ? `${fmtMoney(selectedMeta.mappedSpend)} mapped${unmappedMetaSpend ? ` / ${fmtMoney(unmappedMetaSpend)} unmapped` : ''}`
    : (metaSpend.loading ? 'Loading Meta' : 'No Meta spend loaded');
  const shopifyUnitSource = selectedShopify
    ? `${fmtNumber(selected.totals.orderedUnits)} ordered${unmappedShopifyUnits ? ` / ${fmtNumber(unmappedShopifyUnits)} unmapped` : ''}`
    : (shopifyUnits.loading ? 'Loading Shopify' : 'No Shopify units loaded');

  const exportCsv = () => {
    const headings = ['Month', 'SKU', 'Planned units', 'Ordered units', 'MTD core mix %', 'Core ordered units', 'Projected EOM units', 'Unit pace delta', 'Unit gap', 'New units', 'Returning units', 'Revenue', 'New revenue', 'Returning revenue', 'Cost cap', 'Monthly paid media', 'Daily target', 'Spend to date', 'Pace target to date', 'Required daily', 'Post-media CM %'];
    const lines = rowsByMonth.flatMap(month => month.rows.map(row => [
      month.month,
      row.sku,
      row.plannedUnits.toFixed(2),
      row.hasUnitData ? row.orderedUnits.toFixed(2) : '',
      (!row.hasUnitData || row.productMix == null) ? '' : (row.productMix * 100).toFixed(2),
      row.hasUnitData ? row.coreOrderedUnits.toFixed(2) : '',
      row.hasUnitData ? row.projectedUnits.toFixed(2) : '',
      row.hasUnitData ? row.unitPaceDelta.toFixed(2) : '',
      row.hasUnitData ? row.unitGap.toFixed(2) : '',
      row.acquiredUnits.toFixed(2),
      row.returningUnits.toFixed(2),
      row.revenue.toFixed(2),
      row.newRevenue.toFixed(2),
      row.returningRevenue.toFixed(2),
      row.isCoreProduct ? row.costCap.toFixed(2) : '',
      row.isCoreProduct ? row.mediaBudget.toFixed(2) : '',
      row.isCoreProduct ? row.dailyTarget.toFixed(2) : '',
      row.hasSpendData ? row.spendToDate.toFixed(2) : '',
      row.isCoreProduct ? row.paceTargetToDate.toFixed(2) : '',
      row.isCoreProduct && row.hasSpendData ? row.requiredDaily.toFixed(2) : '',
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
      <header className="sku-pacing-topbar">
        <div>
          <span className="workspace-kicker">Performance</span>
          <h1>SKU media pacing</h1>
          <small>{SKU_MEDIA_FORECAST_SOURCE.sheet} · 2026</small>
        </div>
        <div className="sku-pacing-actions">
          <label>
            Month
            <select value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>
              {SKU_MEDIA_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
            </select>
          </label>
          <label>
            Sort
            <select value={sortKey} onChange={event => setSortKey(event.target.value)}>
              <option value="mediaBudget">Monthly spend</option>
              <option value="requiredDaily">Required daily</option>
              <option value="unitPaceDelta">Unit pace</option>
              <option value="productMix">Core mix</option>
              <option value="paceDelta">Pace delta</option>
              <option value="costCap">Cost Cap</option>
              <option value="acquiredUnits">New units</option>
              <option value="returningRevenue">Returning revenue</option>
            </select>
          </label>
          <button type="button" onClick={() => setAssumptionsOpen(value => !value)}>
            {assumptionsOpen ? 'Hide assumptions' : 'Assumptions'}
          </button>
          <button type="button" onClick={() => loadMetaSpend(monthIndex)} disabled={metaSpend.loading}>
            {metaSpend.loading ? 'Loading Meta' : 'Refresh Meta'}
          </button>
          <button type="button" onClick={() => loadShopifyUnits(monthIndex)} disabled={shopifyUnits.loading}>
            {shopifyUnits.loading ? 'Loading Units' : 'Refresh units'}
          </button>
          <button type="button" onClick={exportCsv}>Export CSV</button>
        </div>
      </header>

      <section className="sku-pacing-metrics">
        <div className="primary">
          <span>Monthly spend</span>
          <strong>{fmtMoney(selected.totals.mediaBudget)}</strong>
          <small>{metaSpendSource}</small>
        </div>
        <div>
          <span>Required daily</span>
          <strong>{hasCoreSpendData ? fmtMoney(requiredDailyTotal) : '—'}</strong>
          <small>{hasCoreSpendData ? `${fmtMoney(selected.totals.remainingSpend)} left` : 'Awaiting Meta spend'}</small>
        </div>
        <div>
          <span>Cost Cap</span>
          <strong>{fmtMoney(blendedCostCap)}</strong>
          <small>Per new core unit · R1 / R3 / R4</small>
        </div>
        <div>
          <span>Returning</span>
          <strong>{fmtPct(selected.returnPct * 100)}</strong>
          <small>{returnSource}</small>
        </div>
        <div>
          <span>CM floor</span>
          <strong>{fmtPct(totalCmPct * 100)}</strong>
          <small>Target min 35%</small>
        </div>
      </section>

      {metaSpend.error ? <p className="sku-pacing-error" role="alert">Meta spend could not refresh: {metaSpend.error}</p> : null}
      {shopifyUnits.error ? <p className="sku-pacing-error" role="alert">Shopify units could not refresh: {shopifyUnits.error}</p> : null}
      <p className="sku-pacing-source">{shopifyUnitSource}. Meta: {metaSpendSource}. {selectedMeta ? `Through ${selectedMeta.until} (includes that day).` : ''}</p>

      {assumptionsOpen ? (
        <section className="sku-pacing-panel">
          {historyError ? <p className="sku-pacing-error">{historyError}</p> : null}
          <div className="sku-pacing-panel-head">
            <strong>Global assumptions</strong>
            <button type="button" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? 'Loading' : 'Refresh Shopify'}
            </button>
          </div>
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
          <div className="sku-pacing-assumption-note">
            <button
              type="button"
              className={useSeasonalReturnCurve ? 'active' : ''}
              onClick={() => setUseSeasonalReturnCurve(value => !value)}
            >
              Seasonal curve {useSeasonalReturnCurve ? 'on' : 'off'}
            </button>
            <span>Shopify history: {latestHistory}. Units: {shopifyUnitSource}. Meta: {selectedMeta?.since || selected.key} to {selectedMeta?.until || selected.key}.</span>
          </div>
        </section>
      ) : null}

      <main className="sku-pacing-table-wrap">
        <div className="sku-pacing-table">
          <div className="sku-pacing-row sku-pacing-row-head">
            <span>Product</span>
            <span>Unit status</span>
            <span>Target</span>
            <span>Ordered</span>
            <span>Projected</span>
            <span>Core mix</span>
            <span>Spend to date</span>
            <span>Spend status</span>
            <span>Monthly spend</span>
            <span>Req/day</span>
            <span>Cost Cap</span>
            <span></span>
          </div>
          {selectedRows.map(row => {
            const assumption = state.skus[row.sku];
            const isEditing = editingSku === row.sku;
            return (
              <div className={`sku-pacing-row-group ${isEditing ? 'open' : ''}`} key={row.sku}>
                <div className="sku-pacing-row">
                  <span className="sku-pacing-name">
                    <strong>{row.sku}</strong>
                    <small>{fmtNumber(row.unitTargetToDate)} target to date</small>
                  </span>
                  <span className={!row.hasUnitData ? 'sku-pacing-status neutral' : row.unitPaceDelta < 0 ? 'sku-pacing-status behind' : 'sku-pacing-status ahead'}>
                    <strong>{row.hasUnitData ? fmtPaceStatus(row.unitPaceDelta) : 'Awaiting units'}</strong>
                  </span>
                  <label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder={fmtNumber(row.forecastUnits, 0)}
                      aria-label={`${row.sku} target units`}
                      value={assumption.unitOverride}
                      onChange={event => updateSku(row.sku, { unitOverride: event.target.value })}
                    />
                  </label>
                  <span className={!row.hasUnitData ? 'sku-pacing-status neutral' : row.unitPaceDelta < 0 ? 'sku-pacing-status behind' : 'sku-pacing-status ahead'}>
                    <strong>{row.hasUnitData ? fmtNumber(row.orderedUnits) : '—'}</strong>
                  </span>
                  <b>{row.hasUnitData ? fmtNumber(row.projectedUnits) : '—'}</b>
                  {(!row.hasUnitData || row.productMix == null) ? (
                    <span className="sku-pacing-muted">n/a</span>
                  ) : (
                    <span className="sku-pacing-mix">
                      <strong>{fmtPct(row.productMix * 100)}</strong>
                      <small>of core</small>
                    </span>
                  )}
                  {row.isCoreProduct ? <b>{row.hasSpendData ? fmtMoney(row.spendToDate) : '—'}</b> : <b className="sku-pacing-muted">{row.hasSpendData && row.spendToDate > 0 ? fmtMoney(row.spendToDate) : 'Email/site'}</b>}
                  {row.isCoreProduct ? (
                    <span className={!row.hasSpendData ? 'sku-pacing-status neutral' : row.paceDelta < 0 ? 'sku-pacing-status behind' : 'sku-pacing-status ahead'}>
                      <strong>{row.hasSpendData ? fmtMoneyPaceStatus(row.paceDelta) : 'Awaiting spend'}</strong>
                    </span>
                  ) : (
                    <span className="sku-pacing-muted">No paid budget</span>
                  )}
                  {row.isCoreProduct ? <b>{fmtMoney(row.mediaBudget)}</b> : <b className="sku-pacing-muted">n/a</b>}
                  {row.isCoreProduct ? <b>{row.hasSpendData ? fmtMoney(row.requiredDaily) : '—'}</b> : <b className="sku-pacing-muted">n/a</b>}
                  {row.isCoreProduct ? <b>{fmtMoney(row.costCap)}</b> : <b className="sku-pacing-muted">n/a</b>}
                  <button
                    type="button"
                    className="sku-pacing-edit"
                    onClick={() => setEditingSku(isEditing ? '' : row.sku)}
                  >
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                </div>
                {isEditing ? (
                  <div className="sku-pacing-inline">
                    {row.isCoreProduct ? (
                      <label>
                        Spend override
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder={fmtMoney(row.metaSpend || 0)}
                          value={assumption.spendToDate}
                          onChange={event => updateSku(row.sku, { spendToDate: event.target.value })}
                        />
                      </label>
                    ) : null}
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
                    <span>{fmtMoney(row.revenue)} revenue / {fmtPct(row.cmPct * 100)} CM / {row.isCoreProduct ? `${fmtMoney(row.metaSpend || 0)} Meta` : 'email + cart behavior'}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
