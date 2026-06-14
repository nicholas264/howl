import { useCallback, useEffect, useMemo, useState } from 'react';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function socialLine(record) {
  const accounts = Array.isArray(record.socials) ? record.socials : [];
  return accounts.find(item => item.platform === 'instagram') || accounts[0] || null;
}

function socialUrl(account) {
  if (account.profile_url?.startsWith('http')) return account.profile_url;
  const handle = (account.handle || '').trim();
  if (/^https?:\/\//i.test(handle)) return handle;
  const username = handle.replace(/^@/, '');
  if (!username) return null;
  if (account.platform === 'instagram') return `https://instagram.com/${username}`;
  if (account.platform === 'tiktok') return `https://tiktok.com/@${username}`;
  if (account.platform === 'youtube') return `https://youtube.com/@${username}`;
  return null;
}

function CandidateCard({ record, type, selected, onSelect }) {
  const social = socialLine(record);
  return (
    <button className={`talent-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(record)}>
      <span className="talent-avatar">
        {record.avatar_url ? <img src={record.avatar_url} alt="" /> : (record.name || '?').slice(0, 1)}
      </span>
      <span>
        <strong>{record.name || social?.handle || 'Unnamed prospect'}</strong>
        <small>{type === 'application' ? record.application_code : record.source?.replaceAll('_', ' ')}</small>
      </span>
      <span className={`talent-status status-${record.status}`}>{record.status}</span>
      <span className="talent-reach">{social?.followers ? compact.format(Number(social.followers)) : '—'}<small>{social?.handle ? `@${social.handle.replace(/^@/, '')}` : 'followers'}</small></span>
    </button>
  );
}

export default function CreatorAcquisitionWorkspace({ canManage = false, onPromoted }) {
  const [mode, setMode] = useState('applications');
  const [data, setData] = useState({ applications: [], candidates: [], counts: {} });
  const [selected, setSelected] = useState(null);
  const [discover, setDiscover] = useState({ handle: '', niche: '', fit_notes: '' });
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/creator-acquisition');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load talent inbox');
      setData(result);
      if (selected) {
        const records = mode === 'applications' ? result.applications : result.candidates;
        setSelected(records.find(item => item.id === selected.id) || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mode, selected?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(null); setNotes(''); }, [mode]);

  const records = mode === 'applications' ? data.applications : data.candidates;
  const visible = useMemo(
    () => records.filter(item => !['declined', 'archived'].includes(item.status)),
    [records],
  );

  const discoverInstagram = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-acquisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover_instagram', ...discover }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not discover creator');
      setDiscover({ handle: '', niche: '', fit_notes: '' });
      await load();
      setSelected(result.candidate);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const update = async (status) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-acquisition', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: mode === 'applications' ? 'application' : 'candidate',
          id: selected.id,
          status,
          review_notes: notes || selected.review_notes,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update review');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const promote = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-acquisition', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote',
          type: mode === 'applications' ? 'application' : 'candidate',
          id: selected.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not promote creator');
      onPromoted?.(result.creator);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="talent-workspace">
      <div className="talent-toolbar">
        <div className="talent-modes">
          <button className={mode === 'applications' ? 'active' : ''} onClick={() => setMode('applications')}>
            Applications <i>{data.counts?.new_applications || 0}</i>
          </button>
          <button className={mode === 'discovery' ? 'active' : ''} onClick={() => setMode('discovery')}>
            Discovery <i>{data.counts?.new_candidates || 0}</i>
          </button>
        </div>
        <a href="/apply" target="_blank" rel="noreferrer">Open application form ↗</a>
      </div>

      {mode === 'discovery' && canManage && (
        <form className="talent-discovery" onSubmit={discoverInstagram}>
          <div><span>Find a creator</span><strong>Start with an Instagram handle</strong></div>
          <input required placeholder="@creator" value={discover.handle} onChange={event => setDiscover({ ...discover, handle: event.target.value })} />
          <input placeholder="Niche or campaign fit" value={discover.niche} onChange={event => setDiscover({ ...discover, niche: event.target.value })} />
          <input placeholder="Why should we look?" value={discover.fit_notes} onChange={event => setDiscover({ ...discover, fit_notes: event.target.value })} />
          <button disabled={saving}>{saving ? 'Looking...' : 'Find + enrich'}</button>
        </form>
      )}

      {error && <div className="app-error">{error}</div>}
      <div className={`talent-layout ${selected ? 'detail-open' : ''}`}>
        <div className="talent-list">
          <header><span>{mode === 'applications' ? 'Inbound talent' : 'Sourced prospects'}</span><strong>{visible.length}</strong></header>
          {visible.map(record => (
            <CandidateCard
              key={record.id}
              record={record}
              type={mode === 'applications' ? 'application' : 'candidate'}
              selected={selected?.id === record.id}
              onSelect={record => { setSelected(record); setNotes(record.review_notes || ''); }}
            />
          ))}
          {!loading && !visible.length && (
            <div className="talent-empty">
              <strong>{mode === 'applications' ? 'The inbox is clear.' : 'No prospects saved yet.'}</strong>
              <p>{mode === 'applications' ? 'New creator applications will land here.' : 'Search a professional Instagram profile to start a review.'}</p>
            </div>
          )}
        </div>

        {selected && (
          <aside className="talent-detail">
            <button className="detail-close" onClick={() => setSelected(null)}>Close</button>
            <span className="workspace-kicker">{mode === 'applications' ? 'Creator application' : 'Discovery profile'}</span>
            <h2>{selected.name || socialLine(selected)?.handle}</h2>
            <p>{selected.location || selected.email || selected.source?.replaceAll('_', ' ')}</p>
            <div className="talent-detail-stats">
              <div><span>Audience</span><strong>{socialLine(selected)?.followers ? compact.format(Number(socialLine(selected).followers)) : '—'}</strong></div>
              <div><span>Engagement</span><strong>{socialLine(selected)?.engagement_rate ? `${Number(socialLine(selected).engagement_rate).toFixed(1)}%` : '—'}</strong></div>
              <div><span>Status</span><strong>{selected.status}</strong></div>
            </div>
            <dl className="talent-facts">
              <div><dt>Niche</dt><dd>{selected.niche || 'Not provided'}</dd></div>
              <div><dt>Strengths</dt><dd>{selected.strengths || 'Not provided'}</dd></div>
              {selected.audience_description && <div><dt>Audience</dt><dd>{selected.audience_description}</dd></div>}
              {selected.why_howl && <div><dt>Why HOWL</dt><dd>{selected.why_howl}</dd></div>}
              {selected.creator_experience && <div><dt>Experience</dt><dd>{selected.creator_experience}</dd></div>}
              {selected.fit_notes && <div><dt>Scout note</dt><dd>{selected.fit_notes}</dd></div>}
              {selected.rate_expectations && <div><dt>Rates</dt><dd>{selected.rate_expectations}</dd></div>}
            </dl>
            {(selected.socials || []).length > 0 && (
              <div className="talent-links">
                {selected.socials.map((account, index) => {
                  const url = socialUrl(account);
                  const label = `${account.platform} · ${account.handle}`;
                  return url
                    ? <a key={`${account.platform}-${index}`} href={url} target="_blank" rel="noreferrer">{label}</a>
                    : <span key={`${account.platform}-${index}`}>{label}</span>;
                })}
              </div>
            )}
            {(selected.sample_urls || []).length > 0 && (
              <div className="talent-links">
                {selected.sample_urls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Work sample {index + 1} ↗</a>)}
              </div>
            )}
            {canManage && (
              <>
                <label className="talent-notes">Internal review note<textarea rows="4" value={notes} onChange={event => setNotes(event.target.value)} /></label>
                <div className="talent-actions">
                  <button onClick={() => update('declined')} disabled={saving}>Decline</button>
                  <button onClick={() => update('reviewing')} disabled={saving}>Keep reviewing</button>
                  <button className="primary-action" onClick={promote} disabled={saving}>Promote to pipeline</button>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
