import { useEffect, useMemo, useState } from 'react';

const currentMonth = () => new Date().toISOString().slice(0, 7);
const labelType = value => value === 'one_off' ? 'One-off' : value === 'retainer' ? 'Retainer' : 'Unassigned';

function monthLabel(value) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dateLabel(value) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function CreativePlanningWorkspace({ onOpenCreator }) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetch(`/api/creative-planning?month=${encodeURIComponent(month)}`)
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load creative plan');
        if (active) setData(result);
      })
      .catch(err => {
        if (active && !(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  const maxWeekly = useMemo(() => Math.max(1, ...(data?.weeks || []).map(item => item.expected)), [data]);
  const summary = data?.summary || {};

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
            <button key={item.id} onClick={() => onOpenCreator?.(Number(item.creator_id))}>
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
              <button key={item.id} onClick={() => onOpenCreator?.(Number(item.creator_id))}>
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
