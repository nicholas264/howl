import { useCallback, useEffect, useState } from 'react';

const STAGE_LABELS = {
  ideate: 'Ideate', match: 'Match', brief: 'Brief', produce: 'Produce',
  launch: 'Launch', analyze: 'Analyze', iterate: 'Iterate',
};
const STAGE_ORDER = ['ideate', 'match', 'brief', 'produce', 'launch', 'analyze', 'iterate'];
const NEXT = { ideate: 'match', match: 'brief', brief: 'produce', produce: 'launch', launch: 'analyze', analyze: 'iterate' };

const EMPTY_CONCEPT = { product: '', angle: '', format: '', objective: '' };

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

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/creative-flow');
      if (!res.ok) throw new Error('Failed to load board');
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      const res = await fetch('/api/concept-creator-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(concept),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Match failed');
      setResults(await res.json());
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
      const briefRes = await fetch('/api/creator-workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: creator.creator_id, action: 'generate_brief',
          product: concept.product, objective: concept.objective, angle: concept.angle,
          direction: '', strategy_mode: 'past_performers',
        }),
      });
      if (!briefRes.ok) throw new Error((await briefRes.json()).error || 'Brief generation failed');
      const { brief } = await briefRes.json();

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
        return { label: 'Open production', fn: () => onOpenCreator?.(card.creator_id, 'deliverables') };
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

      {/* board */}
      <div className="flow-board">
        {STAGE_ORDER.map(stage => {
          const cards = cols[stage] || [];
          return (
            <div className="flow-col" key={stage}>
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

                {cards.map(card => {
                  const action = cardAction(card);
                  return (
                    <div className="flow-card" key={card.id}>
                      <div className="flow-card-title">{card.title || card.angle || 'Untitled concept'}</div>
                      <div className="flow-card-meta">
                        {card.format && <span className="flow-tag">{card.format}</span>}
                        {card.brief_status && <span className="flow-tag">brief: {card.brief_status}</span>}
                        {card.deliverable_status && <span className="flow-tag">{card.deliverable_status}</span>}
                      </div>
                      <div className="flow-card-creator">
                        {card.creator_name ? <>Creator: <b>{card.creator_name}</b></> : <span style={{ color: 'var(--muted2)' }}>Unmatched</span>}
                      </div>
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
