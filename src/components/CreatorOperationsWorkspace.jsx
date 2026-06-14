import { useEffect, useMemo, useState } from 'react';

const FILTERS = [
  ['all', 'All'],
  ['urgent', 'Urgent'],
  ['outreach', 'Outreach'],
  ['contracts', 'Contracts'],
  ['creative', 'Creative'],
  ['product', 'Product'],
  ['production', 'Production'],
];

function dateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  const overdueDays = Math.ceil((Date.now() - date.getTime()) / 86400000);
  if (overdueDays > 0) return `${overdueDays}d overdue`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function actionDetail(item) {
  if (item.action_key === 'production_overdue') return item.overdue_title || 'Incomplete creator deliverable';
  if (item.action_key === 'follow_up') return 'Creator outreach needs a response or next step.';
  if (item.action_key === 'await_agreement') return 'Agreement sent; acceptance is still outstanding.';
  if (item.action_key === 'await_footage') return 'Assignment is live; footage has not arrived yet.';
  if (item.action_key === 'add_contact') return 'Contact information is blocking the relationship.';
  if (item.action_key === 'add_shipping') return 'Shipping details are blocking product fulfillment.';
  if (item.action_key === 'seed_product') return 'The creative is defined; the creator still needs the product.';
  return `${item.stage} creator · ${item.category}`;
}

export default function CreatorOperationsWorkspace({ onOpenCreator }) {
  const [data, setData] = useState({ items: [], summary: { categories: {} } });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch('/api/creator-operations')
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load creator operations');
        if (active) setData(result);
      })
      .catch(err => {
        if (active && !(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => data.items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return item.action_state === 'urgent';
    return item.category === filter;
  }), [data.items, filter]);

  const summary = data.summary || {};
  return (
    <section className="creator-operations">
      <div className="operations-scorecard">
        <div className="urgent"><span>Urgent</span><strong>{summary.urgent || 0}</strong><small>overdue work and follow-ups</small></div>
        <div><span>Needs action</span><strong>{summary.action || 0}</strong><small>team-owned next steps</small></div>
        <div className="waiting"><span>Waiting</span><strong>{summary.waiting || 0}</strong><small>with creators now</small></div>
        <div className="blocked"><span>Blocked</span><strong>{summary.blocked || 0}</strong><small>missing required data</small></div>
      </div>

      <div className="operations-toolbar">
        <div>
          <span>Creator action queue</span>
          <small>One current priority per active relationship</small>
        </div>
        <nav>
          {FILTERS.map(([key, label]) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
              {label}
              {key !== 'all' && <i>{key === 'urgent' ? summary.urgent || 0 : summary.categories?.[key] || 0}</i>}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="app-error">{error}</div>}
      <div className="operations-list">
        {visible.map(item => (
          <button key={item.id} className={`operations-row ${item.action_state}`} onClick={() => onOpenCreator(item, item.target_tab)}>
            <span className="operations-avatar">
              {item.avatar_url ? <img src={item.avatar_url} alt="" /> : item.name.slice(0, 1)}
            </span>
            <span className="operations-person">
              <strong>{item.name}</strong>
              <small>{item.email || 'No email'} · {item.stage}</small>
            </span>
            <span className="operations-action">
              <i>{item.action_state}</i>
              <strong>{item.action_label}</strong>
              <small>{actionDetail(item)}</small>
            </span>
            <time>{dateLabel(item.action_date) || 'Open record'}</time>
            <b>→</b>
          </button>
        ))}
        {!loading && !visible.length && (
          <div className="operations-empty">
            <strong>Nothing needs attention here.</strong>
            <p>Change the filter or keep the current momentum.</p>
          </div>
        )}
      </div>
    </section>
  );
}
