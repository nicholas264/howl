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

export default function AdminWorkspace() {
  const [data, setData] = useState({ users: [], invitations: [], roles: DEFAULT_ROLES, permissions: DEFAULT_PERMISSIONS, integrations: {} });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

      <section className="admin-panel integration-panel">
        <div className="admin-panel-head"><div><span>System connections</span></div><small>Only dependencies that affect live workflows are shown.</small></div>
        <div className="integration-grid">
          {Object.entries(data.integrations || {}).map(([key, item]) => (
            <div key={key}>
              <span className={item.ready ? 'ready' : 'setup'}>{item.ready ? 'Ready' : 'Setup'}</span>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
