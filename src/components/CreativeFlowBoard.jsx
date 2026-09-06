import { apiFetch as fetch } from '../lib/apiFetch.js';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

const STAGE_LABELS = {
  ideate: 'Ideate', match: 'Match', brief: 'Brief', produce: 'Produce',
  launch: 'Launch', analyze: 'Analyze', iterate: 'Iterate',
};
const STAGE_ORDER = ['ideate', 'match', 'brief', 'produce', 'launch', 'analyze', 'iterate'];
const NEXT = { ideate: 'match', match: 'brief', brief: 'produce', produce: 'launch', launch: 'analyze', analyze: 'iterate' };

const EMPTY_CONCEPT = { product: '', angle: '', format: '', objective: '' };

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `$${Math.round(amount).toLocaleString()}`;
}

export default function CreativeFlowBoard({ setActiveTab, onOpenCreator, canManage = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matcherOpen, setMatcherOpen] = useState(false);
  const [concept, setConcept] = useState(EMPTY_CONCEPT);
  const [seedCard, setSeedCard] = useState(null); // card being matched, if any
  const [results, setResults] = useState(null);
  const [matching, setMatching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [attrib, setAttrib] = useState(null);
  const [attribOpen, setAttribOpen] = useState(false);
  const [attribBusy, setAttribBusy] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [ops, setOps] = useState(null);
  const [opsOpen, setOpsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await apiJson('/api/creative-flow', undefined, 'Failed to load board'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadAttrib = useCallback(async () => {
    try {
      setAttrib(await apiJson('/api/attribution-autopilot', undefined, 'Attribution failed'));
    } catch { /* non-fatal */ }
  }, []);
  const loadOps = useCallback(async () => {
    try {
      setOps(await apiJson('/api/creator-operations', undefined, 'Operations failed'));
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => { load(); loadAttrib(); loadOps(); }, [load, loadAttrib, loadOps]);

  async function applyAutoHigh() {
    setAttribBusy(true);
    try {
      await fetch('/api/attribution-autopilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply_high_confidence: true }) });
      await Promise.all([loadAttrib(), load()]);
    } finally { setAttribBusy(false); }
  }
  async function applyOne(groupKey, creatorId) {
    if (!creatorId) return;
    setAttribBusy(true);
    try {
      await fetch('/api/attribution-autopilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignments: [{ group_key: groupKey, creator_id: creatorId }] }) });
      await loadAttrib();
    } finally { setAttribBusy(false); }
  }

  function openMatcher(card) {
    setSeedCard(card || null);
    setConcept(card
      ? { product: card.product_label || '', angle: card.angle || '', format: card.format || '', objective: card.objective || '' }
      : EMPTY_CONCEPT);
    setResults(null);
    setMatcherOpen(true);
  }

  async function runMatcher(e) {
    e?.preventDefault();
    setMatching(true); setError('');
    try {
      const data = await apiJson('/api/concept-creator-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(concept),
      }, 'Match failed');
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setMatching(false);
    }
  }

  // Pick a creator -> generate a brief (existing engine) -> create/advance a card to Brief.
  async function briefCreator(creator) {
    setBusyId(creator.creator_id);
    setError('');
    try {
      const briefData = await apiJson('/api/creator-workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: creator.creator_id, action: 'generate_brief',
          product: concept.product, objective: concept.objective, angle: concept.angle,
          direction: '', strategy_mode: 'past_performers',
        }),
      }, 'Brief generation failed');
      const { brief } = briefData;

      const payload = {
        stage: 'brief', creator_id: creator.creator_id, brief_id: brief?.id || null,
        title: brief?.title || concept.angle || concept.product || 'New concept',
        product_label: concept.product, angle: concept.angle, format: concept.format, objective: concept.objective,
        source_winner_group_key: seedCard?.source_winner_group_key || null,
      };
      if (seedCard?.id) {
        await fetch('/api/creative-flow', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: seedCard.id, ...payload }) });
      } else {
        await fetch('/api/creative-flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setMatcherOpen(false); setResults(null); setSeedCard(null);
      await load();
      onOpenCreator?.(creator.creator_id, 'briefs');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function pullWinner(winner) {
    await fetch('/api/creative-flow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'match', title: winner.angle || winner.name || 'Winner', angle: winner.angle,
        format: winner.format, source_winner_group_key: winner.group_key,
      }),
    });
    load();
  }

  // Iterate a real launched/analyzed creative into a fresh cycle, carrying its
  // group_key as provenance so the loop's lineage is preserved.
  async function iterateDerived(card) {
    await fetch('/api/creative-flow', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'match', title: card.title, angle: card.title,
        source_winner_group_key: card.group_key,
      }),
    });
    load();
  }

  async function patchCard(id, body) {
    await fetch('/api/creative-flow', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
    load();
  }

  // Route a card into the tool that does its stage's work.
  function cardAction(card) {
    switch (card.stage) {
      case 'ideate':
      case 'match':
        return { label: 'Match creator', fn: () => openMatcher(card) };
      case 'brief':
        return card.creator_id
          ? { label: 'Open brief', fn: () => onOpenCreator?.(card.creator_id, 'briefs') }
          : { label: 'Match creator', fn: () => openMatcher(card) };
      case 'produce':
        return card.creator_id
          ? { label: 'Open production', fn: () => onOpenCreator?.(card.creator_id, 'deliverables') }
          : { label: 'Match creator', fn: () => openMatcher(card) };
      case 'launch':
        return { label: 'Open launcher', fn: () => setActiveTab?.('launcher') };
      case 'analyze':
        return { label: 'Open analytics', fn: () => setActiveTab?.('creative-analytics') };
      case 'iterate':
        return { label: 'Iterate', fn: () => openMatcher(card) };
      default:
        return null;
    }
  }

  if (loading && !data) return <div className="forge"><div className="flow-empty">Loading the line…</div></div>;
  if (error && !data) return <div className="forge"><div className="flow-empty">{error}</div></div>;

  const cols = data?.columns || {};
  const counts = data?.counts || {};
  const winners = data?.availableWinners || [];
  const workItems = (ops?.items || []).filter(item => item.category !== 'data');
  const setup = ops?.setup || {};
  const setupItems = [
    setup.clickup_missing_email > 0 && {
      key: 'emails',
      label: 'Creator emails',
      value: setup.clickup_missing_email,
      detail: 'Missing from ClickUp API. Upload the ClickUp CSV to restore them.',
      action: 'Open data health',
      fn: () => setActiveTab?.('creators'),
    },
    setup.creative_unassigned_groups > 0 && {
      key: 'attribution',
      label: 'Source attribution',
      value: setup.creative_unassigned_groups,
      detail: 'Live ads need creator or source tags before Flow can learn from them.',
      action: 'Review attribution',
      fn: () => setAttribOpen(true),
    },
    setup.duplicate_groups > 0 && {
      key: 'duplicates',
      label: 'Duplicates',
      value: setup.duplicate_groups,
      detail: 'Merge duplicate creator records so attribution and production history roll up.',
      action: 'Open data health',
      fn: () => setActiveTab?.('creators'),
    },
  ].filter(Boolean);

  return (
    <div className="flow-page">
      <div className="forge-head">
        <div>
          <div className="forge-eyebrow">Creative Flow</div>
          <h1>The Line</h1>
          <p className="forge-sub">
            One spine for every creative cycle: ideate a concept, match the right creator and why, brief, produce,
            launch, analyze, then iterate the winners. Each card opens the tool that does the work.
          </p>
        </div>
        {canManage && (
          <button type="button" className="primary-action" onClick={() => openMatcher(null)}>Start a cycle</button>
        )}
      </div>

      {error && <div className="seed-flag" style={{ marginTop: 14 }}>{error}</div>}

      {/* guided next-step rail */}
      {setupItems.length > 0 && (
        <div className="flow-health-grid">
          {setupItems.map(item => (
            <button type="button" className="flow-health-card" key={item.key} onClick={item.fn}>
              <span>{item.label}</span>
              <strong>{item.value.toLocaleString()}</strong>
              <small>{item.detail}</small>
              <b>{item.action}</b>
            </button>
          ))}
        </div>
      )}

      {workItems.length > 0 && (() => {
        const dot = { urgent: '#d84a17', waiting: '#9a958c', blocked: '#b42318', action: '#2ea98f' };
        const shown = (opsOpen ? workItems.slice(0, 24) : workItems.slice(0, 6));
        const route = it => (it.creator_id ? onOpenCreator?.(it.creator_id, it.target_tab || 'profile') : null);
        return (
          <div className="flow-rail">
            <div className="flow-rail-head">
              <span className="flow-rail-title">Up next</span>
              <span className="flow-rail-sub">
                {ops.summary.urgent ? <b style={{ color: '#d84a17' }}>{ops.summary.urgent} urgent</b> : null}
                {ops.summary.urgent ? ' · ' : ''}{workItems.filter(item => item.action_state === 'action').length} ready · {workItems.filter(item => item.action_state === 'waiting').length} waiting
              </span>
              {workItems.length > 6 && (
                <button type="button" className="flow-btn" onClick={() => setOpsOpen(v => !v)}>{opsOpen ? 'Less' : `All ${workItems.length}`}</button>
              )}
            </div>
            <div className="flow-rail-chips">
              {shown.map(it => (
                <button type="button" className="flow-rail-chip" key={`${it.creator_id}-${it.action_key}`} onClick={() => route(it)} title={`${it.name} · ${it.stage}`}>
                  <span className="flow-rail-dot" style={{ background: dot[it.action_state] || '#9a958c' }} />
                  <span className="flow-rail-name">{it.name}</span>
                  <span className="flow-rail-act">{it.action_label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* matcher */}
      {matcherOpen && (
        <div className="flow-matcher">
          <div className="flow-matcher-head">
            <div className="forge-eyebrow" style={{ color: 'var(--flame)' }}>
              {seedCard ? 'Match this concept to a creator' : 'Start a cycle — match a concept to a creator'}
            </div>
            <button type="button" className="flow-btn" onClick={() => { setMatcherOpen(false); setResults(null); setSeedCard(null); }}>Close</button>
          </div>
          <form className="flow-matcher-form" onSubmit={runMatcher}>
            <input className="wide" placeholder="Product (e.g. R1 firepit)" value={concept.product} onChange={e => setConcept({ ...concept, product: e.target.value })} />
            <input className="wide" placeholder="Angle (e.g. burn ban anywhere)" value={concept.angle} onChange={e => setConcept({ ...concept, angle: e.target.value })} />
            <input placeholder="Format (optional)" value={concept.format} onChange={e => setConcept({ ...concept, format: e.target.value })} />
            <input className="wide" placeholder="Objective (optional)" value={concept.objective} onChange={e => setConcept({ ...concept, objective: e.target.value })} />
            <button className="primary-action" disabled={matching || (!concept.product && !concept.angle)}>{matching ? 'Matching…' : 'Find creators'}</button>
          </form>

          {results && (
            <div className="flow-results">
              {!results.creators.length && <div className="flow-empty">No qualified or contracted creators to rank yet.</div>}
              {results.creators.map((c, i) => (
                <div className="flow-result" key={c.creator_id}>
                  <div className="flow-rank">{i + 1}</div>
                  <div>
                    <div className="flow-result-name">{c.name} {c.proven && <span className="flow-tag flame">proven</span>}</div>
                    <div className="flow-result-rationale">{c.rationale}</div>
                    <div className="flow-result-signals">
                      {c.fit_signals.slice(0, 3).map((s, j) => <span className="flow-tag" key={j}>{s.replace(/\.$/, '')}</span>)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="flow-score">fit {c.score}{c.roas > 0 ? ` · ${c.roas.toFixed(1)}x` : ''}</div>
                    {canManage && (
                      <button type="button" className="flow-btn primary" disabled={busyId === c.creator_id} onClick={() => briefCreator(c)}>
                        {busyId === c.creator_id ? 'Briefing…' : 'Brief this creator'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* attribution autopilot */}
      {attrib?.summary?.groups > 0 && (
        <div className="flow-attrib">
          <div className="flow-attrib-bar">
            <div>
              <span className="flow-attrib-head">Attribution</span>
              <span className="flow-attrib-sub">
                {attrib.summary.groups} ads · ${attrib.summary.spend.toLocaleString()} spend unattributed ·{' '}
                {attrib.summary.high} ready to auto-link (${attrib.summary.high_spend.toLocaleString()})
              </span>
              {attrib.summary.high === 0 && (
                <p className="flow-attrib-note">No confident name match yet. Review manually, or tag founder, internal, and tool-made ads in Creative Analytics.</p>
              )}
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                {attrib.summary.high > 0 && (
                  <button type="button" className="flow-btn primary" disabled={attribBusy} onClick={applyAutoHigh}>
                    {attribBusy ? 'Linking…' : `Auto-link ${attrib.summary.high} high-confidence`}
                  </button>
                )}
                <button type="button" className="flow-btn" onClick={() => setAttribOpen(v => !v)}>{attribOpen ? 'Hide' : 'Review all'}</button>
              </div>
            )}
          </div>
          {attribOpen && (
            <div className="flow-attrib-list">
              {attrib.suggestions.slice(0, 60).map(s => {
                const sel = overrides[s.group_key] ?? s.match?.creator_id ?? '';
                return (
                  <div className="flow-attrib-row" key={s.group_key}>
                    <div className="flow-attrib-ad" title={s.ad_name}>{s.ad_name || '(no name)'}</div>
                    <div className="flow-attrib-spend">${Math.round(s.spend).toLocaleString()}</div>
                    <span className={`flow-tag ${s.match?.confidence === 'high' ? 'flame' : ''}`}>{s.match?.confidence || 'no match'}</span>
                    <select value={sel} onChange={e => setOverrides({ ...overrides, [s.group_key]: e.target.value })}>
                      <option value="">Unassigned…</option>
                      {(attrib.creators || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {canManage && <button type="button" className="flow-btn primary" disabled={attribBusy || !sel} onClick={() => applyOne(s.group_key, Number(sel))}>Link</button>}
                  </div>
                );
              })}
              {attrib.suggestions.length > 60 && <div className="flow-col-empty">Showing top 60 by spend of {attrib.suggestions.length}.</div>}
            </div>
          )}
        </div>
      )}

      {/* board */}
      <div className="flow-board">
        {STAGE_ORDER.map(stage => {
          const cards = cols[stage] || [];
          const onDrop = e => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData('text/plain'));
            setDragOverStage(null); setDraggingId(null);
            if (id) patchCard(id, { stage });
          };
          return (
            <div
              className={`flow-col${dragOverStage === stage ? ' drop' : ''}`}
              key={stage}
              onDragOver={canManage ? (e => { e.preventDefault(); setDragOverStage(stage); }) : undefined}
              onDragLeave={canManage ? (() => setDragOverStage(s => s === stage ? null : s)) : undefined}
              onDrop={canManage ? onDrop : undefined}
            >
              <div className="flow-col-head">
                <span className="k">{STAGE_LABELS[stage]}</span>
                <span className="n">{counts[stage] || 0}</span>
              </div>
              <div className="flow-col-body">
                {stage === 'ideate' && winners.map(w => (
                  <div className="flow-card win" key={w.group_key}>
                    <div className="flow-card-title">{w.angle || w.name || 'Analyzed winner'}</div>
                    <div className="flow-card-meta">
                      {w.format && <span className="flow-tag">{w.format}</span>}
                      {w.spend > 0 && <span className="flow-tag flame">${Math.round(w.spend).toLocaleString()} spend</span>}
                    </div>
                    {canManage && (
                      <div className="flow-card-actions">
                        <button type="button" className="flow-btn primary" onClick={() => pullWinner(w)}>Iterate this</button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Derived cards from real launched/analyzed creative (read-only) */}
                {cards.filter(c => c.derived).map(card => (
                  <div className="flow-card derived" key={`d-${card.group_key}`}>
                    <div className="flow-card-title">{card.title}</div>
                    <div className="flow-card-meta">
                      {card.spend > 0 && <span className="flow-tag">${Math.round(card.spend).toLocaleString()} spend</span>}
                      {card.roas > 0 && <span className={`flow-tag ${card.roas >= 2 ? 'flame' : ''}`}>{card.roas.toFixed(2)}x</span>}
                    </div>
                    <div className="flow-card-creator">
                      {card.creator_name ? <>Creator: <b>{card.creator_name}</b></> : <span style={{ color: 'var(--muted2)' }}>Unattributed</span>}
                    </div>
                    {canManage && (
                      <div className="flow-card-actions">
                        <button type="button" className="flow-btn primary" onClick={() => iterateDerived(card)}>Iterate this</button>
                        {card.creator_id && <button type="button" className="flow-btn" onClick={() => setActiveTab?.('creative-analytics')}>Analytics</button>}
                      </div>
                    )}
                  </div>
                ))}

                {cards.filter(c => !c.derived).map(card => {
                  const action = cardAction(card);
                  const conceptJson = card.concept_json || {};
                  const budget = money(conceptJson.allocated_budget);
                  const strategyLine = conceptJson.performance_logic || conceptJson.creator_match || conceptJson.hypothesis || null;
                  return (
                    <div
                      className={`flow-card${draggingId === card.id ? ' dragging' : ''}`}
                      key={card.id}
                      draggable={canManage}
                      onDragStart={canManage ? (e => { e.dataTransfer.setData('text/plain', String(card.id)); e.dataTransfer.effectAllowed = 'move'; setDraggingId(card.id); }) : undefined}
                      onDragEnd={canManage ? (() => { setDraggingId(null); setDragOverStage(null); }) : undefined}
                    >
                      <div className="flow-card-title">{card.title || card.angle || 'Untitled concept'}</div>
                      {card.from_winner_label && <div className="flow-card-prov">↺ from “{card.from_winner_label}”</div>}
                      <div className="flow-card-meta">
                        {card.format && <span className="flow-tag">{card.format}</span>}
                        {conceptJson.cohort && <span className="flow-tag">{conceptJson.cohort.replace('_', ' ')}</span>}
                        {budget && <span className="flow-tag flame">{budget}</span>}
                        {card.brief_status && <span className="flow-tag">brief: {card.brief_status}</span>}
                        {card.deliverable_status && <span className="flow-tag">{card.deliverable_status}</span>}
                        {card.manual_stage && card.manual_stage !== card.stage && <span className="flow-tag flame">synced</span>}
                      </div>
                      <div className="flow-card-creator">
                        {card.creator_name ? <>Creator: <b>{card.creator_name}</b></> : <span style={{ color: 'var(--muted2)' }}>Unmatched</span>}
                      </div>
                      {card.stage_reason && (
                        <div className="flow-card-reason">{card.stage_reason}</div>
                      )}
                      {strategyLine && (
                        <div className="flow-card-strategy">
                          <span>Why this exists</span>
                          <p>{strategyLine}</p>
                        </div>
                      )}
                      {!!conceptJson.hooks?.length && (
                        <div className="flow-card-hooks">
                          {conceptJson.hooks.slice(0, 2).map((hook, index) => <span key={index}>{hook}</span>)}
                        </div>
                      )}
                      {canManage && (
                        <div className="flow-card-actions">
                          {action && <button type="button" className="flow-btn primary" onClick={action.fn}>{action.label}</button>}
                          {NEXT[card.stage] && <button type="button" className="flow-btn" title="Advance stage" onClick={() => patchCard(card.id, { stage: NEXT[card.stage] })}>→ {STAGE_LABELS[NEXT[card.stage]]}</button>}
                          <button type="button" className="flow-btn" title="Archive" onClick={() => patchCard(card.id, { archived: true })}>×</button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {!cards.length && !(stage === 'ideate' && winners.length) && (
                  <div className="flow-col-empty">{stage === 'ideate' ? 'Start a cycle or iterate a winner' : 'Nothing here yet'}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
