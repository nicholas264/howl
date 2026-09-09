import { useState } from 'react';
import { apiFetch } from '../lib/apiFetch.js';
import { reportMonths, summarizeMonth, attributionCoverage } from '../lib/seeding-report.js';
import './SeedingBudgetDashboard.css';

const money = value => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const monthLabel = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

function Budget({ label, used, budget, tone }) {
  const remaining = budget === undefined ? null : budget - used;
  return <div className={`seed-budget-meter ${tone}`}>
    <h3>{label}</h3>
    <div className="seed-budget-numbers"><div><strong>{money(used)}</strong><span>used</span></div><div><strong className={remaining < 0 ? 'over' : ''}>{remaining === null ? '—' : money(Math.abs(remaining))}</strong><span>{remaining === null ? 'budget not set' : remaining < 0 ? 'over budget' : 'left'}</span></div></div>
    <div className="seed-budget-track" role="img" aria-label={budget === undefined ? 'Budget not set' : `${money(used)} used of ${money(budget)}`}><i style={{ width: `${budget > 0 ? Math.min(100, used / budget * 100) : used > 0 ? 100 : 0}%` }} /></div>
    <p>{budget === undefined ? 'Set a monthly budget to track what’s left.' : `${money(budget)} monthly budget${budget > 0 ? ` · ${Math.round(used / budget * 100)}% used` : ''}`}</p>
  </div>;
}

export default function SeedingBudgetDashboard({ report, month, onMonth, canManage, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ seeding: '', creator: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = report.as_of.slice(0, 7);
  const selected = /^\d{4}-\d{2}$/.test(month) ? month : current;
  const metrics = summarizeMonth(report, selected);
  const coverage = attributionCoverage(report, selected);
  const months = reportMonths(report, selected);
  const chartMonths = months;
  const chart = chartMonths.map(m => ({ month: m, ...summarizeMonth(report, m) }));
  const max = Math.max(1, ...chart.map(m => Math.max(m.investment, m.budget ? Number(m.budget.seeding) + Number(m.budget.creator) : 0)));
  const select = value => { onMonth(value); setEditing(false); setError(''); };
  async function save(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const response = await apiFetch('/api/creator-seeding-log', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'budget', month: selected, ...draft }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save budget');
      await onSaved(); setEditing(false);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  return <section className="seed-budget-dashboard" aria-label="Seeding and creator budgets">
    <div className="seed-budget-heading"><div><h2>{selected === current ? 'Month to date' : monthLabel(selected)}</h2><p>{selected === current ? `Through ${report.as_of} · America/Chicago` : 'Monthly investment and ad performance'}</p></div>
      <div className="seed-budget-controls"><label>View month<input type="month" value={selected} onChange={e => e.target.value && select(e.target.value)} disabled={saving} /></label><button type="button" disabled={saving} onClick={() => select(current)}>This month</button>
        {canManage && <button className="seed-budget-edit-toggle" type="button" aria-expanded={editing} aria-controls="seed-budget-editor" disabled={saving} onClick={() => { setDraft({ seeding: metrics.budget?.seeding ?? '', creator: metrics.budget?.creator ?? '' }); setEditing(!editing); }}>{editing ? 'Cancel' : 'Edit budgets'}</button>}</div>
    </div>
    {editing && <form id="seed-budget-editor" className="seed-budget-editor" onSubmit={save}><label>Seeding budget ($)<input type="number" min="0" max="999999999999.99" step="0.01" required value={draft.seeding} onChange={e => setDraft({ ...draft, seeding: e.target.value })} /></label><label>Creator fee budget ($)<input type="number" min="0" max="999999999999.99" step="0.01" required value={draft.creator} onChange={e => setDraft({ ...draft, creator: e.target.value })} /></label><button disabled={saving}>{saving ? 'Saving…' : `Save for ${monthLabel(selected)}`}</button></form>}
    {error && <p role="alert">{error}</p>}
    <div className="seed-budget-pair"><Budget label="Seeding · product + shipping" used={metrics.seeding} budget={metrics.budget?.seeding} tone="seeding" /><Budget label="Creator fees" used={metrics.creator} budget={metrics.budget?.creator} tone="creator" /></div>
    <p className="seed-budget-note">Recorded ledger costs by seeded date, including planned and blocked entries. Contract commitments and unrecorded payments are excluded.{metrics.scheduled > 0 && ` ${money(metrics.scheduled)} scheduled after today is excluded from used totals.`}{report.monthly.some(r => r.month === 'undated') && ' Undated entries are excluded; choose Undated in the ledger to review them.'}</p>
    <div className="seed-budget-chart-head"><div><h3>Monthly investment</h3><p>All recorded months. Click a month to see its budget, returns, and ledger.</p></div><div className="seed-budget-legend"><span><i className="seeding" />Seeding</span><span><i className="creator" />Creator fees</span><span>─ Combined budget</span></div></div>
    <div className="seed-budget-chart-scroll"><div className="seed-budget-scale"><span>{max === 1 ? 'No recorded investment' : money(max)}</span><span>USD · recorded costs through {report.as_of}</span></div><div className="seed-budget-chart" style={{ minWidth: `${Math.max(600, chart.length * 92)}px` }}>
      {chart.map(item => <button type="button" className={`seed-budget-column ${item.month === selected ? 'selected' : ''}`} key={item.month} aria-pressed={item.month === selected} onClick={() => select(item.month)} disabled={saving} aria-label={`${monthLabel(item.month)}: seeding ${money(item.seeding)}, creator fees ${money(item.creator)}, combined budget ${item.budget ? money(Number(item.budget.seeding) + Number(item.budget.creator)) : 'not set'}`}>
        <span className="seed-budget-bars" title={`Seeding ${money(item.seeding)} · Creator fees ${money(item.creator)}`}><span className="seed-budget-stack" style={{ height: `${item.investment / max * 100}%` }}><i className="creator" style={{ flex: Number(item.creator) }} /><i className="seeding" style={{ flex: Number(item.seeding) }} /></span>{item.budget && <i className="seed-budget-target" style={{ bottom: `${(Number(item.budget.seeding) + Number(item.budget.creator)) / max * 100}%` }} />}</span>
        <strong>{money(item.investment)}</strong><span>{monthLabel(item.month)}</span>
      </button>)}
    </div></div>
    <div className="seed-budget-returns-head"><h3>Creator ad returns · {monthLabel(selected)}</h3><span>{metrics.ads ? `Latest included ad data: ${String(metrics.ads.through).slice(0, 10)}` : 'No linked ad data for this month'}</span></div>
    {report.performance_error && <p role="alert">{report.performance_error}</p>}
    {coverage && <div className="seed-attribution-coverage">
      <div className="seed-attribution-heading"><div><h3>Creator linking coverage</h3><p>{coverage.creator.spending_ads} of {coverage.ads} ads with spend are linked to creators{coverage.linkedShare === null ? '.' : ` · ${coverage.linkedShare.toFixed(1)}% of account spend.`} Data through {String(coverage.through).slice(0,10)}.</p></div><a href="/?tab=creative-analytics">Review ad sources</a></div>
      <div className="seed-attribution-buckets"><div><span>Creator-linked spend</span><strong>{money(coverage.creator.spend)}</strong></div><div><span>Known non-creator spend</span><strong>{money(coverage.other.spend)}</strong></div><div><span>Needs source review</span><strong>{money(coverage.unreviewed.spend)}</strong></div></div>
      <p>{Number(coverage.unreviewed.spend) > 0 ? 'Partial attribution: unreviewed ads may include creator content. The returns below include linked creator ads only and should not be treated as complete creator performance.' : 'The returns below include creator-linked ads only.'} Founder, internal, and tool-made ads are excluded from creator returns.</p>
    </div>}
    <div className="seed-budget-returns">{[
      ['Creator-linked ad revenue', metrics.ads ? money(metrics.revenue) : '—'],
      ['Creator-linked ad spend', metrics.ads ? money(metrics.spend) : '—'],
      ['ROAS', metrics.roas === null ? '—' : `${metrics.roas.toFixed(2)}×`],
      ['ROI before product margin', metrics.roi === null ? '—' : `${metrics.roi.toFixed(1)}%`],
    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <details className="seed-budget-method"><summary>How returns are calculated</summary><p>Uses synced ad-account purchase revenue and spend for ads linked to creators, counted once per ad per day. ROAS = revenue ÷ ad spend. ROI = (revenue − ad spend − recorded seeding and creator costs) ÷ (ad spend + recorded seeding and creator costs). Revenue and costs use the same calendar month; this is not lifetime ROI for creators seeded that month or net profit. Sold-product costs, overhead, and unrecorded fees are excluded. Missing ad data displays “—”.</p></details>
  </section>;
}
