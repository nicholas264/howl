import React, { useState } from 'react';
import { financialTrends, ratio } from '../../lib/finance.js';
const monthLabel = month => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

function TrendChart({ title, note, rows, series, format }) {
 const [selected, setSelected] = useState(null);
 const active = rows.find(r => r.month === selected) || rows.findLast(r => series.some(s => Number.isFinite(r[s.key]))) || rows[0];
 const values = rows.flatMap(r => series.map(s => r[s.key])).filter(Number.isFinite);
 const min = Math.min(0, ...values), max = Math.max(0, ...values), padding = Math.max(.01, (max - min) * .12);
 const low = min < 0 ? min - padding : 0, high = max + padding;
 const x = i => 64 + i * 660 / Math.max(1, rows.length - 1), y = value => 210 - (value - low) / (high - low) * 175;
 const path = key => rows.map((r, i) => Number.isFinite(r[key]) ? `${i === 0 || !Number.isFinite(rows[i - 1][key]) ? 'M' : 'L'}${x(i)},${y(r[key])}` : '').join(' ');
 return <section className="fin-runway fin-trend-card" aria-label={title}>
  <div className="fin-section-heading"><h2>{title}</h2><span className="fin-status neutral">Monthly actuals</span></div>
  <p className="fin-trend-note">{note}</p>
  <div className="fin-revenue-chart">
   <div className="fin-chart-readout" aria-live="polite"><span>{monthLabel(active.month)}</span>{series.map(s => <span key={s.key}>{s.label} <strong>{format(active[s.key])}</strong></span>)}</div>
   <svg viewBox="0 0 760 226" role="img" aria-label={`${title}. Select a month below for values.`}>
    {[0, 1, 2, 3].map(i => { const value = low + (high - low) * i / 3; return <g key={i}><line x1="64" x2="736" y1={y(value)} y2={y(value)} stroke="#edf0f6"/><text x="54" y={y(value) + 4} textAnchor="end" fill="#7b8598" fontSize="11">{format(value, true)}</text></g>; })}
    {min < 0 && <line x1="64" x2="736" y1={y(0)} y2={y(0)} stroke="#adb6c8" strokeDasharray="3 4"/>}
    {series.map((s, index) => <g key={s.key}><path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="3" strokeDasharray={index ? '7 4' : undefined} strokeLinecap="round" strokeLinejoin="round"/>{rows.map((r, i) => Number.isFinite(r[s.key]) ? <circle key={r.month} cx={x(i)} cy={y(r[s.key])} r={r.month === active.month ? 5 : 3} fill={s.color} stroke="white" strokeWidth="1.5"/> : null)}</g>)}
   </svg>
   <div className="fin-month-selector" aria-label={`Inspect ${title}`}>{rows.map(r => <button key={r.month} aria-label={`${title}: ${r.month}`} aria-pressed={r.month === active.month} onClick={() => setSelected(r.month)} onFocus={() => setSelected(r.month)}>{monthLabel(r.month)}</button>)}</div>
   <div className="fin-plot-key">{series.map(s => <span key={s.key}><i style={{ background: s.color }}/>{s.label}</span>)}</div>
  </div>
 </section>;
}

export default function FinanceTrends({ periods, months, snapshot, settings, money, breakEven }) {
 const rows = financialTrends(periods, months, snapshot.accounts, settings);
 const revenue = months.reduce((sum, m) => sum + m.revenue, 0), cogs = months.reduce((sum, m) => sum + m.cogs, 0), expenses = months.reduce((sum, m) => sum + m.expenses, 0);
 const balance = snapshot.balance;
 const workingCapital = Number.isFinite(balance.currentAssets) && Number.isFinite(balance.currentLiabilities) ? balance.currentAssets - balance.currentLiabilities : null;
 const cashRatio = ratio(balance.cash, balance.currentLiabilities);
 const cashCoverage = ratio(balance.cash, breakEven.operatingBudget);
 const sellingModel = Array.isArray(settings.sellingAccountIds);
 const metrics = [
  ['Cash balance', money(balance.cash), `QuickBooks bank accounts · ${balance.asOf}`],
  ['Working capital', money(workingCapital), 'Current assets − current liabilities'],
  ['Cash ratio', cashRatio == null ? '—' : `${cashRatio.toFixed(2)}×`, 'Cash / current liabilities'],
  ['Operating margin', percent(ratio(revenue - cogs - expenses, revenue)), 'YTD operating income / revenue'],
  ['OpEx / revenue', percent(ratio(expenses, revenue)), 'YTD total operating expenses, including selling'],
  ['Cash / monthly OpEx', cashCoverage == null ? '—' : `${cashCoverage.toFixed(1)}×`, `Cash / ${breakEven.month || 'latest'} operating budget. Budget coverage, not cash-flow runway.`],
 ];
 return <>
  <div className="fin-trends-grid">
   <TrendChart title="Gross margin over time" note="Revenue less cost of goods sold, as a percentage of revenue. A month with zero or negative revenue has no margin percentage." rows={rows} series={[{ key: 'grossMargin', label: 'Gross margin', color: '#635bce' }]} format={percent}/>
   <TrendChart title="Operating expenses over time" note={sellingModel ? 'Remaining OpEx and selling expenses are shown separately. Together they equal total operating expenses; COGS and other expenses are excluded.' : 'Total operating expenses from QuickBooks, including selling expenses. Excludes COGS and other expenses.'} rows={rows} series={sellingModel ? [{ key: 'operatingBudget', label: 'Remaining OpEx', color: '#635bce' }, { key: 'sellingExpenses', label: 'Selling expenses', color: '#168477' }] : [{ key: 'totalOpex', label: 'Total OpEx', color: '#635bce' }]} format={(value, compact) => compact ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : money(value)}/>
  </div>
  <section className="fin-cfo-section" aria-label="CFO scorecard"><div className="fin-section-heading"><h2>CFO scorecard</h2><span className="fin-status neutral">Liquidity & operating health</span></div><div className="fin-cfo-grid">{metrics.map(([label, value, note]) => <div className="fin-cfo-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div></section>
 </>;
}
