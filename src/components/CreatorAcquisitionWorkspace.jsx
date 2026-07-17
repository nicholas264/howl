import { useCallback, useEffect, useMemo, useState } from 'react';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const EMPTY_QUALIFICATION = {
  name: '', email: '', location: '', niche: '', strengths: '',
  audience_description: '', audience_psychographics: '', rate_expectations: '', activities: '', fit_notes: '',
};
const EMPTY_SCORECARD = {
  brand_fit: '', creative_quality: '', audience_fit: '', reliability: '', economics: '',
  recommendation: '', rationale: '',
};
const SCORE_SIGNALS = [
  ['brand_fit', 'Brand fit'],
  ['creative_quality', 'Creative'],
  ['audience_fit', 'Audience'],
  ['reliability', 'Production'],
  ['economics', 'Economics'],
];

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

function readiness(record) {
  const social = socialLine(record);
  const checks = record.application_code ? [
    ['Identity', record.name],
    ['Contact', record.email],
    ['Social profile', social?.handle],
    ['Rates', record.rate_expectations],
    ['Turnaround', record.availability],
    ['Product terms', record.open_to_product_for_content !== null && record.open_to_product_for_content !== undefined],
    ['Whitelisting', record.open_to_whitelisting !== null && record.open_to_whitelisting !== undefined],
  ] : [
    ['Identity', record.name],
    ['Contact', record.email],
    ['Social profile', social?.handle],
    ['Niche', record.niche],
    ['Strengths', record.strengths],
    ['Audience', record.audience_description],
    ['Audience mindset', record.audience_psychographics],
    ['Rates', record.rate_expectations],
    ['Proof of work', record.sample_urls?.length || record.creator_experience || record.enrichment?.biography],
  ];
  const complete = checks.filter(([, value]) => Boolean(value)).length;
  return {
    score: Math.round((complete / checks.length) * 100),
    missing: checks.filter(([, value]) => !value).map(([label]) => label),
  };
}

function fitAssessment(record) {
  const scorecard = record.review_scorecard || {};
  const scores = SCORE_SIGNALS.map(([key]) => Number(scorecard[key]))
    .filter(score => score >= 1 && score <= 5);
  return {
    overall: scores.length
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / (scores.length * 5)) * 100)
      : 0,
    complete: scores.length === SCORE_SIGNALS.length,
    recommendation: scorecard.recommendation || '',
  };
}

function CandidateCard({ record, type, selected, onSelect }) {
  const social = socialLine(record);
  const quality = readiness(record);
  const fit = fitAssessment(record);
  return (
    <button type="button" className={`talent-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(record)}>
      <span className="talent-avatar">
        {(record.avatar_url || social?.avatar_url) ? <img src={record.avatar_url || social.avatar_url} alt="" /> : (record.name || '?').slice(0, 1)}
      </span>
      <span>
        <strong>{record.name || social?.handle || 'Unnamed prospect'}</strong>
        <small>{type === 'application' ? record.application_code : record.source?.replaceAll('_', ' ')} · {fit.complete ? `${fit.overall}% fit` : `${quality.score}% ready`}</small>
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
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState('active');
  const [discover, setDiscover] = useState({ handle: '', niche: '', fit_notes: '' });
  const [notes, setNotes] = useState('');
  const [qualification, setQualification] = useState(EMPTY_QUALIFICATION);
  const [scorecard, setScorecard] = useState(EMPTY_SCORECARD);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchEnriching, setBatchEnriching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      if (!(import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true')) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mode, selected?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSelected(null);
    setNotes('');
    setQualification(EMPTY_QUALIFICATION);
    setScorecard(EMPTY_SCORECARD);
    setSearch('');
    setQueueFilter('active');
  }, [mode]);
  useEffect(() => {
    if (!selected) return;
    setQualification({
      name: selected.name || '',
      email: selected.email || '',
      location: selected.location || '',
      niche: selected.niche || '',
      strengths: selected.strengths || '',
      audience_description: selected.audience_description || '',
      audience_psychographics: selected.audience_psychographics || '',
      rate_expectations: selected.rate_expectations || '',
      activities: Array.isArray(selected.activities) ? selected.activities.join(', ') : '',
      fit_notes: selected.fit_notes || '',
    });
    setScorecard({ ...EMPTY_SCORECARD, ...(selected.review_scorecard || {}) });
  }, [selected?.id]);

  const records = mode === 'applications' ? data.applications : data.candidates;
  const draftFit = fitAssessment({ review_scorecard: scorecard });
  const canPromote = draftFit.complete && ['strong_fit', 'potential'].includes(scorecard.recommendation);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records.filter(item => {
      const quality = readiness(item);
      const fit = fitAssessment(item);
      const active = !['approved', 'declined', 'archived'].includes(item.status);
      const filterMatch = queueFilter === 'all'
        || (queueFilter === 'active' && active)
        || item.status === queueFilter
        || (queueFilter === 'ready' && active && quality.score >= 75)
        || (queueFilter === 'high_fit' && active && fit.complete && fit.overall >= 80);
      if (!filterMatch) return false;
      if (!needle) return true;
      const social = socialLine(item);
      return [item.name, item.email, item.location, item.niche, social?.handle]
        .some(value => value?.toLowerCase().includes(needle));
    }).sort((left, right) => {
      const leftFit = fitAssessment(left);
      const rightFit = fitAssessment(right);
      if (rightFit.complete !== leftFit.complete) return Number(rightFit.complete) - Number(leftFit.complete);
      if (rightFit.overall !== leftFit.overall) return rightFit.overall - leftFit.overall;
      return readiness(right).score - readiness(left).score;
    });
  }, [records, queueFilter, search]);

  const queueSummary = useMemo(() => {
    const active = records.filter(item => !['declined', 'archived', 'approved'].includes(item.status));
    return {
      active: active.length,
      new: active.filter(item => item.status === 'new').length,
      ready: active.filter(item => readiness(item).score >= 75).length,
      highFit: active.filter(item => {
        const fit = fitAssessment(item);
        return fit.complete && fit.overall >= 80;
      }).length,
      needsEnrichment: mode === 'applications'
        ? Number(data.counts?.applications_needing_enrichment || 0)
        : active.filter(item => !item.enrichment?.instagram_enriched_at && socialLine(item)?.platform === 'instagram').length,
    };
  }, [data.counts, mode, records]);

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

  const enrichInbox = async () => {
    setBatchEnriching(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/creator-acquisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enrich_inbox' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not enrich application inbox');
      setNotice(result.processed
        ? `Enriched ${result.enriched} of ${result.processed} applications${result.failed ? ` · ${result.failed} need manual review` : ''}.`
        : 'No new Instagram applications need enrichment.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBatchEnriching(false);
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
          review_scorecard: scorecard,
          ...qualification,
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

  const enrichInstagram = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-acquisition', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enrich_instagram',
          type: mode === 'applications' ? 'application' : 'candidate',
          id: selected.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not enrich Instagram profile');
      setSelected(result.record);
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
          review_notes: notes || selected.review_notes,
          review_scorecard: scorecard,
          ...qualification,
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

      <div className="talent-queue-summary">
        <div><span>In review</span><strong>{queueSummary.active}</strong><small>new and reviewing</small></div>
        <div><span>New</span><strong>{queueSummary.new}</strong><small>untouched records</small></div>
        <div className={queueSummary.needsEnrichment ? 'attention' : ''}><span>Needs enrichment</span><strong>{queueSummary.needsEnrichment}</strong><small>Instagram data missing</small></div>
        <div className={queueSummary.ready ? 'ready' : ''}><span>Ready to decide</span><strong>{queueSummary.ready}</strong><small>75%+ profile readiness</small></div>
        <div className={queueSummary.highFit ? 'strong' : ''}><span>High fit</span><strong>{queueSummary.highFit}</strong><small>fully scored at 80%+</small></div>
      </div>

      <div className="talent-queue-tools">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search talent, niche, location, or handle" />
        <nav>
          {[
            ['active', 'Active'],
            ['new', 'New'],
            ['reviewing', 'Reviewing'],
            ['ready', 'Ready'],
            ['high_fit', 'High fit'],
            ['all', 'All'],
          ].map(([key, label]) => (
            <button key={key} className={queueFilter === key ? 'active' : ''} onClick={() => setQueueFilter(key)}>{label}</button>
          ))}
        </nav>
        {mode === 'applications' && canManage && (
          <button
            type="button"
            className="talent-batch-enrich"
            onClick={enrichInbox}
            disabled={saving || batchEnriching || !queueSummary.needsEnrichment}
            title={!queueSummary.needsEnrichment ? 'No Instagram application profiles need enrichment right now.' : ''}
          >
            {batchEnriching ? 'Enriching...' : 'Enrich next 5'}
          </button>
        )}
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
      {notice && <div className="app-notice">{notice}</div>}
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
            <button type="button" className="detail-close" onClick={() => setSelected(null)}>Close</button>
            <span className="workspace-kicker">{mode === 'applications' ? 'Creator application' : 'Discovery profile'}</span>
            <h2>{selected.name || socialLine(selected)?.handle}</h2>
            <p>{selected.location || selected.email || selected.source?.replaceAll('_', ' ')}</p>
            {(() => {
              const quality = readiness(selected);
              return (
                <div className="talent-readiness">
                  <div>
                    <span>Profile readiness</span>
                    <strong>{quality.score}%</strong>
                  </div>
                  <i><b style={{ width: `${quality.score}%` }} /></i>
                  <small>{quality.missing.length ? `Missing: ${quality.missing.join(', ')}` : 'Ready for a grounded brief and outreach.'}</small>
                </div>
              );
            })()}
            <div className="talent-detail-stats">
              <div><span>Audience</span><strong>{socialLine(selected)?.followers ? compact.format(Number(socialLine(selected).followers)) : '—'}</strong></div>
              <div><span>Engagement</span><strong>{socialLine(selected)?.engagement_rate ? `${Number(socialLine(selected).engagement_rate).toFixed(1)}%` : '—'}</strong></div>
              <div><span>Status</span><strong>{selected.status}</strong></div>
            </div>
            {(() => {
              const fit = fitAssessment(selected);
              return (
                <section className={`talent-fit-summary ${fit.complete ? 'complete' : ''}`}>
                  <div>
                    <span>Reviewer fit</span>
                    <strong>{fit.complete ? `${fit.overall}%` : 'Unscored'}</strong>
                  </div>
                  <small>{fit.recommendation
                    ? fit.recommendation.replace('_', ' ')
                    : 'Complete the five-signal review before making a final decision.'}</small>
                </section>
              );
            })()}
            <dl className="talent-facts">
              <div><dt>Niche</dt><dd>{selected.niche || 'Not provided'}</dd></div>
              <div><dt>Strengths</dt><dd>{selected.strengths || 'Not provided'}</dd></div>
              {selected.audience_description && <div><dt>Audience</dt><dd>{selected.audience_description}</dd></div>}
              {selected.audience_psychographics && <div><dt>Audience mindset</dt><dd>{selected.audience_psychographics}</dd></div>}
              {selected.why_howl && <div><dt>Why HOWL</dt><dd>{selected.why_howl}</dd></div>}
              {selected.creator_experience && <div><dt>Experience</dt><dd>{selected.creator_experience}</dd></div>}
              {selected.fit_notes && <div><dt>Scout note</dt><dd>{selected.fit_notes}</dd></div>}
              {selected.rate_expectations && <div><dt>Rates</dt><dd>{selected.rate_expectations}</dd></div>}
              {selected.availability && <div><dt>Turnaround</dt><dd>{selected.availability}</dd></div>}
              {selected.open_to_product_for_content !== null && selected.open_to_product_for_content !== undefined && <div><dt>Product for content</dt><dd>{selected.open_to_product_for_content ? 'Open' : 'Not open'}</dd></div>}
              {selected.open_to_whitelisting !== null && selected.open_to_whitelisting !== undefined && <div><dt>Whitelisting</dt><dd>{selected.open_to_whitelisting ? 'Open' : 'Not open'}</dd></div>}
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
                <details className="talent-qualification" defaultOpen={readiness(selected).score < 75}>
                  <summary>Qualification details</summary>
                  <div>
                    <label>Name<input value={qualification.name} onChange={event => setQualification({ ...qualification, name: event.target.value })} /></label>
                    <label>Email<input type="email" value={qualification.email} onChange={event => setQualification({ ...qualification, email: event.target.value })} /></label>
                    <label>Location<input value={qualification.location} onChange={event => setQualification({ ...qualification, location: event.target.value })} /></label>
                    <label>Niche<input value={qualification.niche} onChange={event => setQualification({ ...qualification, niche: event.target.value })} /></label>
                    <label className="wide">Activities<input placeholder="Camping, cooking, overlanding" value={qualification.activities} onChange={event => setQualification({ ...qualification, activities: event.target.value })} /></label>
                    <label className="wide">Strengths<textarea rows="2" value={qualification.strengths} onChange={event => setQualification({ ...qualification, strengths: event.target.value })} /></label>
                    <label className="wide">Audience<textarea rows="2" value={qualification.audience_description} onChange={event => setQualification({ ...qualification, audience_description: event.target.value })} /></label>
                    <label className="wide">Audience mindset<textarea rows="2" value={qualification.audience_psychographics} onChange={event => setQualification({ ...qualification, audience_psychographics: event.target.value })} /></label>
                    <label className="wide">Rate expectations<input value={qualification.rate_expectations} onChange={event => setQualification({ ...qualification, rate_expectations: event.target.value })} /></label>
                    {mode === 'discovery' && <label className="wide">Scout note<textarea rows="2" value={qualification.fit_notes} onChange={event => setQualification({ ...qualification, fit_notes: event.target.value })} /></label>}
                  </div>
                  <button onClick={() => update('reviewing')} disabled={saving}>Save qualification</button>
                </details>
                {socialLine(selected)?.platform === 'instagram' && (
                  <button className="talent-enrich" onClick={enrichInstagram} disabled={saving}>
                    <span>{selected.enrichment?.instagram_enriched_at ? 'Refresh Instagram intelligence' : 'Enrich Instagram profile'}</span>
                    <small>Followers, engagement, bio, recent media</small>
                  </button>
                )}
                <section className="talent-scorecard">
                  <header>
                    <span>Fit scorecard</span>
                    <small>1 weak · 5 exceptional</small>
                  </header>
                  <div>
                    {SCORE_SIGNALS.map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <select value={scorecard[key]} onChange={event => setScorecard(current => ({ ...current, [key]: event.target.value }))}>
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <label>
                    Recommendation
                    <select value={scorecard.recommendation} onChange={event => setScorecard(current => ({ ...current, recommendation: event.target.value }))}>
                      <option value="">Select</option>
                      <option value="strong_fit">Strong fit</option>
                      <option value="potential">Potential</option>
                      <option value="pass">Pass</option>
                    </select>
                  </label>
                  <label>
                    Decision rationale
                    <textarea rows="3" value={scorecard.rationale} onChange={event => setScorecard(current => ({ ...current, rationale: event.target.value }))} placeholder="What makes this creator right or wrong for HOWL?" />
                  </label>
                </section>
                <label className="talent-notes">Internal review note<textarea rows="4" value={notes} onChange={event => setNotes(event.target.value)} /></label>
                <div className="talent-actions">
                  <button onClick={() => update('declined')} disabled={saving}>Decline</button>
                  <button onClick={() => update('reviewing')} disabled={saving}>Keep reviewing</button>
                  <button
                    className="primary-action"
                    onClick={promote}
                    disabled={saving || !canPromote}
                    title={!canPromote ? 'Complete the scorecard with a Strong fit or Potential recommendation first' : ''}
                  >
                    Promote to pipeline
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
