import { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_ROLES = {
  owner: 'Owner', admin: 'Admin', strategist: 'Strategist', producer: 'Producer',
  launcher: 'Launcher', analyst: 'Analyst', viewer: 'Viewer',
};

const DEFAULT_PERMISSIONS = {
  owner: ['*'],
  admin: ['creators read/write', 'briefs read/write', 'assets read/write', 'launch read/write', 'analytics read', 'admin users'],
  strategist: ['creators read/write', 'briefs read/write', 'assets read', 'analytics read'],
  producer: ['creators read', 'briefs read/write', 'assets read/write', 'launch read'],
  launcher: ['creators read', 'briefs read', 'assets read/write', 'launch read/write', 'analytics read'],
  analyst: ['creators read', 'assets read', 'launch read', 'analytics read'],
  viewer: ['creators read', 'briefs read', 'assets read', 'launch read', 'analytics read'],
};

export default function AdminWorkspace({ onOpenEditor }) {
  const [data, setData] = useState({
    users: [], invitations: [], feedback: [], audit_log: [],
    roles: DEFAULT_ROLES, permissions: DEFAULT_PERMISSIONS, integrations: {},
    health: { creative_analysis: {}, ugc: {}, outreach: {}, google_credentials: {}, overdue_deliverables: 0, ugc_failures: [] },
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingIntegrations, setCheckingIntegrations] = useState(false);
  const [integrationsCheckedAt, setIntegrationsCheckedAt] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load team');
      setData(result);
    } catch (err) {
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(() => data.invitations.filter(invite => invite.status === 'pending'), [data.invitations]);

  const invite = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send invitation');
      setEmail('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (userId, patch) => {
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...patch }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update user');
      setData(current => ({ ...current, users: current.users.map(user => user.user_id === userId ? result.user : user) }));
    } catch (err) {
      setError(err.message);
    }
  };

  const revoke = async (invitationId) => {
    try {
      const response = await fetch(`/api/admin?invitation_id=${invitationId}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not revoke invitation');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateFeedback = async (id, status) => {
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback', id, status }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update feedback');
      setData(current => ({
        ...current,
        feedback: current.feedback.map(item => item.id === id ? result.feedback : item),
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const testIntegrations = async () => {
    setCheckingIntegrations(true);
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_integrations' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not test integrations');
      setData(current => ({ ...current, integrations: result.integrations }));
      setIntegrationsCheckedAt(result.checked_at);
    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingIntegrations(false);
    }
  };

  return (
    <div className="admin-workspace">
      <header className="creator-head">
        <div>
          <span className="workspace-kicker">Administration</span>
          <h1>Team access</h1>
          <p>Invite people, assign the minimum role they need, and remove access without touching deployment settings.</p>
        </div>
      </header>

      {error && <div className="app-error">{error}</div>}

      <div className="admin-grid">
        <section className="admin-panel">
          <div className="admin-panel-head"><div><span>Active team</span><strong>{data.users.length}</strong></div><small>Access is enforced in the API and interface.</small></div>
          <div className="team-table">
            <div className="team-table-head"><span>User</span><span>Role</span><span>Status</span><span>Last seen</span></div>
            {data.users.map(user => (
              <div className="team-row" key={user.user_id}>
                <span><strong>{user.display_name || user.email}</strong><small>{user.display_name ? user.email : user.user_id}</small></span>
                <select value={user.role} disabled={user.role === 'owner'} onChange={event => updateUser(user.user_id, { role: event.target.value })}>
                  {Object.entries(data.roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button className={`account-status ${user.status}`} disabled={user.role === 'owner'} onClick={() => updateUser(user.user_id, { status: user.status === 'active' ? 'suspended' : 'active' })}>
                  {user.status}
                </button>
                <time>{user.last_seen_at ? new Date(user.last_seen_at).toLocaleDateString() : 'Never'}</time>
              </div>
            ))}
            {!loading && !data.users.length && <div className="creator-empty"><p>No team members found.</p></div>}
          </div>
        </section>

        <aside className="admin-side">
          <section className="admin-panel invite-panel">
            <div className="admin-panel-head"><div><span>Invite user</span></div><small>Clerk sends a secure sign-in invitation.</small></div>
            <form onSubmit={invite}>
              <label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label>
              <label>Role<select value={role} onChange={event => setRole(event.target.value)}>{Object.entries(data.roles).filter(([key]) => key !== 'owner').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <button className="primary-action" disabled={saving}>{saving ? 'Sending...' : 'Send invitation'}</button>
            </form>
          </section>

          <section className="admin-panel">
            <div className="admin-panel-head"><div><span>Pending</span><strong>{pending.length}</strong></div></div>
            <div className="pending-list">
              {pending.map(invite => (
                <div key={invite.id}><span><strong>{invite.email}</strong><small>{data.roles[invite.role] || invite.role}</small></span><button onClick={() => revoke(invite.id)}>Revoke</button></div>
              ))}
              {!pending.length && <p>No pending invitations.</p>}
            </div>
          </section>
        </aside>
      </div>

      <section className="admin-panel role-matrix">
        <div className="admin-panel-head"><div><span>Role scope</span></div><small>Roles stay opinionated so permissions remain understandable.</small></div>
        <div className="role-grid">
          {Object.entries(data.roles).map(([key, label]) => (
            <div key={key}>
              <strong>{label}</strong>
              <p>{data.permissions[key]?.includes('*') ? 'Full application and administrative access.' : data.permissions[key]?.map(item => item.replace('.', ' ')).join(' · ')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-feedback-panel">
        <div className="admin-panel-head">
          <div><span>Product inbox</span><strong>{data.feedback.filter(item => item.status === 'open').length}</strong></div>
          <small>Bug reports and feature requests submitted inside HOWL.</small>
        </div>
        <div className="admin-feedback-list">
          {data.feedback.map(item => (
            <article key={item.id} className={`admin-feedback-item ${item.status}`}>
              <div>
                <span>{item.kind.replace('_', ' ')}</span>
                <strong>{item.message}</strong>
                <small>{item.email || 'Unknown user'} · {new Date(item.created_at).toLocaleString()}</small>
              </div>
              <select value={item.status} onChange={event => updateFeedback(item.id, event.target.value)}>
                <option value="open">Open</option>
                <option value="planned">Planned</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </article>
          ))}
          {!loading && !data.feedback.length && <div className="workflow-empty">No product feedback yet.</div>}
        </div>
      </section>

      <section className="admin-panel admin-audit-panel">
        <div className="admin-panel-head">
          <div><span>Access activity</span></div>
          <small>Recent administrative changes.</small>
        </div>
        <div className="admin-audit-list">
          {data.audit_log.map(item => (
            <div key={item.id}>
              <span>{item.action.replace('.', ' ')}</span>
              <strong>{item.target || 'HOWL workspace'}</strong>
              <small>{item.actor_email || 'System'} · {new Date(item.created_at).toLocaleString()}</small>
            </div>
          ))}
          {!loading && !data.audit_log.length && <div className="workflow-empty">No administrative changes recorded yet.</div>}
        </div>
      </section>

      <section className="admin-panel admin-health-panel">
        <div className="admin-panel-head">
          <div><span>Workflow health</span></div>
          <small>Persisted failures and stalled work that need attention.</small>
        </div>
        <div className="admin-health-grid">
          <div className={data.health.creative_analysis.failed ? 'attention' : ''}>
            <span>Creative analysis</span>
            <strong>{data.health.creative_analysis.failed || 0} failed</strong>
            <small>{data.health.creative_analysis.pending || 0} waiting · {data.health.creative_analysis.processing || 0} running</small>
          </div>
          <div className={(data.health.ugc.failed || data.health.ugc.stale) ? 'attention' : ''}>
            <span>UGC processing</span>
            <strong>{data.health.ugc.failed || 0} failed</strong>
            <small>{data.health.ugc.processing || 0} running · {data.health.ugc.stale || 0} stalled</small>
          </div>
          <div className={(data.health.outreach?.due || data.health.outreach?.stale) ? 'attention' : ''}>
            <span>Creator follow-ups</span>
            <strong>{data.health.outreach?.due || 0} due</strong>
            <small>{data.health.outreach?.stale || 0} more than 7 days late</small>
          </div>
          <div>
            <span>User Google connections</span>
            <strong>{data.health.google_credentials?.connected_users || 0} connected</strong>
            <small>{data.health.google_credentials?.last_used_at ? `Last used ${new Date(data.health.google_credentials.last_used_at).toLocaleDateString()}` : 'No stored user credentials'}</small>
          </div>
          <div className={data.health.overdue_deliverables ? 'attention' : ''}>
            <span>Deliverables</span>
            <strong>{data.health.overdue_deliverables || 0} overdue</strong>
            <small>Open creator work past its due date</small>
          </div>
        </div>
        {!!data.health.ugc_failures.length && (
          <div className="admin-health-failures">
            {data.health.ugc_failures.map(item => (
              <button key={item.id} onClick={() => onOpenEditor?.(item.id)}>
                <span><strong>{item.title || `UGC session ${item.id}`}</strong><small>{item.creator_name || item.created_by_email || 'Unassigned creator'}</small></span>
                <i>{item.status.replace('_', ' ')}</i>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="admin-panel integration-panel">
        <div className="admin-panel-head integration-panel-head">
          <div><span>System connections</span></div>
          <div className="integration-head-action">
            {integrationsCheckedAt && <small>Checked {new Date(integrationsCheckedAt).toLocaleTimeString()}</small>}
            <button onClick={testIntegrations} disabled={checkingIntegrations}>
              {checkingIntegrations ? 'Checking...' : 'Run checks'}
            </button>
          </div>
        </div>
        <div className="integration-grid">
          {Object.entries(data.integrations || {}).map(([key, item]) => (
            <div key={key} className={`integration-card ${item.state || (item.ready ? 'ready' : 'setup')}`}>
              <span className={item.state || (item.ready ? 'ready' : 'setup')}>
                {item.state === 'warning' ? 'Action' : item.state === 'error' ? 'Error' : item.ready ? 'Ready' : 'Setup'}
              </span>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
              {item.action && <small>{item.action}</small>}
              {!!item.env?.length && !item.ready && <code>{item.env.join(' + ')}</code>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
