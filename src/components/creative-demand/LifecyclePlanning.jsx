import React, {useMemo, useState} from 'react';
import {buildLifecycleEvidence, planFundedCreative} from '../../lib/creative-lifecycle.js';

const money = n => n == null ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(n);
const pct = n => n == null ? 'Unavailable' : `${(n * 100).toFixed(1)}%`;
const month = m => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
const number = n => n == null ? '—' : n.toLocaleString('en-US', {maximumFractionDigits: 1});

function downloadPlan(plan) {
  const rows = [['aMER', 'Launch date', 'Brief by', 'Assets', 'Mature review date', 'Expected first 30 day media spend', 'Minimum test spend allocation', 'Status'],
    ...plan.batches.map(b => [plan.amer, b.launchDate, b.briefBy, b.assets, b.reviewBy, b.testFunding.toFixed(2), b.minimumTestFunding.toFixed(2), 'Provisional calibration; media costs only'])];
  const blob = new Blob([rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `creative-calibration-${plan.amer}x-${plan.planningDate}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LifecyclePlanning({history, assumptions}) {
  const [selectedAmer, setSelectedAmer] = useState(4.5);
  const [selectedMonth, setSelectedMonth] = useState(history.targets?.[0]?.month || '');
  const [planningDate, setPlanningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const lifecycle = useMemo(() => buildLifecycleEvidence(history, assumptions), [history, assumptions]);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(planningDate) && planningDate >= history.asOf;
  const scenarios = useMemo(() => dateValid ? [4, 4.5, 4.55, 5].map(a => planFundedCreative(history, lifecycle, assumptions, a, planningDate)) : [], [history, lifecycle, assumptions, planningDate, dateValid]);
  const plan = scenarios.find(p => p.amer === selectedAmer);
  const recommendation = scenarios.find(p => p.amer === 4.5);
  const recommendedMonth = recommendation?.rows.find(r => r.month === selectedMonth) || recommendation?.rows[0];
  const launchBatches = recommendedMonth?.batches.filter(b => b.assets > 0) || [];
  const dateLabel = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
  const testCommitment = recommendedMonth?.batches.reduce((sum, b) => sum + b.testFunding, 0);
  const verified = history.months.filter(m => !m.partial && m.verifiedNewRevenue != null && m.dtcRevenue > 0).at(-1);
  return <>
    <section className="cd-recommendation" aria-labelledby="recommendation-title">
      <div className="cd-recommendation-top"><span className="cd-target-badge">4.5× aMER target</span>{recommendation?.rows.length > 0 && <label>Plan month<select value={recommendedMonth?.month || ''} onChange={e => setSelectedMonth(e.target.value)}>{recommendation.rows.map(r => <option key={r.month} value={r.month}>{month(r.month)}</option>)}</select></label>}</div>
      {recommendedMonth && recommendation.ready ? <>
        <h2 id="recommendation-title">{recommendedMonth.launches > 0 ? <>Produce {recommendedMonth.launches} new {recommendedMonth.launches === 1 ? 'ad' : 'ads'} for {new Date(recommendedMonth.month + '-01T12:00:00Z').toLocaleDateString('en-US', {month:'long', timeZone:'UTC'})}.</> : 'Rework the testing budget before adding new ads.'}</h2>
        <p className="cd-recommendation-lead">{launchBatches.length ? `Launch in ${launchBatches.length} ${launchBatches.length === 1 ? 'batch' : 'weekly batches'}, starting ${dateLabel(launchBatches[0].launchDate)}.` : 'Earlier planned tests use the available reserve. Open the budget detail to adjust the plan.'}</p>
        {launchBatches.length > 0 && <ol className="cd-launch-batches" aria-label="Recommended launches">{launchBatches.map(b => <li key={b.launchDate}><strong>{b.assets} {b.assets === 1 ? 'ad' : 'ads'}</strong><span>Launch {dateLabel(b.launchDate)}</span><small>Brief by {dateLabel(b.briefBy)}</small></li>)}</ol>}
        <dl className="cd-simple-budget"><div><dt>DTC revenue goal</dt><dd>{money(recommendedMonth.dtcRevenue)}</dd></div><div><dt>Monthly Meta spending limit</dt><dd>{money(recommendedMonth.metaBudget)}</dd></div><div><dt>New-ad testing commitment</dt><dd>{money(testCommitment)}</dd></div></dl>
        <p className="cd-simple-caveat"><strong>Use this as a starting test plan.</strong> This volume fits the current media-budget assumptions; it is not proven sufficient to reach the revenue goal. Testing commitments cover each ad’s first 30 days and can extend into the next month.</p>
        <div className="cd-recommendation-actions"><button type="button" disabled={!launchBatches.length} onClick={() => downloadPlan({...recommendation, batches: launchBatches})}>Download this month’s schedule</button><span>{assumptions.weeklyCapacity > 0 ? `Capacity: ${assumptions.weeklyCapacity} ads/week.` : 'Confirm team capacity before assigning.'} Production lead time: {assumptions.productionLeadDays} days.</span></div>
      </> : <><h2 id="recommendation-title">{!dateValid ? 'Choose a valid planning date.' : !recommendedMonth ? 'Update the revenue plan to get a recommendation.' : 'More mature creative history is needed.'}</h2><p>Open the planning detail below to review dates, targets, and evidence.</p></>}
    </section>
    <details className="cd-section cd-advanced"><summary>Budget detail, scenarios & forecast evidence</summary>
    <section className="cd-section cd-operating" aria-labelledby="operating-title">
      <div className="cd-section-head"><div><h2 id="operating-title">Fund the learning plan</h2><p>Revenue sets the spending limit. Existing creative and funded new cohorts show how much of it the evidence can explain.</p></div><label>Production planning date<input type="date" min={history.asOf} value={planningDate} onChange={e => setPlanningDate(e.target.value)}/></label></div>
      <div className="cd-notice"><strong>Calibration before quotas</strong><p>The forecasts have not established a dependable relationship between creative volume and profitable scale. Launch counts below fit the assumed media budgets; they do not promise the revenue target.</p></div>
      <p>Each new batch reserves its full first 30 days of testing at launch. Later spend carries into following months. Earlier batches get funding first, subject to later months’ limits. No production-cost budget is included. {assumptions.weeklyCapacity > 0 ? `Production is capped at ${assumptions.weeklyCapacity} assets per week.` : 'Team capacity is unset; enter a weekly limit in planning assumptions before assigning work.'}</p>
      {verified && <p className="cd-caption">Latest classified full month: {month(verified.month)} had {pct(verified.verifiedNewRevenue / verified.dtcRevenue)} new-customer revenue and {money(verified.googleSpend)} Google spend. Planning still uses {assumptions.newCustomerShare}% and {money(assumptions.otherSpend)} per month until approved inputs replace them.</p>}
      {!dateValid && <p role="alert">Choose a planning date on or after {history.asOf}.</p>}
      {plan && <>
        <div className="cd-scenario-tabs" role="group" aria-label="aMER scenario">{scenarios.map(p => <button type="button" key={p.amer} aria-pressed={selectedAmer === p.amer} onClick={() => setSelectedAmer(p.amer)}>{p.amer.toFixed(2)}× aMER</button>)}</div>
        <div className="cd-table-wrap"><table className="cd-bridge"><caption>Monthly spending plan at {selectedAmer.toFixed(2)}× aMER</caption><thead><tr><th>Monthly plan</th>{plan.rows.map(r => <th key={r.month}>{month(r.month)}</th>)}</tr></thead><tbody>
          {[
            ['DTC revenue goal', r => money(r.dtcRevenue)],
            ['Total ad spending limit', r => money(r.totalBudget)],
            ['Meta spending limit', r => money(r.metaBudget)],
            ['Current library: qualified spend', r => money(r.existingQualified)],
            ['Earlier planned cohorts: qualified spend', r => money(r.priorCohortQualified)],
            ['This month’s launches: qualified spend', r => money(r.cohortQualified - r.priorCohortQualified)],
            ['Qualified-spend gap after test reserve', r => money(r.qualifiedGap)],
            ['Diagnostic launches needed at first slot*', r => number(r.requiredAtFirstSlot)],
            ['Funded new assets', r => number(r.launches)],
            ['Expected winners after first 30 days', r => number(r.expectedWinners)],
            ['Projected media spend, all outcomes', r => money(r.projectedGross)],
            ['Unallocated Meta budget', r => money(r.unallocated)],
          ].map(([label, value]) => <tr key={label}><th>{label}</th>{plan.rows.map(r => <td key={r.month}>{value(r)}</td>)}</tr>)}
        </tbody></table></div>
        <p className="cd-caption">Qualified spend meets the separate Meta ROAS, purchase, and spend thresholds. The gap is Meta budget less unsuccessful-test reserve less projected qualified spend. Unallocated budget uses all projected outcomes, including unsuccessful spend. Neither measure estimates incremental revenue. *Diagnostic demand assumes every required asset launches in the first available slot; it ignores team capacity and is not a quota. Expected winners can mature in a later month. Zero funded launches indicate a funding constraint while the spend gap remains.</p>
        <div className="cd-table-wrap"><table><caption>Compare funded launch counts across aMER targets</caption><thead><tr><th>aMER</th>{plan.rows.map(r => <th key={r.month}>{month(r.month)}</th>)}<th>Total assets</th></tr></thead><tbody>{scenarios.map(p => <tr key={p.amer}><th>{p.amer.toFixed(2)}×</th>{p.rows.map(r => <td key={r.month}>{r.launches}</td>)}<td>{p.totalLaunches}</td></tr>)}</tbody></table></div>
        <details className="cd-plan-notes"><summary>Budget limits & unresolved assumptions</summary>{plan.rows.map(r => <div key={r.month}><h3>{month(r.month)} · {r.status}</h3><ul>{r.flags.map(flag => <li key={flag}>{flag}</li>)}</ul><p>Unsuccessful-test spend projected: {money(r.cohortUnsuccessful)} / {money(r.reserve)} reserve. First-30-day unsuccessful spend committed to this month’s new launches: {money(r.launchReserveCommitment)}. Commitments and calendar spend are separate checks, not additive costs.</p></div>)}<p>New cohorts are projected for 90 days. Beyond the revenue-plan horizon they imply {plan.tail.length ? plan.tail.map(t => `${money(t.gross)} in ${month(t.month)}`).join(', ') : 'no additional modeled spend'}. Those amounts need future budgets. No spend after day 90 is assumed.</p><p>New-customer share, other-channel budgets, returns, production capacity, and the ROAS threshold remain assumptions. Product margins and November discounts must be reviewed before calling any scenario profitable.</p></details>
        <div className="cd-section-head cd-schedule-head"><div><h3>Weekly production & testing schedule</h3><p>Earliest new production can launch: {plan.earliestLaunch}. Review dates include 30 delivery days plus seven days for attribution.</p></div><button type="button" onClick={() => downloadPlan(plan)}>Download schedule CSV</button></div>
        <div className="cd-table-wrap"><table><thead><tr><th>Brief by</th><th>Launch</th><th>Funded assets</th><th>Expected first-30-day media spend</th><th>Allocate at least to test*</th><th>Mature review</th></tr></thead><tbody>{plan.batches.map(b => <tr key={b.launchDate}><th>{b.briefBy}</th><td>{b.launchDate}</td><td>{b.assets}</td><td>{money(b.testFunding)}</td><td>{money(b.minimumTestFunding)}</td><td>{b.reviewBy}</td></tr>)}</tbody></table></div>
        {!plan.batches.length && <p>No launch slots remain within these target months at this lead time.</p>}
        <p className="cd-caption">*Fund at least {money(assumptions.minTestSpend)} per asset for evaluation, subject to the media buyer’s stop rules. The expected-spend column includes winners and unresolved tests; it is not a guarantee every asset will receive delivery. Assets are exact media sets, not concepts or ad IDs.</p>
        <div className="cd-owners"><div><h3>Creative</h3><p>Deliver the scheduled media assets. Track original concepts separately from edits and format variants.</p></div><div><h3>Media buying</h3><p>Launch and track delivery weekly. Mark below-threshold assets as unresolved. Evaluate hits only after their measurement window closes.</p></div><div><h3>Growth</h3><p>Review tested assets, winners, spend at the ROAS floor, and actual aMER weekly. Release further budget only as results support it.</p></div></div>
      </>}
    </section>
    <section className="cd-section"><h2>How long do winners keep contributing?</h2><p>{lifecycle.complete90} mapped launches have a complete 90-day history; {lifecycle.firstWinners90} met the winner definition in their first 30 days. Among those winners, the median first threshold crossing was day {number(lifecycle.medianWinDay)}.</p>
      <div className="cd-lifecycle-strip">{lifecycle.cumulative.map(c => <div key={c.days}><span>First {c.days} days</span><strong>{money(c.median)}</strong><small>Median cumulative spend · same {c.sample} winners</small></div>)}</div>
      <div className="cd-table-wrap"><table><thead><tr><th>Age window</th><th>Mature launches</th><th>First-month winners</th><th>Winners still qualifying</th><th>Mean spend / launch, all outcomes</th><th>Mean qualified spend / launch</th></tr></thead><tbody>{lifecycle.curves.map(c => <tr key={c.block}><th>Days {c.fromDay}–{c.throughDay}</th><td>{c.sample}</td><td>{c.winners}</td><td>{pct(c.winnerRetention)}</td><td>{money(c.totalPerLaunch)}</td><td>{money(c.qualifiedPerLaunch)}</td></tr>)}</tbody></table></div>
      <p className="cd-caption">Each row uses launches old enough for that entire window, with zero delivery included. “Still qualifying” uses the same spend, purchase, and ROAS thresholds in that age window; it does not prove permanent fatigue. {lifecycle.lateQualifiers} of the complete 90-day launches first crossed the cumulative thresholds after day 30; these late qualifiers are excluded from first-month-winner forecasts. Spend is allocated evenly within each age window for planning.</p>
      <details className="cd-plan-notes"><summary>Inspect 90-day winner lifecycles</summary><div className="cd-table-wrap"><table><thead><tr><th>Asset</th><th>Launch</th><th>First threshold day</th><th>30-day spend</th><th>60-day spend</th><th>90-day spend</th></tr></thead><tbody>{lifecycle.lifecycleAssets.filter(a => a.firstWinner).sort((a, b) => b.spend90 - a.spend90).map(a => <tr key={a.key}><th>{a.name}</th><td>{a.firstDate}</td><td>{a.winDay}</td><td>{money(a.spend30)}</td><td>{money(a.spend60)}</td><td>{money(a.spend90)}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="cd-section"><h2>What today’s library can carry</h2><p>{lifecycle.library.length} assets qualified during {lifecycle.baselineStart} to {lifecycle.knownThrough}. Historical comparisons use the same {lifecycle.gapDays}-day gap between the mature baseline and the first target month.</p>
      <div className="cd-table-wrap"><table><thead><tr><th>Target</th><th>Historical windows</th><th>Projected spend, all outcomes</th><th>Projected qualified spend</th><th>Holdouts</th><th>Spend error</th><th>Qualified-spend error</th><th>Unchanged-library error*</th></tr></thead><tbody>{lifecycle.forecasts.map(f => <tr key={f.month}><th>{month(f.month)}</th><td>{f.windows}</td><td>{money(f.gross)}</td><td>{money(f.qualified)}</td><td>{f.holdouts}</td><td>{pct(f.grossError)}</td><td>{pct(f.qualifiedError)}</td><td>{pct(f.persistenceError)}</td></tr>)}</tbody></table></div>
      <p className="cd-caption">*Comparison assumes baseline qualified spend repeats unchanged. Errors are sum of absolute errors ÷ actual spend across rolling holdouts. Training uses only outcomes mature by each historical decision date. A forecast needs at least three holdouts and ≤50% error for both total and qualified spend to pass the planning check. Repeated assets and overlapping windows are not independent experiments.</p>
      <p>New-cohort 90-day qualified-spend error: <strong>{pct(lifecycle.cohortError)}</strong> across {lifecycle.cohortBacktests.length} monthly holdouts. This tests the spend estimate; it does not establish revenue causality or profitable scale.</p>
      <details className="cd-plan-notes"><summary>Current qualifying assets</summary><div className="cd-table-wrap"><table><thead><tr><th>Asset</th><th>First delivery</th><th>Mature 30-day spend</th><th>Purchases</th><th>Meta ROAS</th></tr></thead><tbody>{[...lifecycle.library].sort((a, b) => b.spend - a.spend).map(a => <tr key={a.key}><th>{a.name}</th><td>{a.firstDate || 'Before daily history'}</td><td>{money(a.spend)}</td><td>{number(a.purchases)}</td><td>{a.roas.toFixed(2)}×</td></tr>)}</tbody></table></div></details>
      <p className="cd-caption">Forecasts cover the currently qualifying library and newly planned cohorts. Other existing assets and reactivations are unmodeled opportunities. Product and prospecting/retargeting splits need verified labels; ad names alone are insufficient.</p>
    </section>
    </details>
  </>;
}
