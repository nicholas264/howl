import { useEffect, useMemo, useState } from 'react';

const currentMonth = () => new Date().toISOString().slice(0, 7);
const labelType = value => value === 'one_off' ? 'One-off' : value === 'retainer' ? 'Retainer' : 'Unassigned';

function monthLabel(value) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dateLabel(value) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function money(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  });
}

function numberInput(value) {
  return value == null ? '' : String(Math.round(Number(value) * 100) / 100);
}

export default function CreativePlanningWorkspace({ onOpenCreator }) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState({
    spend_target: '',
    cpa_target: '',
    revenue_target: '',
    spend_capacity_per_asset: '',
    win_rate_pct: '',
    useful_lifespan_days: '',
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetch(`/api/creative-planning?month=${encodeURIComponent(month)}`)
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load creative plan');
        if (active) {
          setData(result);
          setScenario({
            spend_target: numberInput(result.scenario?.spend_target),
            cpa_target: numberInput(result.scenario?.cpa_target),
            revenue_target: numberInput(result.scenario?.revenue_target),
            spend_capacity_per_asset: numberInput(result.scenario?.spend_capacity_per_asset),
            win_rate_pct: numberInput(result.scenario?.win_rate_pct),
            useful_lifespan_days: numberInput(result.scenario?.useful_lifespan_days),
          });
        }
      })
      .catch(err => {
        if (active && !(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  const maxWeekly = useMemo(() => Math.max(1, ...(data?.weeks || []).map(item => item.expected)), [data]);
  const summary = data?.summary || {};
  const demand = data?.demand || {};
  const benchmarks = data?.benchmarks || {};

  const saveScenario = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creative-planning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, scenario }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save planning assumptions');
      setData(result);
      setScenario({
        spend_target: numberInput(result.scenario?.spend_target),
        cpa_target: numberInput(result.scenario?.cpa_target),
        revenue_target: numberInput(result.scenario?.revenue_target),
        spend_capacity_per_asset: numberInput(result.scenario?.spend_capacity_per_asset),
        win_rate_pct: numberInput(result.scenario?.win_rate_pct),
        useful_lifespan_days: numberInput(result.scenario?.useful_lifespan_days),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openCreator = creatorId => {
    if (onOpenCreator) return onOpenCreator(Number(creatorId));
    setError('Creator navigation is not available from this view.');
  };

  return (
    <div className="creator-workspace planning-workspace">
      <header className="creator-head">
        <div>
          <span className="workspace-kicker">Creator operations</span>
          <h1>Creative Plan</h1>
          <p>See contracted creator supply, scheduled deadlines, completed output, and the work putting the month at risk.</p>
        </div>
        <label className="planning-month">Planning month<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
      </header>

      {error && <div className="app-error">{error}</div>}

      <section className="planning-scorecard">
        <div><span>Forecast supply</span><strong>{summary.forecast || 0}</strong><small>scheduled + unallocated commitments</small></div>
        <div><span>Scheduled</span><strong>{summary.scheduled || 0}</strong><small>assets with deadlines</small></div>
        <div><span>Completed</span><strong>{summary.completed || 0}</strong><small>{summary.shipped || 0} shipped</small></div>
        <div className={summary.unscheduled ? 'warning' : ''}><span>Unscheduled</span><strong>{summary.unscheduled || 0}</strong><small>contracted without deadlines</small></div>
        <div className={summary.overdue ? 'risk' : ''}><span>Overdue</span><strong>{summary.overdue || 0}</strong><small>assets remaining past due</small></div>
      </section>

      <div className="planning-demand-grid">
        <section className="planning-panel planning-demand-result">
          <div className="planning-panel-head">
            <span>Monthly creative demand</span>
            <small>{demand.ready ? 'Steady-state replacement model' : 'Add assumptions to calculate'}</small>
          </div>
          <div className="planning-demand-cards">
            <div><span>New assets required</span><strong>{demand.new_assets_required ?? '—'}</strong><small>{demand.active_assets_needed ?? '—'} active winners needed</small></div>
            <div><span>Forecast supply</span><strong>{summary.forecast || 0}</strong><small>contracted + scheduled</small></div>
            <div className={demand.surplus_shortfall == null ? '' : demand.surplus_shortfall < 0 ? 'shortfall' : 'surplus'}>
              <span>{demand.surplus_shortfall != null && demand.surplus_shortfall < 0 ? 'Asset shortfall' : 'Asset surplus'}</span>
              <strong>{demand.surplus_shortfall == null ? '—' : Math.abs(demand.surplus_shortfall)}</strong>
              <small>{demand.purchases_required ?? '—'} purchases required</small>
            </div>
          </div>
          {!demand.ready && (
            <p className="planning-demand-note">
              Historical attribution is still too thin to set reliable defaults. Enter monthly spend capacity, win rate, and useful lifespan to run the scenario now.
            </p>
          )}
          {demand.ready && (
            <p className="planning-demand-note">
              Required assets = active winners needed × monthly replacement rate ÷ expected win rate. Every assumption remains editable.
            </p>
          )}
        </section>

        <form className="planning-panel planning-assumptions" onSubmit={saveScenario}>
          <div className="planning-panel-head"><span>Demand assumptions</span><small>{data?.scenario?.source === 'cfo_forecast' ? 'Started from CFO forecast' : 'Saved scenario'}</small></div>
          <div className="planning-assumption-grid">
            <label>Monthly spend target<input type="number" min="0" step="100" value={scenario.spend_target} onChange={event => setScenario({ ...scenario, spend_target: event.target.value })} /></label>
            <label>CPA target<input type="number" min="0.01" step="1" value={scenario.cpa_target} onChange={event => setScenario({ ...scenario, cpa_target: event.target.value })} /></label>
            <label>Spend capacity / winner<input type="number" min="0.01" step="100" placeholder={numberInput(benchmarks.median_monthly_spend_capacity)} value={scenario.spend_capacity_per_asset} onChange={event => setScenario({ ...scenario, spend_capacity_per_asset: event.target.value })} /></label>
            <label>Expected win rate %<input type="number" min="0.1" max="100" step="1" placeholder={numberInput(benchmarks.win_rate_at_target)} value={scenario.win_rate_pct} onChange={event => setScenario({ ...scenario, win_rate_pct: event.target.value })} /></label>
            <label>Useful lifespan days<input type="number" min="1" step="1" placeholder={numberInput(benchmarks.median_useful_lifespan_days)} value={scenario.useful_lifespan_days} onChange={event => setScenario({ ...scenario, useful_lifespan_days: event.target.value })} /></label>
            <label>Revenue target<input type="number" min="0" step="1000" value={scenario.revenue_target} onChange={event => setScenario({ ...scenario, revenue_target: event.target.value })} /></label>
          </div>
          <button className="primary-action" disabled={saving}>{saving ? 'Saving…' : 'Save scenario'}</button>
        </form>
      </div>

      <section className="planning-panel planning-benchmarks">
        <div className="planning-panel-head">
          <span>Historical asset productivity</span>
          <small className={`planning-confidence ${benchmarks.confidence || 'low'}`}>{benchmarks.confidence || 'low'} confidence · {benchmarks.spending_assets || 0} spending assets</small>
        </div>
        <div>
          <dl><dt>Median revenue / asset</dt><dd>{money(benchmarks.median_revenue_per_asset)}</dd></dl>
          <dl><dt>Average revenue / asset</dt><dd>{money(benchmarks.average_revenue_per_asset)}</dd></dl>
          <dl><dt>Median monthly capacity</dt><dd>{money(benchmarks.median_monthly_spend_capacity)}</dd></dl>
          <dl><dt>Win rate at target CPA</dt><dd>{benchmarks.win_rate_at_target == null ? '—' : `${Number(benchmarks.win_rate_at_target).toFixed(0)}%`}</dd></dl>
          <dl><dt>Median useful lifespan</dt><dd>{benchmarks.median_useful_lifespan_days == null ? '—' : `${Math.round(benchmarks.median_useful_lifespan_days)} days`}</dd></dl>
          <dl><dt>Active in last 14 days</dt><dd>{benchmarks.active_assets_14d || 0}</dd></dl>
        </div>
        {!benchmarks.auto_defaults_ready && <p>HOWL will begin using historical medians as defaults after 10 spending assets. Until then, saved manual assumptions stay in control.</p>}
      </section>

      <div className="planning-grid">
        <section className="planning-panel">
          <div className="planning-panel-head"><span>{monthLabel(month)} supply</span><small>Forecast by creator relationship</small></div>
          <div className="planning-supply">
            {(data?.by_type || []).map(item => (
              <article key={item.type}>
                <header><strong>{labelType(item.type)}</strong><span>{item.forecast} forecast</span></header>
                <div className="planning-stack">
                  <i className="complete" style={{ width: `${item.forecast ? (item.completed / item.forecast) * 100 : 0}%` }} />
                  <i className="scheduled" style={{ width: `${item.forecast ? (Math.max(item.scheduled - item.completed, 0) / item.forecast) * 100 : 0}%` }} />
                  <i className="unscheduled" style={{ width: `${item.forecast ? (item.unscheduled / item.forecast) * 100 : 0}%` }} />
                </div>
                <footer><span>{item.completed} complete</span><span>{item.scheduled} scheduled</span><span>{item.unscheduled} unscheduled</span></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="planning-panel">
          <div className="planning-panel-head"><span>Weekly delivery</span><small>Deadlines, not upload dates</small></div>
          <div className="planning-weeks">
            {(data?.weeks || []).map((week, index) => (
              <div key={week.start}>
                <span>Week {index + 1}<small>{dateLabel(week.start)} - {dateLabel(new Date(new Date(week.end).getTime() - 1))}</small></span>
                <div><i style={{ width: `${(week.expected / maxWeekly) * 100}%` }} /><b style={{ width: `${(week.completed / maxWeekly) * 100}%` }} /></div>
                <strong>{week.completed}/{week.expected}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="planning-panel planning-risk-panel">
        <div className="planning-panel-head"><span>Deadline risk</span><small>{data?.risks?.length || 0} incomplete deliverables</small></div>
        <div className="planning-table">
          <div className="planning-table-head"><span>Creator / deliverable</span><span>Type</span><span>Due</span><span>Remaining</span><span>State</span></div>
          {(data?.risks || []).map(item => (
            <button key={item.id} type="button" onClick={() => openCreator(item.creator_id)}>
              <span><strong>{item.creator_name}</strong><small>{item.title}</small></span>
              <span>{labelType(item.engagement_type)}</span>
              <time>{dateLabel(item.due_at)}</time>
              <b>{item.remaining}</b>
              <i className={item.risk}>{item.risk.replace('_', ' ')}</i>
            </button>
          ))}
          {!loading && !data?.risks?.length && <div className="workflow-empty">No incomplete deliverables are scheduled for this month.</div>}
        </div>
      </section>

      {!!data?.commitments?.filter(item => item.unscheduled_assets > 0).length && (
        <section className="planning-panel">
          <div className="planning-panel-head"><span>Commitments needing deadlines</span><small>Contracted supply not yet placed on the calendar</small></div>
          <div className="planning-commitments">
            {data.commitments.filter(item => item.unscheduled_assets > 0).map(item => (
              <button key={item.id} type="button" onClick={() => openCreator(item.creator_id)}>
                <span><strong>{item.creator_name}</strong><small>{labelType(item.engagement_type)} · {item.commitment_period === 'monthly' ? 'monthly commitment' : 'engagement commitment'}{item.cadence ? ` · ${item.cadence}` : ''}</small></span>
                <b>{item.unscheduled_assets} unscheduled</b>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
