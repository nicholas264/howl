import { useEffect, useMemo, useState } from 'react';

const FILTERS = [
  ['all', 'All'],
  ['email', 'Missing email'],
  ['social', 'Missing social'],
  ['intelligence', 'Missing intelligence'],
  ['product', 'Missing product'],
  ['rates', 'Missing rates'],
];

function profileMatches(record, filter) {
  if (filter === 'email') return record.missing.includes('Email');
  if (filter === 'social') return record.missing.includes('Social');
  if (filter === 'product') return record.missing.includes('Product');
  if (filter === 'rates') return record.missing.includes('Rates');
  if (filter === 'intelligence') return ['Niche', 'Strengths', 'Audience'].some(item => record.missing.includes(item));
  return true;
}

export default function CreatorDataHealthWorkspace({ canMerge = false, onOpenCreator }) {
  const [data, setData] = useState({ summary: {}, duplicate_groups: [], incomplete_profiles: [], archived_creators: [] });
  const [mode, setMode] = useState('duplicates');
  const [filter, setFilter] = useState('all');
  const [merge, setMerge] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [archiveConfirmation, setArchiveConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/creator-data-health');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load creator data health');
      setData(result);
    } catch (err) {
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const profiles = useMemo(
    () => data.incomplete_profiles.filter(record => profileMatches(record, filter)),
    [data.incomplete_profiles, filter],
  );

  const startMerge = (group, primaryId, duplicateId) => {
    setMerge({ group, primaryId: Number(primaryId), duplicateId: Number(duplicateId) });
    setConfirmation('');
    setError('');
  };

  const confirmMerge = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-data-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'merge',
          primary_id: merge.primaryId,
          duplicate_id: merge.duplicateId,
          confirmation,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not merge creator records');
      setData(result.health);
      setMerge(null);
      setConfirmation('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const archiveLegacyCreators = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-data-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archive_legacy_imports',
          confirmation: archiveConfirmation,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not archive legacy creator records');
      setData(result.health);
      setArchiveConfirmation('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const restoreCreator = async creatorId => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-data-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', creator_id: creatorId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not restore creator');
      setData(result.health);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openCreator = record => {
    if (onOpenCreator) return onOpenCreator(record);
    setError('Creator navigation is not available from this view.');
  };

  const summary = data.summary || {};
  return (
    <section className="creator-data-health">
      <div className="health-scorecard">
        <div><span>Active records</span><strong>{summary.total || 0}</strong><small>non-inactive creators</small></div>
        <div className={summary.duplicate_groups ? 'risk' : ''}><span>Exact duplicate groups</span><strong>{summary.duplicate_groups || 0}</strong><small>same email or social handle</small></div>
        <div><span>Average completeness</span><strong>{summary.average_completeness || 0}%</strong><small>contact, context, product, social</small></div>
        <div className={summary.missing_email ? 'warning' : ''}><span>Missing email</span><strong>{summary.missing_email || 0}</strong><small>cannot receive outreach</small></div>
        <div><span>Archived records</span><strong>{summary.archived_total || 0}</strong><small>accessible outside active workflow</small></div>
      </div>

      <div className="health-switch">
        <button className={mode === 'duplicates' ? 'active' : ''} onClick={() => setMode('duplicates')}>Duplicate review <i>{summary.duplicate_groups || 0}</i></button>
        <button className={mode === 'profiles' ? 'active' : ''} onClick={() => setMode('profiles')}>Profile completeness</button>
        <button className={mode === 'archive' ? 'active' : ''} onClick={() => setMode('archive')}>Archive <i>{summary.archived_total || 0}</i></button>
      </div>

      {error && <div className="app-error">{error}</div>}
      {mode === 'duplicates' ? (
        <div className="duplicate-groups">
          {data.duplicate_groups.map(group => (
            <article key={`${group.platform}-${group.match_key}`} className="duplicate-group">
              <header>
                <span><i>{group.platform}</i><strong>{group.match_key}</strong></span>
                <small>{group.records.length} records share this exact identity</small>
              </header>
              <div>
                {group.records.map((record, index) => (
                  <section key={record.id} className={index === 0 ? 'recommended' : ''}>
                    <button type="button" className="duplicate-record" onClick={() => openCreator(record)}>
                      <span className="duplicate-avatar">{record.name?.slice(0, 1) || '?'}</span>
                      <span><strong>{record.name}</strong><small>{record.email || record.location || 'No contact details'}</small></span>
                      <span><b>{record.followers ? Number(record.followers).toLocaleString() : '—'}</b><small>followers</small></span>
                      <span><b>{record.relationship_count || 0}</b><small>activity</small></span>
                      <i>{record.stage}</i>
                    </button>
                    {canMerge && index > 0 && (
                      <button type="button" className="merge-start" onClick={() => startMerge(group, group.records[0].id, record.id)}>
                        Merge into {group.records[0].name}
                      </button>
                    )}
                    {index === 0 && <em>Suggested primary</em>}
                  </section>
                ))}
              </div>
            </article>
          ))}
          {!loading && !data.duplicate_groups.length && <div className="health-empty"><strong>No exact duplicates found.</strong><p>Email and social identities are currently unique.</p></div>}
          {!canMerge && data.duplicate_groups.length > 0 && <p className="health-permission-note">Admins can merge verified duplicate records. Everyone else can review and open profiles.</p>}
        </div>
      ) : mode === 'profiles' ? (
        <>
          <div className="health-filters">
            {FILTERS.map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}
          </div>
          <div className="profile-health-list">
            {profiles.map(record => (
              <button type="button" key={record.id} onClick={() => openCreator(record)}>
                <span className="health-avatar">{record.avatar_url ? <img src={record.avatar_url} alt="" /> : record.name.slice(0, 1)}</span>
                <span><strong>{record.name}</strong><small>{record.primary_social?.handle || record.email || 'No contact identity'}</small></span>
                <span className="health-progress"><i><b style={{ width: `${record.completeness}%` }} /></i><small>{record.completeness}% complete</small></span>
                <span className="health-missing">{record.missing.slice(0, 4).map(item => <i key={item}>{item}</i>)}</span>
                <b>→</b>
              </button>
            ))}
          </div>
          {!loading && !profiles.length && <div className="health-empty"><strong>No profiles match this filter.</strong><p>Try another completeness category.</p></div>}
          {data.incomplete_profiles.length >= 150 && <p className="health-permission-note">Showing the 150 profiles with the most enrichment work remaining.</p>}
        </>
      ) : (
        <div className="archive-panel">
          <form className="archive-action" onSubmit={archiveLegacyCreators}>
            <div>
              <span>Clean active creator database</span>
              <strong>Archive legacy ClickUp/imported records</strong>
              <p>This preserves creator profiles, source metadata, outreach, deliverables, assets, and performance links, but removes imported legacy records from active database, Operations, and Data Health queues.</p>
            </div>
            <label>
              Type <code>ARCHIVE LEGACY CREATORS</code>
              <input
                disabled={!canMerge || !summary.legacy_import_candidates}
                value={archiveConfirmation}
                onChange={event => setArchiveConfirmation(event.target.value)}
              />
            </label>
            <button
              className="primary-action"
              disabled={!canMerge || saving || archiveConfirmation !== 'ARCHIVE LEGACY CREATORS' || !summary.legacy_import_candidates}
            >
              Archive {summary.legacy_import_candidates || 0} records
            </button>
            {!canMerge && <small>Admin access is required to archive or restore creator records.</small>}
          </form>
          <div className="profile-health-list archive-list">
            {data.archived_creators.map(record => (
              <div key={record.id} className="archive-record">
                <button type="button" onClick={() => openCreator(record)}>
                  <span className="health-avatar">{record.avatar_url ? <img src={record.avatar_url} alt="" /> : record.name.slice(0, 1)}</span>
                  <span><strong>{record.name}</strong><small>{record.primary_social?.handle || record.email || record.clickup_status || 'Archived creator'}</small></span>
                  <span className="health-missing">
                    <i>{record.source || 'source'}</i>
                    {record.clickup_status && <i>{record.clickup_status}</i>}
                  </span>
                  <span><b>{record.relationship_count || 0}</b><small>activity</small></span>
                </button>
                {canMerge && <button type="button" disabled={saving} onClick={() => restoreCreator(record.id)}>Restore</button>}
              </div>
            ))}
          </div>
          {!loading && !data.archived_creators.length && <div className="health-empty"><strong>No archived creators yet.</strong><p>Archive legacy imports to clear the active database without losing access.</p></div>}
          {data.archived_creators.length >= 300 && <p className="health-permission-note">Showing the 300 most recently archived creator records.</p>}
        </div>
      )}

      {merge && (
        <div className="app-modal-backdrop" onMouseDown={() => setMerge(null)}>
          <form className="app-modal merge-modal" onSubmit={confirmMerge} onMouseDown={event => event.stopPropagation()}>
            <header><h2>Merge creator records</h2><button type="button" onClick={() => setMerge(null)}>Close</button></header>
            <div>
              <p>This moves outreach, agreements, briefs, deliverables, footage, launches, and social intelligence into the primary record. The duplicate record is then deleted.</p>
              <div className="merge-direction">
                <span><small>Keep</small><strong>{merge.group.records.find(item => Number(item.id) === merge.primaryId)?.name}</strong></span>
                <b>←</b>
                <span><small>Merge and delete</small><strong>{merge.group.records.find(item => Number(item.id) === merge.duplicateId)?.name}</strong></span>
              </div>
              <label>Type <code>{`MERGE ${merge.duplicateId} INTO ${merge.primaryId}`}</code> to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            </div>
            <footer><button type="button" onClick={() => setMerge(null)}>Cancel</button><button className="primary-action" disabled={saving || confirmation !== `MERGE ${merge.duplicateId} INTO ${merge.primaryId}`}>{saving ? 'Merging…' : 'Merge records'}</button></footer>
          </form>
        </div>
      )}
    </section>
  );
}
