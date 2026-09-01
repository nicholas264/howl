import React, { useMemo, useState, useEffect } from 'react';
import {
  SKU_MEDIA_FORECAST,
  SKU_MEDIA_FORECAST_SOURCE,
  SKU_MEDIA_MONTHS,
} from '../data/skuMediaForecast';

const STORAGE_KEY = 'howl_sku_media_pacing_assumptions_v1';

const DEFAULT_GLOBALS = {
  discountPct: 0,
  cogsPct: 42,
  variablePct: 7,
  fulfillment: 12,
  returnRate: 3,
  targetCmPct: 22,
  unitMultiplier: 100,
};

const fmtMoney = (value) => (Number(value) || 0).toLocaleString(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const fmtNumber = (value, digits = 0) => (Number(value) || 0).toLocaleString(undefined, {
  maximumFractionDigits: digits,
});
const pct = (value) => `${fmtNumber(value, 1)}%`;

function defaultSkuAssumption(item) {
  return {
    enabled: true,
    price: item.dtcPrice,
    discountPct: DEFAULT_GLOBALS.discountPct,
    cogsPct: DEFAULT_GLOBALS.cogsPct,
    variablePct: DEFAULT_GLOBALS.variablePct,
    fulfillment: DEFAULT_GLOBALS.fulfillment,
    returnRate: DEFAULT_GLOBALS.returnRate,
    targetCmPct: DEFAULT_GLOBALS.targetCmPct,
    unitMultiplier: DEFAULT_GLOBALS.unitMultiplier,
    unitOverride: '',
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

function modelSku(item, assumption, monthIndex) {
  const forecastUnits = Number(item.units[monthIndex]) || 0;
  const override = assumption.unitOverride === '' ? null : Number(assumption.unitOverride);
  const plannedUnits = assumption.enabled
    ? Math.max(0, override ?? forecastUnits * ((Number(assumption.unitMultiplier) || 0) / 100))
    : 0;
  const soldUnits = plannedUnits * (1 - (Number(assumption.returnRate) || 0) / 100);
  const realizedPrice = Math.max(0, Number(assumption.price) || 0) * (1 - (Number(assumption.discountPct) || 0) / 100);
  const revenue = soldUnits * realizedPrice;
  const cogs = revenue * ((Number(assumption.cogsPct) || 0) / 100);
  const variableCost = revenue * ((Number(assumption.variablePct) || 0) / 100);
  const fulfillment = soldUnits * (Number(assumption.fulfillment) || 0);
  const contributionBeforeMedia = revenue - cogs - variableCost - fulfillment;
  const targetContribution = revenue * ((Number(assumption.targetCmPct) || 0) / 100);
  const mediaBudget = Math.max(0, contributionBeforeMedia - targetContribution);
  const costCap = plannedUnits > 0 ? mediaBudget / plannedUnits : 0;
  const postMediaContribution = revenue - cogs - variableCost - fulfillment - mediaBudget;
  const cmPct = revenue > 0 ? postMediaContribution / revenue : 0;

  return {
    sku: item.sku,
    forecastUnits,
    plannedUnits,
    revenue,
    mediaBudget,
    costCap,
    postMediaContribution,
    cmPct,
  };
}

function sumRows(rows) {
  return rows.reduce((acc, row) => ({
    plannedUnits: acc.plannedUnits + row.plannedUnits,
    revenue: acc.revenue + row.revenue,
    mediaBudget: acc.mediaBudget + row.mediaBudget,
    postMediaContribution: acc.postMediaContribution + row.postMediaContribution,
  }), { plannedUnits: 0, revenue: 0, mediaBudget: 0, postMediaContribution: 0 });
}

export default function SkuMediaPacingTool() {
  const currentMonth = Math.min(11, Math.max(0, new Date().getMonth()));
  const [monthIndex, setMonthIndex] = useState(currentMonth);
  const [state, setState] = useState(getInitialState);
  const [sortKey, setSortKey] = useState('mediaBudget');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  const applyGlobal = (patch) => {
    setState(prev => {
      const globals = { ...prev.globals, ...patch };
      const skus = Object.fromEntries(Object.entries(prev.skus).map(([sku, value]) => [
        sku,
        { ...value, ...patch },
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
    const rows = SKU_MEDIA_FORECAST.map(item => modelSku(item, state.skus[item.sku], index));
    return { month, rows, totals: sumRows(rows) };
  }), [state.skus]);

  const selected = rowsByMonth[monthIndex];
  const selectedRows = [...selected.rows]
    .filter(row => row.plannedUnits > 0 || row.forecastUnits > 0)
    .sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  const totalCmPct = selected.totals.revenue > 0
    ? selected.totals.postMediaContribution / selected.totals.revenue
    : 0;
  const blendedCostCap = selected.totals.plannedUnits > 0
    ? selected.totals.mediaBudget / selected.totals.plannedUnits
    : 0;

  const exportCsv = () => {
    const headings = ['Month', 'SKU', 'Planned units', 'Revenue', 'Cost cap', 'Paid media', 'Post-media CM %'];
    const lines = rowsByMonth.flatMap(month => month.rows.map(row => [
      month.month,
      row.sku,
      row.plannedUnits.toFixed(2),
      row.revenue.toFixed(2),
      row.costCap.toFixed(2),
      row.mediaBudget.toFixed(2),
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
    <div className="sku-media-workspace">
      <header className="sku-media-head">
        <div>
          <span className="workspace-kicker">Performance planning</span>
          <h1>SKU Media Pacing</h1>
          <p>Translate DTC unit targets into monthly paid media budgets and account Cost Cap targets by SKU.</p>
          <small>{SKU_MEDIA_FORECAST_SOURCE.workbook} · {SKU_MEDIA_FORECAST_SOURCE.sheet}</small>
        </div>
        <button type="button" className="primary-action" onClick={exportCsv}>Export CSV</button>
      </header>

      <section className="sku-media-scoreboard">
        <div>
          <span>{selected.month} paid media</span>
          <strong>{fmtMoney(selected.totals.mediaBudget)}</strong>
          <small>{fmtNumber(selected.totals.plannedUnits)} planned DTC units</small>
        </div>
        <div>
          <span>Blended Cost Cap</span>
          <strong>{fmtMoney(blendedCostCap)}</strong>
          <small>Weighted max CPA across active SKUs</small>
        </div>
        <div>
          <span>DTC revenue target</span>
          <strong>{fmtMoney(selected.totals.revenue)}</strong>
          <small>{pct(totalCmPct * 100)} post-media contribution margin</small>
        </div>
      </section>

      <section className="sku-media-controls">
        <label>
          Month
          <select value={monthIndex} onChange={event => setMonthIndex(Number(event.target.value))}>
            {SKU_MEDIA_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
        </label>
        {[
          ['unitMultiplier', 'Unit plan %', 0, 250],
          ['discountPct', 'Discount %', 0, 80],
          ['cogsPct', 'COGS %', 0, 100],
          ['variablePct', 'Variable %', 0, 50],
          ['fulfillment', 'Fulfillment $', 0, 100],
          ['returnRate', 'Returns %', 0, 50],
          ['targetCmPct', 'Target CM %', 0, 80],
        ].map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step={key === 'fulfillment' ? 1 : 0.5}
              value={state.globals[key]}
              onChange={event => applyGlobal({ [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </section>

      <section className="sku-media-months">
        {rowsByMonth.map((month, index) => (
          <button
            key={month.month}
            type="button"
            className={index === monthIndex ? 'active' : ''}
            onClick={() => setMonthIndex(index)}
          >
            <span>{month.month.slice(0, 3)}</span>
            <strong>{fmtMoney(month.totals.mediaBudget)}</strong>
          </button>
        ))}
      </section>

      <section className="sku-media-table-wrap">
        <div className="sku-media-table-toolbar">
          <strong>{selected.month} SKU targets</strong>
          <label>
            Sort
            <select value={sortKey} onChange={event => setSortKey(event.target.value)}>
              <option value="mediaBudget">Paid media</option>
              <option value="costCap">Cost Cap</option>
              <option value="plannedUnits">Units</option>
              <option value="revenue">Revenue</option>
            </select>
          </label>
        </div>
        <div className="sku-media-table">
          <div className="sku-media-row sku-media-row-head">
            <span>SKU</span>
            <span>Units</span>
            <span>Price</span>
            <span>COGS</span>
            <span>Target CM</span>
            <span>Cost Cap</span>
            <span>Paid media</span>
          </div>
          {selectedRows.map(row => {
            const assumption = state.skus[row.sku];
            return (
              <div className="sku-media-row" key={row.sku}>
                <span>
                  <label className="sku-media-check">
                    <input
                      type="checkbox"
                      checked={assumption.enabled}
                      onChange={event => updateSku(row.sku, { enabled: event.target.checked })}
                    />
                    <strong>{row.sku}</strong>
                  </label>
                  <small>Forecast {fmtNumber(row.forecastUnits, 1)} · revenue {fmtMoney(row.revenue)}</small>
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
                <label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={assumption.price}
                    onChange={event => updateSku(row.sku, { price: Number(event.target.value) })}
                  />
                </label>
                <label>
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
                  <input
                    type="number"
                    min="0"
                    max="80"
                    step="0.5"
                    value={assumption.targetCmPct}
                    onChange={event => updateSku(row.sku, { targetCmPct: Number(event.target.value) })}
                  />
                </label>
                <b>{fmtMoney(row.costCap)}</b>
                <b>{fmtMoney(row.mediaBudget)}</b>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
