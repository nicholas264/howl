import React, { useEffect, useMemo, useState } from 'react';

const METRICS = {
  cpa: { label: 'CPA', format: v => v == null ? '—' : `$${v.toFixed(0)}`, better: 'low' },
  roas: { label: 'ROAS', format: v => `${(v || 0).toFixed(2)}x`, better: 'high' },
  purchases: { label: 'Purchases', format: v => Math.round(v || 0).toLocaleString(), better: 'high' },
  spend: { label: 'Spend', format: v => `$${Math.round(v || 0).toLocaleString()}`, better: 'high' },
  purchaseValue: { label: 'Purchase value', format: v => `$${Math.round(v || 0).toLocaleString()}`, better: 'high' },
  ctr: { label: 'CTR', format: v => `${((v || 0) * 100).toFixed(2)}%`, better: 'high' },
  hookRate: { label: 'Hook rate', format: v => `${((v || 0) * 100).toFixed(1)}%`, better: 'high' },
};

function statusFor(g) {
  if ((g.spend || 0) < 50 && !(g.purchases > 0)) return 'Learning';
  if ((g.roas || 0) >= 2 && (g.purchases || 0) >= 2) return 'Winner';
  if ((g.spend || 0) >= 100 && (g.roas || 0) < 1) return 'Stop';
  if ((g.ctr || 0) < 0.008 && (g.spend || 0) >= 75) return 'Hook weak';
  if ((g.hookRate || 0) > 0.25 && (g.roas || 0) < 1.5) return 'Fix offer';
  return 'Watch';
}

function metricRange(groups, key) {
  const values = groups.map(g => g[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
  return { min: Math.min(...values, 0), max: Math.max(...values, 1) };
}

export default function CreativePerformanceWorkspace({
  creativeTable,
  loading,
  error,
  windowDays,
  setWindowDays,
  syncing,
  syncMessage,
  onSync,
  analysisQueue,
  analysisQueueLoading,
  analysisQueueMessage,
  analysisBatchRunning,
  onProcessAnalysisBatch,
  onRetryAnalysisBatch,
  onRefreshAnalysisQueue,
  onAnalyze,
  onOpenAnalysis,
  onAssignCreator,
  onAssignCreators,
  canManageCreators,
  setActiveTab,
}) {
  const [viewMode, setViewMode] = useState('cards');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [creatorFilter, setCreatorFilter] = useState('All');
  const [sortKey, setSortKey] = useState('purchaseValue');
  const [selectedMetrics, setSelectedMetrics] = useState(['cpa', 'roas', 'purchases', 'spend', 'purchaseValue']);
  const [selected, setSelected] = useState(() => new Set());
  const [creators, setCreators] = useState([]);
  const [assigning, setAssigning] = useState('');
  const [assignmentMessage, setAssignmentMessage] = useState('');
  const [assignmentError, setAssignmentError] = useState(false);
  const [batchAssigning, setBatchAssigning] = useState(false);
  const [conceptMessage, setConceptMessage] = useState('');

  useEffect(() => {
    fetch('/api/creators')
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setCreators(data.creators || []))
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(creativeTable?.groups || [])]
      .filter(g => !needle || (g.name || '').toLowerCase().includes(needle))
      .filter(g => status === 'All' || statusFor(g) === status)
      .filter(g => creatorFilter === 'All'
        || (creatorFilter === 'Unassigned' ? !g.creatorId && !g.sourceType
          : creatorFilter === 'Suggested' ? !g.creatorId && !g.sourceType && !!g.suggestedCreatorId
            : String(g.creatorId) === creatorFilter))
      .sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
  }, [creativeTable, creatorFilter, query, status, sortKey]);

  const topGroups = groups.slice(0, 12);
  const metricRanges = useMemo(
    () => Object.keys(METRICS).reduce((ranges, key) => {
      ranges[key] = metricRange(groups, key);
      return ranges;
    }, {}),
    [groups],
  );
  const selectedSet = selected;
  const selectedAnalyzedCount = groups.filter(g => selected.has(g.groupKey) && g.isAnalyzed).length;
  const fallbackWinnerCount = topGroups.filter(g => g.isAnalyzed && statusFor(g) === 'Winner').slice(0, 4).length;
  const conceptReferenceCount = selectedAnalyzedCount || fallbackWinnerCount;
  const conceptButtonLabel = selected.size
    ? `Generate from ${selectedAnalyzedCount || 0} selected`
    : `Generate from ${fallbackWinnerCount || 'winners'}`;
  const toggleSelected = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleMetric = (key) => {
    setSelectedMetrics(prev => prev.includes(key)
      ? (prev.length > 1 ? prev.filter(k => k !== key) : prev)
      : [...prev, key]);
  };
  const sendToConcepts = () => {
    const selectedAnalyzed = groups.filter(g => selected.has(g.groupKey) && g.isAnalyzed);
    const fallbackWinners = topGroups
      .filter(g => g.isAnalyzed && statusFor(g) === 'Winner')
      .slice(0, 4);
    if (!selectedAnalyzed.length && !fallbackWinners.length) {
      setConceptMessage('Analyze at least one winning creative before generating scripts from performance.');
      return;
    }
    const keys = (selectedAnalyzed.length ? selectedAnalyzed : fallbackWinners).map(g => g.groupKey);
    sessionStorage.setItem('howl:selected-winners', JSON.stringify(keys));
    setConceptMessage('');
    setActiveTab('from-winners');
  };
  const assignCreator = async (group, creatorId) => {
    setAssigning(group.groupKey);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      const result = await onAssignCreator(group.groupKey, creatorId || null);
      setAssignmentMessage(result.creator
        ? `Assigned ${group.name || 'creative'} to ${result.creator.name}.`
        : `Removed creator assignment from ${group.name || 'creative'}.`);
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setAssigning('');
    }
  };
  const applyHighConfidenceSuggestions = async () => {
    const assignments = (creativeTable?.groups || [])
      .filter(group => !group.creatorId && !group.sourceType && group.suggestedCreatorId && group.suggestionConfidence === 'high')
      .slice(0, 100)
      .map(group => ({ groupKey: group.groupKey, creatorId: group.suggestedCreatorId }));
    if (!assignments.length) return;
    setBatchAssigning(true);
    setAssignmentMessage('');
    setAssignmentError(false);
    try {
      const result = await onAssignCreators(assignments);
      setAssignmentMessage(`Attributed ${result.assignments?.length || assignments.length} high-confidence creative groups.`);
    } catch (err) {
      setAssignmentMessage(err.message);
      setAssignmentError(true);
    } finally {
      setBatchAssigning(false);
    }
  };

  const totalSpend = groups.reduce((sum, g) => sum + (g.spend || 0), 0);
  const totalRevenue = groups.reduce((sum, g) => sum + (g.purchaseValue || 0), 0);
  const winners = groups.filter(g => statusFor(g) === 'Winner').length;
  const allGroups = creativeTable?.groups || [];
  const assignedCount = allGroups.filter(group => group.creatorId || group.sourceType).length;
  const suggestedCount = allGroups.filter(group => !group.creatorId && !group.sourceType && group.suggestedCreatorId).length;
  const highConfidenceCount = allGroups.filter(group => !group.creatorId && !group.sourceType && group.suggestionConfidence === 'high').length;

  return (
    <section className="motion-workspace">
      <header className="motion-report-head">
        <div>
          <div className="motion-kicker">Creative intelligence</div>
          <h1>Top creatives</h1>
          <p>See where HOWL is spending money, making money, and finding repeatable creative patterns.</p>
        </div>
        <div className="motion-summary">
          <div><span>Spend</span><strong>${Math.round(totalSpend).toLocaleString()}</strong></div>
          <div><span>Purchase value</span><strong>${Math.round(totalRevenue).toLocaleString()}</strong></div>
          <div><span>Winners</span><strong>{winners}</strong></div>
        </div>
      </header>

      <div className="motion-toolbar">
        <div className="motion-toolbar-group">
          {[7, 14, 30, 90].map(days => (
            <button className={windowDays === days ? 'active' : ''} onClick={() => setWindowDays(days)} key={days}>{days}d</button>
          ))}
          <input aria-label="Search creatives" placeholder="Search creatives" value={query} onChange={e => setQuery(e.target.value)} />
          <select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
            {['All', 'Winner', 'Watch', 'Learning', 'Hook weak', 'Fix offer', 'Stop'].map(item => <option key={item}>{item}</option>)}
          </select>
          <select aria-label="Filter by creator" value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}>
            <option>All</option>
            <option>Unassigned</option>
            <option>Suggested</option>
            {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
          </select>
        </div>
        <div className="motion-toolbar-group">
          <button onClick={onSync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync Meta'}</button>
          <button
            className="motion-primary"
            onClick={sendToConcepts}
            title={!conceptReferenceCount ? 'Analyze at least one winning creative first.' : ''}
          >
            {conceptButtonLabel}
          </button>
        </div>
      </div>
      {conceptMessage ? <div className="motion-error">{conceptMessage}</div> : null}

      <div className="motion-attribution">
        <div className="motion-attribution-copy">
          <span>Source attribution</span>
          <strong>{assignedCount} source-attributed · {allGroups.length - assignedCount} need review</strong>
          <p>External UGC should map to a creator. Founder, internal employee, and in-app generated ads can be source-tagged without forcing a fake creator record.</p>
        </div>
        <div className="motion-attribution-stats">
          <div><span>Suggested</span><strong>{suggestedCount}</strong></div>
          <div><span>High confidence</span><strong>{highConfidenceCount}</strong></div>
        </div>
        <div className="motion-attribution-actions">
          <button onClick={() => { setCreatorFilter('Suggested'); setViewMode('table'); }}>Review matches</button>
          <button className="motion-primary" onClick={applyHighConfidenceSuggestions} disabled={!canManageCreators || batchAssigning || !highConfidenceCount}>
            {batchAssigning ? 'Applying…' : `Apply high confidence (${Math.min(100, highConfidenceCount)})`}
          </button>
        </div>
      </div>

      <div className="motion-queue">
        <div className="motion-queue-copy">
          <span>Batch creative analysis</span>
          <strong>
            {analysisQueueLoading && !analysisQueue
              ? 'Loading queue…'
              : `${analysisQueue?.summary?.pending || 0} waiting · ${analysisQueue?.summary?.processing || 0} running · ${analysisQueue?.summary?.failed || 0} failed`}
          </strong>
          <p>New launches and Meta syncs queue transcription and vision analysis automatically. The worker processes them daily, or you can run the next three now.</p>
        </div>
        <div className="motion-queue-stats">
          {[
            ['Waiting', analysisQueue?.summary?.pending || 0],
            ['Running', analysisQueue?.summary?.processing || 0],
            ['Complete', analysisQueue?.summary?.completed || 0],
            ['Failed', analysisQueue?.summary?.failed || 0],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="motion-queue-actions">
          <button onClick={onRefreshAnalysisQueue} disabled={analysisQueueLoading}>Refresh</button>
          {(analysisQueue?.summary?.failed || 0) > 0
            ? <button onClick={onRetryAnalysisBatch}>Retry failed</button>
            : null}
          <button className="motion-primary" onClick={onProcessAnalysisBatch} disabled={analysisBatchRunning || !(analysisQueue?.summary?.pending || 0)}>
            {analysisBatchRunning ? 'Analyzing…' : 'Run next 3'}
          </button>
        </div>
      </div>
      {(analysisQueue?.recent || []).some(job => job.status === 'failed') ? (
        <div className="motion-queue-failures">
          {(analysisQueue.recent || []).filter(job => job.status === 'failed').slice(0, 3).map(job => (
            <div key={job.group_key}>
              <strong>{job.name || job.group_key}</strong>
              <span>{job.last_error || 'Analysis failed after all retries.'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="motion-metric-bar">
        <span>Add metric</span>
        {Object.entries(METRICS).map(([key, metric], index) => (
          <button key={key} className={selectedMetrics.includes(key) ? 'active' : ''} onClick={() => toggleMetric(key)}>
            <i>{index + 1}</i>{metric.label}
          </button>
        ))}
        <div className="motion-view-toggle">
          {['cards', 'chart', 'table'].map(mode => (
            <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>{mode}</button>
          ))}
        </div>
      </div>

      {syncMessage ? <div className="motion-notice">{syncMessage}</div> : null}
      {analysisQueueMessage ? <div className="motion-notice">{analysisQueueMessage}</div> : null}
      {assignmentMessage ? <div className={assignmentError ? 'motion-error' : 'motion-notice'}>{assignmentMessage}</div> : null}
      {error ? <div className="motion-error">{error}</div> : null}
      {loading && !creativeTable ? <div className="motion-loading">Loading creative performance…</div> : null}

      {viewMode === 'cards' && (
        <div className="motion-card-grid">
          {topGroups.map(g => (
            <article className={`motion-creative-card ${selectedSet.has(g.groupKey) ? 'selected' : ''}`} key={g.groupKey}>
              <button className="motion-select" aria-label={`Select ${g.name}`} onClick={() => toggleSelected(g.groupKey)}>
                {selectedSet.has(g.groupKey) ? '✓' : ''}
              </button>
              <div className="motion-media" onClick={() => onOpenAnalysis(g.groupKey, g.name)}>
                {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" /> : <div className="motion-media-empty">No preview</div>}
                <span>{statusFor(g)}</span>
              </div>
              <div className="motion-card-body">
                <h3>{g.name || 'Untitled creative'}</h3>
                <p>{g.adCount} ad{g.adCount === 1 ? '' : 's'} · {g.firstLaunchDate ? new Date(g.firstLaunchDate).toLocaleDateString() : 'No launch date'}</p>
                <div className={`motion-creator-assignment ${g.creatorConflict ? 'conflict' : ''}`}>
                  <span>{g.creatorConflict ? 'Creator conflict' : 'Creator'}</span>
                  <select
                    aria-label={`Assign creator to ${g.name || 'creative'}`}
                    value={g.creatorId || ''}
                    disabled={!canManageCreators || assigning === g.groupKey}
                    onChange={event => assignCreator(g, event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
                  </select>
                  {!g.creatorId && g.sourceType ? (
                    <small>{g.sourceType.replaceAll('_', ' ')} · {g.sourceLabel || 'source tagged'}</small>
                  ) : null}
                </div>
                {canManageCreators && !g.creatorId && !g.sourceType && g.suggestedCreatorId ? (
                  <button className="motion-creator-suggestion" title={g.suggestionReason} onClick={() => assignCreator(g, g.suggestedCreatorId)}>
                    <span>{g.suggestionConfidence === 'high' ? 'High confidence' : 'Review match'}</span>
                    Use {g.suggestedCreatorName}
                  </button>
                ) : null}
                <dl>
                  {selectedMetrics.slice(0, 5).map(key => (
                    <div key={key}><dt>{METRICS[key].label}</dt><dd>{METRICS[key].format(g[key])}</dd></div>
                  ))}
                </dl>
                <button className="motion-analysis-link" onClick={() => g.isAnalyzed ? onOpenAnalysis(g.groupKey, g.name) : onAnalyze(g.groupKey, g.name)}>
                  {g.isAnalyzed
                    ? 'Open creative DNA'
                    : g.analysisQueueStatus === 'processing'
                      ? 'Analysis running'
                      : g.analysisQueueStatus === 'pending'
                        ? 'Analyze now'
                        : g.analysisQueueStatus === 'failed'
                          ? 'Retry analysis now'
                          : 'Analyze creative'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {viewMode === 'chart' && (
        <div className="motion-chart">
          <div className="motion-chart-legend">
            <span><i className="cpa" />CPA</span><span><i className="roas" />ROAS</span>
          </div>
          <div className="motion-chart-bars">
            {topGroups.slice(0, 8).map(g => {
              return (
                <div className="motion-chart-item" key={g.groupKey}>
                  <div className="motion-bars">
                    <div className="motion-bar cpa" style={{ height: `${Math.max(8, ((g.cpa || 0) / metricRanges.cpa.max) * 100)}%` }}><span>{METRICS.cpa.format(g.cpa)}</span></div>
                    <div className="motion-bar roas" style={{ height: `${Math.max(8, ((g.roas || 0) / metricRanges.roas.max) * 100)}%` }}><span>{METRICS.roas.format(g.roas)}</span></div>
                  </div>
                  {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" /> : <div className="motion-chart-thumb" />}
                  <strong>{g.name}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === 'table' && (
        <div className="motion-table-wrap">
          <table className="motion-table">
            <thead><tr>
              <th>Creative</th><th>Creator</th><th>Launch date</th><th>Status</th>
              {selectedMetrics.map(key => <th key={key}><button onClick={() => setSortKey(key)}>{METRICS[key].label}</button></th>)}
            </tr></thead>
            <tbody>
              {groups.map(g => <tr key={g.groupKey}>
                <td><button className="motion-name" onClick={() => onOpenAnalysis(g.groupKey, g.name)}>
                  {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" /> : null}<span><strong>{g.name}</strong><small>{g.adCount} ads</small></span>
                </button></td>
                <td>
                  <select
                    className="motion-table-creator"
                    aria-label={`Assign creator to ${g.name || 'creative'}`}
                    value={g.creatorId || ''}
                    disabled={!canManageCreators || assigning === g.groupKey}
                    onChange={event => assignCreator(g, event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
                  </select>
                  {!g.creatorId && g.sourceType ? (
                    <small className="motion-source-tag">{g.sourceType.replaceAll('_', ' ')} · {g.sourceLabel || 'source tagged'}</small>
                  ) : null}
                  {canManageCreators && !g.creatorId && !g.sourceType && g.suggestedCreatorId ? (
                    <button className="motion-table-suggestion" title={g.suggestionReason} onClick={() => assignCreator(g, g.suggestedCreatorId)}>
                      Use {g.suggestedCreatorName}
                    </button>
                  ) : null}
                </td>
                <td>{g.firstLaunchDate ? new Date(g.firstLaunchDate).toLocaleDateString() : '—'}</td>
                <td><span className={`motion-status status-${statusFor(g).toLowerCase().replace(' ', '-')}`}>{statusFor(g)}</span></td>
                {selectedMetrics.map(key => {
                  const range = metricRanges[key];
                  const normalized = range.max === range.min ? 0 : ((g[key] || 0) - range.min) / (range.max - range.min);
                  const strength = METRICS[key].better === 'low' ? 1 - normalized : normalized;
                  return <td key={key} style={{ background: `rgba(88, 190, 122, ${Math.max(0, strength) * 0.24})` }}>{METRICS[key].format(g[key])}</td>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
