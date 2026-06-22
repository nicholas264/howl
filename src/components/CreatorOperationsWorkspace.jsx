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
  if (item.action_key === 'finish_edit') return item.edit_title ? `Footage ready: ${item.edit_title}` : 'Creator footage is received and ready to edit.';
  if (item.action_key === 'follow_up') return 'Creator outreach needs a response or next step.';
  if (item.action_key === 'start_outreach') return 'No outreach is logged yet. Start the relationship from this creator record.';
  if (item.action_key === 'define_terms') return 'Commercial terms are missing before agreements, briefs, and production can move.';
  if (item.action_key === 'approve_terms') return 'Draft terms exist and need approval before the usage agreement goes out.';
  if (item.action_key === 'send_agreement') return 'Terms are approved. Prepare the usage agreement for signature.';
  if (item.action_key === 'await_agreement') return 'Agreement sent; acceptance is still outstanding.';
  if (item.action_key === 'await_footage') return 'Assignment is live; footage has not arrived yet.';
  if (item.action_key === 'add_contact') return 'Contact information is blocking the relationship.';
  if (item.action_key === 'add_shipping') return 'Shipping details are blocking product fulfillment.';
  if (item.action_key === 'seed_product') return 'The creative is defined; the creator still needs the product.';
  if (item.action_key === 'review_draft_brief') return `${item.draft_brief_count || 1} draft script${Number(item.draft_brief_count || 1) === 1 ? '' : 's'} must be edited and approved before assignment.`;
  if (item.action_key === 'send_assignment') return `${item.approved_unsent_brief_count || 1} approved brief${Number(item.approved_unsent_brief_count || 1) === 1 ? '' : 's'} ready for upload link and creator handoff.`;
  if (item.action_key === 'launch_asset') return 'The asset is complete. Launch it, then attribution can close the performance loop.';
  if (item.action_key === 'review_performance') return 'Use launch results to decide whether to rebook, iterate, or retire this creator angle.';
  return `${item.stage} creator · ${item.category}`;
}

function inlineActionLabel(item) {
  return ({
    review_draft_brief: 'Review script',
    send_assignment: 'Create upload link',
    finish_edit: 'Open editor',
    launch_asset: 'Open launch step',
    seed_product: 'Seed product',
  })[item.action_key];
}

export default function CreatorOperationsWorkspace({ canManage = false, onOpenCreator, onOpenEditor, onNavigate }) {
  const [data, setData] = useState({ items: [], summary: { categories: {} } });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/creator-operations');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load creator operations');
      setData(result);
    } catch (err) {
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const applyMappings = async () => {
    setApplying(true);
    setError('');
    try {
      const response = await fetch('/api/creator-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_clickup_status_mapping' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not apply ClickUp mappings');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  };

  const handleSetupAction = step => {
    if (step.key === 'clickup_mapping') return applyMappings();
    if (step.key === 'clickup_review') return setShowMappings(true);
    if (step.key === 'clickup_email') return onNavigate?.('clickup-import');
    if (step.key === 'duplicates' || step.key === 'profiles') return onNavigate?.('health');
    if (step.key === 'attribution') return onNavigate?.('creative-analytics');
    if (step.key === 'draft_briefs' || step.key === 'approved_unsent_briefs') return setFilter('creative');
    if (step.key === 'footage_needs_transcript' || step.key === 'footage_ready_to_edit') return onNavigate?.('ugc-editor');
    setError(`No action is configured for "${step.title || step.key}".`);
  };

  const handleInlineAction = (event, item) => {
    event.stopPropagation();
    if (item.action_key === 'finish_edit' && item.edit_session_id) return onOpenEditor?.(item.edit_session_id);
    return onOpenCreator?.(item, item.target_tab);
  };

  const handleInlineKeyDown = (event, item) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleInlineAction(event, item);
  };

  const visible = useMemo(() => data.items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return item.action_state === 'urgent';
    return item.category === filter;
  }), [data.items, filter]);

  const summary = data.summary || {};
  const setup = data.setup || {};
  return (
    <section className="creator-operations">
      <div className="operations-setup">
        <header>
          <div>
            <span>Do this next</span>
            <h2>Get the creator system operational</h2>
            <p>HOWL has ordered the cleanup by what unlocks the most useful workflow first.</p>
          </div>
          <strong>{setup.steps?.length || 0}<small>setup steps</small></strong>
        </header>
        <div className="operations-setup-steps">
          {(setup.steps || []).map((step, index) => (
            <article key={step.key} className={index === 0 ? 'primary' : ''}>
              <i>{index + 1}</i>
              <div>
                <span>{step.count} records</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </div>
              <button
                disabled={applying || (step.key === 'clickup_mapping' && !canManage)}
                onClick={() => handleSetupAction(step)}
              >
                {step.key === 'clickup_mapping' && applying ? 'Working…' : step.action}
              </button>
            </article>
          ))}
          {!loading && !setup.steps?.length && (
            <div className="operations-setup-complete">
              <strong>Core setup is clear.</strong>
              <p>The queue below now reflects actual creator work rather than import cleanup.</p>
            </div>
          )}
        </div>
        {!!setup.status_mappings?.length && (
          <div className="operations-mapping-review">
            <button onClick={() => setShowMappings(value => !value)}>
              <span>ClickUp status map</span>
              <small>
                {setup.review_status_count || 0} creators need review · {showMappings ? 'Hide' : 'View'} mappings
              </small>
            </button>
            {showMappings && (
              <div className="operations-mapping-table">
                <header><span>ClickUp status</span><span>Creators</span><span>HOWL stage</span><span>Confidence</span></header>
                {setup.status_mappings.map(mapping => (
                  <div key={mapping.raw_status} className={mapping.confidence}>
                    <strong>{mapping.raw_status}</strong>
                    <span>{mapping.count}</span>
                    <span>{mapping.stage} / {mapping.status}</span>
                    <i>{mapping.confidence === 'high' ? 'Verified' : 'Needs review'}</i>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
            {inlineActionLabel(item) ? (
              <span className="operations-inline-actions">
                <span
                  className="operations-inline-action"
                  role="button"
                  tabIndex={0}
                  onClick={event => handleInlineAction(event, item)}
                  onKeyDown={event => handleInlineKeyDown(event, item)}
                >
                  {inlineActionLabel(item)}
                </span>
              </span>
            ) : (
              <time>{dateLabel(item.action_date) || 'Open record'}</time>
            )}
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
