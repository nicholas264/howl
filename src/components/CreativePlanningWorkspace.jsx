import { useEffect, useMemo, useState } from 'react';

const currentMonth = () => new Date().toISOString().slice(0, 7);
const labelType = value => value === 'one_off' ? 'One-off' : value === 'retainer' ? 'Retainer' : 'Unassigned';

function monthLabel(value) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dateLabel(value) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function money(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '$0';
  return Number(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  });
}

function numberInput(value) {
  return value == null ? '' : String(Math.round(Number(value) * 100) / 100);
}

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return '0%';
  return `${Math.round(Number(value))}%`;
}

export default function CreativePlanningWorkspace({ onOpenCreator, setActiveTab }) {
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
        if (!response.ok) throw new Error(result.error || 'Could not load monthly output');
        if (!active) return;
        setData(result);
        setScenario({
          spend_target: numberInput(result.scenario?.spend_target),
          cpa_target: numberInput(result.scenario?.cpa_target),
          revenue_target: numberInput(result.scenario?.revenue_target),
          spend_capacity_per_asset: numberInput(result.scenario?.spend_capacity_per_asset),
          win_rate_pct: numberInput(result.scenario?.win_rate_pct),
          useful_lifespan_days: numberInput(result.scenario?.useful_lifespan_days),
        });
      })
      .catch(err => {
        if (active && !(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  const summary = data?.summary || {};
  const seeding = data?.seeding || { summary: {}, products: [], rows: [] };
  const seedSummary = seeding.summary || {};
  const demand = data?.demand || {};
  const benchmarks = data?.benchmarks || {};
  const completedPct = summary.forecast ? (Number(summary.completed || 0) / Number(summary.forecast || 1)) * 100 : 0;
  const scheduledPct = summary.forecast ? (Number(summary.scheduled || 0) / Number(summary.forecast || 1)) * 100 : 0;
  const seededInvestment = Number(seedSummary.seeded_total_investment || 0);
  const costPerExpectedAsset = Number(seedSummary.seeded_assets_expected || 0)
    ? seededInvestment / Number(seedSummary.seeded_assets_expected)
    : null;
  const outputHealth = summary.overdue
    ? 'At risk'
    : summary.unscheduled
      ? 'Needs scheduling'
      : demand.surplus_shortfall != null && demand.surplus_shortfall < 0
        ? 'Under target'
        : 'On track';

  const rowsNeedingAction = useMemo(() => {
    const risks = (data?.risks || []).slice(0, 6).map(item => ({
      key: `risk-${item.id}`,
      creator_id: item.creator_id,
      creator_name: item.creator_name,
      title: item.title,
      meta: `${dateLabel(item.due_at)} due`,
      metric: `${item.remaining} left`,
      tone: item.risk === 'overdue' ? 'risk' : 'warning',
      target: 'deliverables',
    }));
    const unscheduled = (data?.commitments || [])
      .filter(item => Number(item.unscheduled_assets || 0) > 0)
      .slice(0, Math.max(0, 6 - risks.length))
      .map(item => ({
        key: `commitment-${item.id}`,
        creator_id: item.creator_id,
        creator_name: item.creator_name,
        title: `${labelType(item.engagement_type)} commitment`,
        meta: item.commitment_period === 'monthly' ? 'monthly agreement' : 'engagement agreement',
        metric: `${item.unscheduled_assets} unscheduled`,
        tone: 'warning',
        target: 'deliverables',
      }));
    return [...risks, ...unscheduled];
  }, [data]);

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
      if (!response.ok) throw new Error(result.error || 'Could not save model assumptions');
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

  const openCreator = (creatorId, targetTab = 'profile') => {
    if (onOpenCreator) return onOpenCreator(Number(creatorId), targetTab);
    setError('Creator navigation is not available from this view.');
  };

  return (
    <div className="creator-workspace output-workspace">
      <header className="output-head">
        <div>
          <span className="workspace-kicker">Creator operations</span>
          <h1>Monthly Output</h1>
          <p>{monthLabel(month)} creator production, seeded investment, and the work most likely to block launchable assets.</p>
        </div>
        <div className="output-head-controls">
          <label>Month<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
          <button type="button" onClick={() => setActiveTab?.('seeding-ledger')}>Seeding ledger</button>
        </div>
      </header>

      {error && <div className="app-error">{error}</div>}

      <section className={`output-command ${outputHealth === 'At risk' ? 'risk' : outputHealth === 'On track' ? 'good' : 'warning'}`}>
        <div className="output-command-main">
          <span>{outputHealth}</span>
          <strong>{summary.forecast || 0} forecast assets</strong>
          <p>{summary.completed || 0} complete, {summary.shipped || 0} shipped, {summary.unscheduled || 0} still need deadlines.</p>
        </div>
        <div className="output-gauge" style={{ '--complete': `${Math.min(100, completedPct)}%`, '--scheduled': `${Math.min(100, scheduledPct)}%` }}>
          <i />
          <span>{pct(completedPct)} complete</span>
        </div>
      </section>

      <section className="output-metrics">
        <article>
          <span>Expected output</span>
          <strong>{summary.forecast || 0}</strong>
          <small>{summary.scheduled || 0} scheduled + {summary.unscheduled || 0} from agreements</small>
        </article>
        <article>
          <span>Seeded investment</span>
          <strong>{money(seededInvestment)}</strong>
          <small>{money(seedSummary.seeded_cogs)} COGS + {money(seedSummary.seeded_creator_fees)} creator fees</small>
        </article>
        <article>
          <span>Seeded products</span>
          <strong>{seedSummary.seeded_units || 0}</strong>
          <small>{seedSummary.seeded_creators || 0} creators, {seedSummary.seeded_products || 0} product groups</small>
        </article>
        <article className={summary.overdue ? 'risk' : ''}>
          <span>Needs attention</span>
          <strong>{Number(summary.overdue || 0) + Number(summary.unscheduled || 0)}</strong>
          <small>{summary.overdue || 0} overdue, {summary.unscheduled || 0} unscheduled</small>
        </article>
      </section>

      <div className="output-grid">
        <section className="output-panel output-month">
          <div className="output-panel-head">
            <span>Output build</span>
            <small>Retainers, one-offs, and unassigned work</small>
          </div>
          <div className="output-type-list">
            {(data?.by_type || []).map(item => (
              <div key={item.type}>
                <header>
                  <strong>{labelType(item.type)}</strong>
                  <span>{item.forecast} forecast</span>
                </header>
                <div className="output-bar">
                  <i style={{ width: `${item.forecast ? (item.completed / item.forecast) * 100 : 0}%` }} />
                  <b style={{ width: `${item.forecast ? (item.scheduled / item.forecast) * 100 : 0}%` }} />
                </div>
                <footer>
                  <span>{item.completed} complete</span>
                  <span>{item.scheduled} scheduled</span>
                  <span>{item.unscheduled} unscheduled</span>
                </footer>
              </div>
            ))}
          </div>
        </section>

        <section className="output-panel">
          <div className="output-panel-head">
            <span>Product seeding</span>
            <small>{costPerExpectedAsset == null ? 'Waiting on promised asset counts' : `${money(costPerExpectedAsset)} per promised asset`}</small>
          </div>
          <div className="output-product-list">
            {(seeding.products || []).slice(0, 6).map(item => (
              <div key={`${item.product_label}-${item.unit_type}`}>
                <span>
                  <strong>{item.product_label}</strong>
                  <small>{item.quantity} {item.unit_type} across {item.creators} creator{item.creators === 1 ? '' : 's'}</small>
                </span>
                <b>{money(item.total_investment)}</b>
              </div>
            ))}
            {!loading && !(seeding.products || []).length && (
              <div className="output-empty">No seeded products are logged for this month.</div>
            )}
          </div>
        </section>
      </div>

      <section className="output-panel">
        <div className="output-panel-head">
          <span>Action queue</span>
          <small>Only items that change this month&apos;s output</small>
        </div>
        <div className="output-action-table">
          {rowsNeedingAction.map(item => (
            <button key={item.key} type="button" onClick={() => openCreator(item.creator_id, item.target)}>
              <span>
                <strong>{item.creator_name}</strong>
                <small>{item.title}</small>
              </span>
              <em>{item.meta}</em>
              <b className={item.tone}>{item.metric}</b>
            </button>
          ))}
          {!loading && !rowsNeedingAction.length && (
            <div className="output-empty">No overdue assets or unscheduled commitments for this month.</div>
          )}
        </div>
      </section>

      <details className="output-panel output-model">
        <summary>
          <span>Demand model</span>
          <small>{demand.ready ? `${demand.new_assets_required || 0} assets required at current assumptions` : 'Add assumptions only when you need capacity planning'}</small>
        </summary>
        <div className="output-model-body">
          <div className="output-demand">
            <div><span>Spend target</span><strong>{money(data?.scenario?.spend_target)}</strong></div>
            <div><span>Assets required</span><strong>{demand.new_assets_required ?? '-'}</strong></div>
            <div className={demand.surplus_shortfall != null && demand.surplus_shortfall < 0 ? 'risk' : 'good'}>
              <span>{demand.surplus_shortfall != null && demand.surplus_shortfall < 0 ? 'Shortfall' : 'Surplus'}</span>
              <strong>{demand.surplus_shortfall == null ? '-' : Math.abs(demand.surplus_shortfall)}</strong>
            </div>
            <div><span>Historical sample</span><strong>{benchmarks.spending_assets || 0}</strong></div>
          </div>
          <form className="output-assumptions" onSubmit={saveScenario}>
            <label>Monthly spend target<input type="number" min="0" step="100" value={scenario.spend_target} onChange={event => setScenario({ ...scenario, spend_target: event.target.value })} /></label>
            <label>CPA target<input type="number" min="0.01" step="1" value={scenario.cpa_target} onChange={event => setScenario({ ...scenario, cpa_target: event.target.value })} /></label>
            <label>Spend capacity / winner<input type="number" min="0.01" step="100" placeholder={numberInput(benchmarks.median_monthly_spend_capacity)} value={scenario.spend_capacity_per_asset} onChange={event => setScenario({ ...scenario, spend_capacity_per_asset: event.target.value })} /></label>
            <label>Expected win rate %<input type="number" min="0.1" max="100" step="1" placeholder={numberInput(benchmarks.win_rate_at_target)} value={scenario.win_rate_pct} onChange={event => setScenario({ ...scenario, win_rate_pct: event.target.value })} /></label>
            <label>Useful lifespan days<input type="number" min="1" step="1" placeholder={numberInput(benchmarks.median_useful_lifespan_days)} value={scenario.useful_lifespan_days} onChange={event => setScenario({ ...scenario, useful_lifespan_days: event.target.value })} /></label>
            <label>Revenue target<input type="number" min="0" step="1000" value={scenario.revenue_target} onChange={event => setScenario({ ...scenario, revenue_target: event.target.value })} /></label>
            <button className="primary-action" disabled={saving}>{saving ? 'Saving' : 'Save model'}</button>
          </form>
        </div>
      </details>
    </div>
  );
}
