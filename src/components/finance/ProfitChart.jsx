import ChartHoverLayer from './ChartHoverLayer.jsx';
import React, { useState } from 'react';
import { profitSeries, ebitdaFields } from '../../lib/finance.js';

const labels = { interest: 'Interest expense', incomeTax: 'Income tax expense', depreciation: 'Depreciation', amortization: 'Amortization' };
const monthLabel = month => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const series = [{ key: 'netIncome', label: 'Net income', color: '#635bce' }, { key: 'ebitda', label: 'EBITDA', color: '#168477' }];

export default function ProfitChart({ periods, months, adjustments, draft, update, save, busy, money, demo }) {
 const [selected, setSelected] = useState(null);
 const rows = profitSeries(periods, months, adjustments);
 const active = rows.find(r => r.month === selected) || rows.findLast(r => Number.isFinite(r.netIncome)) || rows[0];
 const values = rows.flatMap(r => [r.netIncome, r.ebitda]).filter(Number.isFinite);
 const min = Math.min(0, ...values), max = Math.max(0, ...values), padding = Math.max(1, (max - min) * .12);
 const low = min < 0 ? min - padding : 0, high = max + padding;
 const x = i => 64 + i * 660 / Math.max(1, rows.length - 1);
 const y = v => 210 - (v - low) / (high - low) * 175;
 const line = key => rows.map((r, i) => Number.isFinite(r[key]) ? `${i === 0 || !Number.isFinite(rows[i - 1][key]) ? 'M' : 'L'}${x(i)},${y(r[key])}` : '').join(' ');
 const actuals = rows.filter(r => Number.isFinite(r.netIncome));
 const complete = actuals.length > 0 && actuals.every(r => Number.isFinite(r.ebitda));
 const total = key => actuals.reduce((sum, r) => sum + r[key], 0);
 const edit = (month, key, value) => {
  const next = { ...(draft.ebitdaAdjustments || {}) }, entries = { ...next[month] };
  if (value === '') delete entries[key]; else entries[key] = Number(value);
  next[month] = entries;
  update({ ...draft, ebitdaAdjustments: next });
 };
 return <section className="fin-runway fin-profit-chart" aria-label="Monthly profitability">
  <div className="fin-section-heading"><h2>How is profit trending?</h2><span className="fin-status neutral">Monthly profitability</span></div>
  <div className="fin-profit-totals">{series.map(s => <div key={s.key}><span>{s.label} · fiscal year to date</span><strong>{money(s.key === 'ebitda' ? complete ? total(s.key) : null : actuals.length ? total(s.key) : null)}</strong></div>)}</div>
  <div className="fin-revenue-chart">
   <div className="fin-chart-readout" aria-live="polite"><span>{monthLabel(active.month)}</span>{series.map(s => <span key={s.key}>{s.label} <strong>{money(active[s.key])}</strong></span>)}</div>
   <svg viewBox="0 0 760 226" role="group" aria-label={`${demo ? 'Sample' : 'QuickBooks'} monthly net income and reconciled EBITDA. Hover a dot or select a month for values.`}>
    {[0, 1, 2, 3].map(i => { const v = low + (high - low) * i / 3; return <g key={i}><line x1="64" x2="736" y1={y(v)} y2={y(v)} stroke="#edf0f6"/><text x="54" y={y(v) + 4} textAnchor="end" fill="#7b8598" fontSize="11">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}</text></g>; })}
    {min < 0 && <line x1="64" x2="736" y1={y(0)} y2={y(0)} stroke="#adb6c8" strokeDasharray="3 4"/>}
    {series.map(s => <g key={s.key}><path d={line(s.key)} fill="none" stroke={s.color} strokeWidth="3" strokeDasharray={s.key === 'ebitda' ? '7 4' : undefined} strokeLinecap="round" strokeLinejoin="round"/>{rows.map((r, i) => Number.isFinite(r[s.key]) ? <circle key={r.month} cx={x(i)} cy={y(r[s.key])} r={active.month === r.month ? 5 : 3} fill={s.color} stroke="white" strokeWidth="1.5"/> : null)}</g>)}
    <ChartHoverLayer rows={rows} series={series} x={x} y={y} format={money} onSelect={index => setSelected(rows[index].month)}/>
   </svg>
   <div className="fin-month-selector" aria-label="Inspect profitability month">{rows.map(r => <button key={r.month} aria-label={`Inspect profit ${r.month}`} aria-pressed={active.month === r.month} onClick={() => setSelected(r.month)} onFocus={() => setSelected(r.month)}>{monthLabel(r.month)}</button>)}</div>
   <div className="fin-plot-key">{series.map(s => <span key={s.key}><i style={{ background: s.color }}/>{s.label}</span>)}</div>
  </div>
  <p className="fin-footnote">Net income comes from {demo ? 'sample reports' : 'QuickBooks'}. EBITDA = net income + interest expense + income tax expense + depreciation + amortization. Addbacks are owner-entered amounts already included in net income; payroll and sales taxes are not income taxes.</p>
  {!complete && <p className="fin-footnote">EBITDA is pending reconciliation for {actuals.filter(r => !Number.isFinite(r.ebitda)).length} reported months. Blank entries are unknown, not zero. Future months remain empty.</p>}
  <details className="fin-ebitda-editor"><summary>Review EBITDA addbacks</summary><p>Enter each month’s reported expenses in {draft.currency}, including explicit zeros where none apply. Use negative amounts for reversals or income tax benefits. Save to update the chart. Review these entries after QuickBooks adjustments; they are not automatically imported.</p>
   {draft.start !== periods[0] ? <p>Save the new fiscal year and sync reports before reconciling EBITDA.</p> : <fieldset disabled={busy}><div className="fin-table-wrap"><table><thead><tr><th>Month</th><th>Net income</th>{ebitdaFields.map(key => <th key={key}>{labels[key]}</th>)}</tr></thead><tbody>{actuals.map(r => <tr key={r.month}><th>{monthLabel(r.month)}</th><td>{money(r.netIncome)}</td>{ebitdaFields.map(key => <td key={key}><input type="number" step="0.01" min="-1000000000000" max="1000000000000" aria-label={`${r.month} ${labels[key]}`} placeholder="Not reviewed" value={draft.ebitdaAdjustments?.[r.month]?.[key] ?? ''} onChange={e => edit(r.month, key, e.target.value)}/></td>)}</tr>)}</tbody></table></div><button onClick={save}>Save EBITDA reconciliation</button></fieldset>}
  </details>
 </section>;
}
