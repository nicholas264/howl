import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';

const STAGES = [
  ['all', 'All'],
  ['sourced', 'Sourced'],
  ['contacted', 'Contacted'],
  ['interested', 'Interested'],
  ['briefing', 'Briefing'],
  ['producing', 'Producing'],
  ['active', 'Active'],
  ['alumni', 'Alumni'],
];

const EMPTY_CREATOR = {
  name: '', email: '', phone: '', location: '', stage: 'sourced',
  status: 'prospect', activities: '', tags: '', bio: '', rate_notes: '', notes: '',
};

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function displayMetric(value) {
  return value === null || value === undefined ? '—' : compact.format(Number(value));
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function CreatorAvatar({ creator, large = false }) {
  return creator.avatar_url
    ? <img className={`creator-avatar ${large ? 'large' : ''}`} src={creator.avatar_url} alt="" />
    : <div className={`creator-avatar fallback ${large ? 'large' : ''}`}>{initials(creator.name)}</div>;
}

export default function CreatorWorkspace({ canWrite = false }) {
  const { getToken } = useAuth();
  const [creators, setCreators] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stage, setStage] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [clickupConfigured, setClickupConfigured] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATOR);
  const [note, setNote] = useState('');
  const [social, setSocial] = useState({ platform: 'instagram', handle: '', profile_url: '', followers: '', avg_views: '', engagement_rate: '' });
  const [detailTab, setDetailTab] = useState('profile');
  const [workflow, setWorkflow] = useState({ briefs: [], outreach: [], deliverables: [] });
  const [briefForm, setBriefForm] = useState({ product: '', objective: '', angle: '', direction: '', strategy_mode: 'past_performers' });
  const [outreach, setOutreach] = useState({ channel: 'email', subject: '', body: '', status: 'draft' });
  const [gmailConnected, setGmailConnected] = useState(() => document.cookie.split('; ').some(cookie => cookie.startsWith('gmail_connected=1')));
  const [deliverable, setDeliverable] = useState({ title: '', due_at: '', source_url: '' });
  const [uploadProgress, setUploadProgress] = useState(0);

  const loadCreators = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (stage !== 'all') params.set('stage', stage);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/creators?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load creators');
      setCreators(data.creators || []);
      if (selected) {
        const next = data.creators?.find(item => item.id === selected.id);
        if (next) setSelected(prev => ({ ...prev, ...next }));
      }
    } catch (err) {
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, selected?.id, stage]);

  useEffect(() => {
    const timer = setTimeout(loadCreators, 180);
    return () => clearTimeout(timer);
  }, [loadCreators]);

  useEffect(() => {
    fetch('/api/creators-import')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setClickupConfigured(Boolean(data.clickup_configured)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/creator-email')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setGmailConnected(Boolean(data.connected)))
      .catch(() => {});
  }, []);

  const counts = useMemo(() => creators.reduce((result, creator) => {
    result[creator.stage] = (result[creator.stage] || 0) + 1;
    return result;
  }, {}), [creators]);

  const openCreator = async (creator) => {
    setError('');
    try {
      const response = await fetch(`/api/creators?id=${creator.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load creator');
      setSelected(data.creator);
      setDetailTab('profile');
      const workflowResponse = await fetch(`/api/creator-workflow?creator_id=${creator.id}`);
      const workflowData = await workflowResponse.json();
      if (workflowResponse.ok) setWorkflow(workflowData);
    } catch (err) {
      setError(err.message);
    }
  };

  const refreshWorkflow = async (creatorId = selected?.id) => {
    if (!creatorId) return;
    const response = await fetch(`/api/creator-workflow?creator_id=${creatorId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load creator workflow');
    setWorkflow(data);
  };

  const generateBrief = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_brief', creator_id: selected.id, ...briefForm }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate brief');
      setWorkflow(data.workflow);
      setDetailTab('briefs');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveOutreach = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'outreach', creator_id: selected.id, ...outreach }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save outreach');
      setWorkflow(data.workflow);
      setOutreach({ channel: 'email', subject: '', body: '', status: 'draft' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    if (!selected?.email) {
      setError('Add an email address to this creator before sending.');
      return;
    }
    if (!outreach.subject.trim() || !outreach.body.trim()) {
      setError('Subject and message are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: selected.id,
          to: selected.email,
          subject: outreach.subject,
          body: outreach.body,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.reconnect_required) setGmailConnected(false);
        throw new Error(data.error || 'Could not send email');
      }
      setOutreach({ channel: 'email', subject: '', body: '', status: 'draft' });
      await refreshWorkflow(selected.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const draftOutreach = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_outreach',
          creator_id: selected.id,
          purpose: outreach.body || 'Introduce HOWL and explore a paid creator partnership',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not draft outreach');
      setWorkflow(data.workflow);
      setOutreach(current => ({ ...current, channel: 'email', subject: data.message.subject || '', body: data.message.body || '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addDeliverable = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deliverable', creator_id: selected.id, ...deliverable }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add deliverable');
      setWorkflow(data.workflow);
      setDeliverable({ title: '', due_at: '', source_url: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadFootage = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Creator footage must be a video file.');
      return;
    }
    setSaving(true);
    setUploadProgress(0);
    setError('');
    try {
      const token = await getToken();
      const blob = await upload(`creator-footage/${selected.id}/${Date.now()}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload-token',
        clientPayload: token,
        contentType: file.type,
        onUploadProgress: event => {
          if (event?.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      const sessionResponse = await fetch('/api/db/ugc-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${selected.name} - ${deliverable.title || file.name}`,
          file_name: file.name,
          file_size: file.size,
          video_url: blob.url,
          status: 'uploaded',
          creator_id: selected.id,
        }),
      });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionData.error || 'Could not create editor session');
      const deliverableResponse = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deliverable',
          creator_id: selected.id,
          title: deliverable.title || file.name,
          due_at: deliverable.due_at || null,
          source_url: blob.url,
          ugc_session_id: sessionData.session.id,
          status: 'received',
        }),
      });
      const workflowData = await deliverableResponse.json();
      if (!deliverableResponse.ok) throw new Error(workflowData.error || 'Could not connect footage');
      setWorkflow(workflowData.workflow);
      setDeliverable({ title: '', due_at: '', source_url: '' });
      setUploadProgress(100);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const importCsv = (file) => {
    if (!file) return;
    setSaving(true);
    setImportResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data, errors }) => {
        try {
          if (errors.length && !data.length) throw new Error(errors[0].message);
          const response = await fetch('/api/creators-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: data }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Import failed');
          setImportResult(result);
          await loadCreators();
        } catch (err) {
          setError(err.message);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const syncClickup = async () => {
    setSaving(true);
    setImportResult(null);
    setError('');
    try {
      const response = await fetch('/api/creators-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clickup_sync' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ClickUp sync failed');
      setImportResult(result);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createCreator = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create creator');
      setShowCreate(false);
      setForm(EMPTY_CREATOR);
      setSelected(data.creator);
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateCreator = async (patch) => {
    if (!selected) return;
    const optimistic = { ...selected, ...patch };
    setSelected(optimistic);
    try {
      const response = await fetch('/api/creators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, ...patch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update creator');
      setSelected(data.creator);
      await loadCreators();
    } catch (err) {
      setSelected(selected);
      setError(err.message);
    }
  };

  const addNote = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activity', creator_id: selected.id, kind: 'note', summary: note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add note');
      setSelected(data.creator);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSocial = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/creators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action: 'social', ...social }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save social account');
      setSelected(data.creator);
      setSocial({ platform: 'instagram', handle: '', profile_url: '', followers: '', avg_views: '', engagement_rate: '' });
      await loadCreators();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="creator-workspace">
      <header className="creator-head">
        <div>
          <span className="workspace-kicker">Creator operations</span>
          <h1>Creators</h1>
          <p>Source, qualify, brief, produce, and measure creator relationships in one record.</p>
        </div>
        {canWrite && <div className="creator-head-actions"><button onClick={() => setShowImport(true)}>Import</button><button className="primary-action" onClick={() => setShowCreate(true)}>Add creator</button></div>}
      </header>

      <div className="creator-toolbar">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or email" />
        <div className="creator-stage-tabs">
          {STAGES.map(([key, label]) => (
            <button key={key} className={stage === key ? 'active' : ''} onClick={() => setStage(key)}>
              {label}{key !== 'all' && counts[key] ? ` ${counts[key]}` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="app-error">{error}</div>}

      <div className={`creator-layout ${selected ? 'detail-open' : ''}`}>
        <section className="creator-list-panel">
          <div className="creator-list-head">
            <span>{loading ? 'Loading' : `${creators.length} creators`}</span>
            <span>Relationship / Reach</span>
          </div>
          {!loading && creators.length === 0 && (
            <div className="creator-empty">
              <strong>No creators here yet.</strong>
              <p>Add the first record or change the current filter.</p>
            </div>
          )}
          {creators.map(creator => {
            const primarySocial = creator.social_accounts?.[0];
            return (
              <button key={creator.id} className={`creator-row ${selected?.id === creator.id ? 'active' : ''}`} onClick={() => openCreator(creator)}>
                <CreatorAvatar creator={creator} />
                <span className="creator-row-name">
                  <strong>{creator.name}</strong>
                  <small>{creator.location || creator.email || 'Profile incomplete'}</small>
                </span>
                <span className={`creator-stage stage-${creator.stage}`}>{creator.stage}</span>
                <span className="creator-reach">
                  <strong>{displayMetric(primarySocial?.followers)}</strong>
                  <small>{primarySocial?.platform || 'no social'}</small>
                </span>
                <span className="creator-launches">
                  <strong>{creator.launch_count || 0}</strong>
                  <small>launches</small>
                </span>
              </button>
            );
          })}
        </section>

        {selected && (
          <aside className="creator-detail">
            <button className="detail-close" onClick={() => setSelected(null)} aria-label="Close creator detail">Close</button>
            <div className="creator-identity">
              <CreatorAvatar creator={selected} large />
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.email || 'No email'}{selected.location ? ` · ${selected.location}` : ''}</p>
              </div>
            </div>

            <div className="creator-status-row">
              <label>
                Stage
                <select value={selected.stage} disabled={!canWrite} onChange={event => updateCreator({ stage: event.target.value })}>
                  {STAGES.slice(1).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={selected.status} disabled={!canWrite} onChange={event => updateCreator({ status: event.target.value })}>
                  <option value="prospect">Prospect</option>
                  <option value="qualified">Qualified</option>
                  <option value="contracted">Contracted</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <div className="creator-performance">
              <div><span>Spend · 90d</span><strong>${Number(selected.performance?.spend || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
              <div><span>Revenue · 90d</span><strong>${Number(selected.performance?.revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
              <div><span>ROAS</span><strong>{Number(selected.performance?.spend) > 0 ? (Number(selected.performance.revenue) / Number(selected.performance.spend)).toFixed(2) : '—'}</strong></div>
            </div>

            <div className="creator-detail-tabs">
              {['profile', 'briefs', 'outreach', 'deliverables'].map(tab => (
                <button key={tab} className={detailTab === tab ? 'active' : ''} onClick={() => setDetailTab(tab)}>
                  {tab}{tab === 'briefs' && workflow.briefs.length ? ` ${workflow.briefs.length}` : ''}
                </button>
              ))}
            </div>

            {detailTab === 'profile' && <>
            <section className="creator-detail-section">
              <div className="detail-section-head">
                <span>Social intelligence</span>
                <small>{selected.social_accounts?.length || 0} accounts</small>
              </div>
              <div className="social-account-grid">
                {selected.social_accounts?.map(account => (
                  <a key={account.id} href={account.profile_url || undefined} target="_blank" rel="noreferrer" className="social-account">
                    <span>{account.platform}</span>
                    <strong>{account.handle || 'Profile'}</strong>
                    <div><b>{displayMetric(account.followers)}</b><small>followers</small></div>
                    <div><b>{displayMetric(account.avg_views)}</b><small>avg views</small></div>
                    <div><b>{account.engagement_rate == null ? '—' : `${account.engagement_rate}%`}</b><small>engagement</small></div>
                  </a>
                ))}
              </div>
              {canWrite && (
                <details className="inline-editor">
                  <summary>Add or update account</summary>
                  <form onSubmit={saveSocial}>
                    <select value={social.platform} onChange={event => setSocial({ ...social, platform: event.target.value })}>
                      <option value="instagram">Instagram</option>
                      <option value="tiktok">TikTok</option>
                      <option value="youtube">YouTube</option>
                      <option value="facebook">Facebook</option>
                      <option value="other">Other</option>
                    </select>
                    <input placeholder="@handle" value={social.handle} onChange={event => setSocial({ ...social, handle: event.target.value })} />
                    <input placeholder="Profile URL" value={social.profile_url} onChange={event => setSocial({ ...social, profile_url: event.target.value })} />
                    <input type="number" placeholder="Followers" value={social.followers} onChange={event => setSocial({ ...social, followers: event.target.value })} />
                    <input type="number" placeholder="Avg views" value={social.avg_views} onChange={event => setSocial({ ...social, avg_views: event.target.value })} />
                    <input type="number" step="0.01" placeholder="Engagement %" value={social.engagement_rate} onChange={event => setSocial({ ...social, engagement_rate: event.target.value })} />
                    <button disabled={saving}>Save account</button>
                  </form>
                </details>
              )}
            </section>

            <section className="creator-detail-section">
              <div className="detail-section-head"><span>Creator context</span></div>
              <dl className="creator-facts">
                <div><dt>Activities</dt><dd>{selected.activities?.join(', ') || 'Not set'}</dd></div>
                <div><dt>Tags</dt><dd>{selected.tags?.join(', ') || 'Not set'}</dd></div>
                <div><dt>Rates</dt><dd>{selected.rate_notes || 'Not set'}</dd></div>
                <div><dt>Bio</dt><dd>{selected.bio || 'Not set'}</dd></div>
              </dl>
            </section>

            <section className="creator-detail-section">
              <div className="detail-section-head">
                <span>Activity</span>
                <small>{selected.launch_count || 0} launched assets</small>
              </div>
              {canWrite && (
                <form className="creator-note-form" onSubmit={addNote}>
                  <input value={note} onChange={event => setNote(event.target.value)} placeholder="Add a useful note" />
                  <button disabled={saving || !note.trim()}>Add</button>
                </form>
              )}
              <div className="creator-timeline">
                {selected.activity?.map(item => (
                  <div key={item.id}>
                    <i />
                    <span><strong>{item.summary}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span>
                  </div>
                ))}
                {!selected.activity?.length && <p>No activity recorded yet.</p>}
              </div>
            </section>
            </>}

            {detailTab === 'briefs' && (
              <section className="creator-detail-section workflow-section">
                {canWrite && (
                  <form className="workflow-form" onSubmit={generateBrief}>
                    <div className="detail-section-head"><span>Generate from creator context</span><small>AI grounded in this profile and launch history</small></div>
                    <input required placeholder="Product" value={briefForm.product} onChange={event => setBriefForm({ ...briefForm, product: event.target.value })} />
                    <input placeholder="Objective" value={briefForm.objective} onChange={event => setBriefForm({ ...briefForm, objective: event.target.value })} />
                    <input placeholder="Angle or leave open" value={briefForm.angle} onChange={event => setBriefForm({ ...briefForm, angle: event.target.value })} />
                    <select value={briefForm.strategy_mode} onChange={event => setBriefForm({ ...briefForm, strategy_mode: event.target.value })}>
                      <option value="past_performers">Use past performers</option>
                      <option value="net_new">Build net new</option>
                    </select>
                    <textarea rows="3" placeholder="Additional direction" value={briefForm.direction} onChange={event => setBriefForm({ ...briefForm, direction: event.target.value })} />
                    <button className="primary-action" disabled={saving}>{saving ? 'Building brief...' : 'Generate brief + script'}</button>
                  </form>
                )}
                <div className="workflow-list">
                  {workflow.briefs.map(brief => (
                    <details key={brief.id} className="workflow-card" open={workflow.briefs[0]?.id === brief.id}>
                      <summary><span><strong>{brief.title}</strong><small>{brief.product || brief.angle || 'Creator brief'}</small></span><i>{brief.status}</i></summary>
                      <div className="workflow-card-body">
                        <h4>Brief</h4><p className="prewrap">{brief.brief}</p>
                        <h4>Script</h4><p className="prewrap">{brief.script}</p>
                        {!!brief.deliverables?.length && <><h4>Deliverables</h4><ul>{brief.deliverables.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
                      </div>
                    </details>
                  ))}
                  {!workflow.briefs.length && <div className="workflow-empty">No briefs yet. Generate one from the creator's actual context.</div>}
                </div>
              </section>
            )}

            {detailTab === 'outreach' && (
              <section className="creator-detail-section workflow-section">
                {canWrite && (
                  <form className="workflow-form" onSubmit={saveOutreach}>
                    <div className="detail-section-head"><span>Outreach</span><small>Email connection is credential-ready</small></div>
                    <div className="workflow-two">
                      <select value={outreach.channel} onChange={event => setOutreach({ ...outreach, channel: event.target.value })}><option value="email">Email</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="phone">Phone</option></select>
                      <select value={outreach.status} onChange={event => setOutreach({ ...outreach, status: event.target.value })}><option value="draft">Save draft</option><option value="sent">Mark sent</option></select>
                    </div>
                    <input placeholder="Subject" value={outreach.subject} onChange={event => setOutreach({ ...outreach, subject: event.target.value })} />
                    <textarea required rows="5" placeholder="Write the message" value={outreach.body} onChange={event => setOutreach({ ...outreach, body: event.target.value })} />
                    <div className="outreach-actions">
                      <button className="primary-action" disabled={saving}>Save outreach</button>
                      <button type="button" disabled={saving} onClick={draftOutreach}>Draft with AI</button>
                      {gmailConnected
                        ? <button type="button" disabled={saving || outreach.channel !== 'email'} onClick={sendEmail}>Send with Gmail</button>
                        : <a href="/api/auth/google?purpose=creator_email">Connect Gmail</a>}
                    </div>
                  </form>
                )}
                <div className="workflow-list">
                  {workflow.outreach.map(message => (
                    <article className="workflow-card outreach-card" key={message.id}>
                      <header><span><strong>{message.subject || `${message.channel} outreach`}</strong><small>{new Date(message.created_at).toLocaleString()}</small></span><i>{message.status}</i></header>
                      <p>{message.body}</p>
                    </article>
                  ))}
                  {!workflow.outreach.length && <div className="workflow-empty">No outreach recorded.</div>}
                </div>
              </section>
            )}

            {detailTab === 'deliverables' && (
              <section className="creator-detail-section workflow-section">
                {canWrite && (
                  <form className="workflow-form" onSubmit={addDeliverable}>
                    <div className="detail-section-head"><span>Footage and deliverables</span><small>Connect raw footage to editing and launch</small></div>
                    <input required placeholder="Deliverable title" value={deliverable.title} onChange={event => setDeliverable({ ...deliverable, title: event.target.value })} />
                    <input type="datetime-local" value={deliverable.due_at} onChange={event => setDeliverable({ ...deliverable, due_at: event.target.value })} />
                    <input placeholder="Drive or asset URL" value={deliverable.source_url} onChange={event => setDeliverable({ ...deliverable, source_url: event.target.value })} />
                    <button className="primary-action" disabled={saving}>Add deliverable</button>
                  </form>
                )}
                {canWrite && (
                  <label className="creator-footage-upload">
                    <input type="file" accept="video/*" onChange={event => uploadFootage(event.target.files?.[0])} />
                    <strong>{saving && uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Upload creator footage'}</strong>
                    <span>Creates a linked UGC Editor session automatically.</span>
                  </label>
                )}
                <div className="workflow-list">
                  {workflow.deliverables.map(item => (
                    <article className="workflow-card deliverable-card" key={item.id}>
                      <header><span><strong>{item.title}</strong><small>{item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : 'No due date'}</small></span><i>{item.status}</i></header>
                      {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">Open source asset</a>}
                      {item.ugc_session_id && <span className="editor-linked">UGC Editor session #{item.ugc_session_id}</span>}
                    </article>
                  ))}
                  {!workflow.deliverables.length && <div className="workflow-empty">No deliverables requested or received.</div>}
                </div>
              </section>
            )}
          </aside>
        )}
      </div>

      {showCreate && (
        <div className="app-modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <form className="app-modal" onSubmit={createCreator} onMouseDown={event => event.stopPropagation()}>
            <header><div><span className="workspace-kicker">New relationship</span><h2>Add creator</h2></div><button type="button" onClick={() => setShowCreate(false)}>Close</button></header>
            <div className="app-form-grid">
              <label className="wide">Name<input autoFocus required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
              <label>Location<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} /></label>
              <label>Stage<select value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}>{STAGES.slice(1).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="wide">Activities<input placeholder="running, hunting, overlanding" value={form.activities} onChange={event => setForm({ ...form, activities: event.target.value })} /></label>
              <label className="wide">Tags<input placeholder="Colorado, truck, technical" value={form.tags} onChange={event => setForm({ ...form, tags: event.target.value })} /></label>
              <label className="wide">Bio<textarea rows="3" value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} /></label>
              <label className="wide">Rate notes<textarea rows="2" value={form.rate_notes} onChange={event => setForm({ ...form, rate_notes: event.target.value })} /></label>
            </div>
            <footer><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary-action" disabled={saving}>{saving ? 'Adding...' : 'Add creator'}</button></footer>
          </form>
        </div>
      )}
      {showImport && (
        <div className="app-modal-backdrop" onMouseDown={() => setShowImport(false)}>
          <div className="app-modal import-modal" onMouseDown={event => event.stopPropagation()}>
            <header><div><span className="workspace-kicker">ClickUp intake</span><h2>Import creators</h2></div><button onClick={() => setShowImport(false)}>Close</button></header>
            <div className="import-body">
              <p>Export your ClickUp applicant list as CSV. HOWL recognizes common columns including name, email, phone, location, activities, tags, notes, and task ID.</p>
              <label className="import-drop">
                <input type="file" accept=".csv,text/csv" onChange={event => importCsv(event.target.files?.[0])} />
                <strong>{saving ? 'Importing...' : 'Choose ClickUp CSV'}</strong>
                <span>Existing records update by ClickUp task ID or email.</span>
              </label>
              <div className="clickup-sync-row">
                <span>{clickupConfigured ? 'Direct ClickUp sync is connected.' : 'Direct sync needs CLICKUP_API_TOKEN and CLICKUP_CREATOR_LIST_ID.'}</span>
                <button disabled={!clickupConfigured || saving} onClick={syncClickup}>Sync ClickUp</button>
              </div>
              {importResult && <div className="import-result"><strong>{importResult.created} created</strong><strong>{importResult.updated} updated</strong><span>{importResult.skipped?.length || 0} skipped</span></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
