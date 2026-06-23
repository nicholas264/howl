import { useCallback, useEffect, useMemo, useState } from 'react';

// Heat ramp: cool ash at the top of the pipeline, hot flame where creators ship.
const STAGES = [
  { key: 'sourced', label: 'Sourced', color: '#8d8a82' },
  { key: 'contacted', label: 'Contacted', color: '#c98a4e' },
  { key: 'interested', label: 'Interested', color: '#d9772f' },
  { key: 'briefing', label: 'Briefing', color: '#e05f1f' },
  { key: 'producing', label: 'Producing', color: '#df4d12' },
  { key: 'active', label: 'Active', color: '#f24405' },
];
const ALUMNI = { key: 'alumni', label: 'Graduated', color: '#5f5b54' };
const PRODUCTION_STAGES = new Set(['producing', 'active']);

// SVG geometry.
const BAND_H = 64;
const TOP_PAD = 10;
const CX = 210;
const MAX_HALF = 165;
const SPOUT_HALF = 13;

function fmtAssets(value) {
  if (!value) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function CreatorPipelineFunnel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/creators?summary=funnel');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (err) {
      setError(err.message || 'Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const model = useMemo(() => {
    if (!data) return null;
    const find = key => data.funnel.find(f => f.stage === key) || { creatorCount: 0, contractedCount: 0, retainerMonthly: 0, committedAssets: 0 };
    const stages = STAGES.map(s => ({ ...s, ...find(s.key) }));
    const alumni = { ...ALUMNI, ...find(ALUMNI.key) };
    const maxCount = Math.max(1, ...stages.map(s => s.creatorCount));

    // Half-widths per band, with a floor so empty stages still render a sliver.
    const half = stages.map(s => Math.max((s.creatorCount / maxCount) * MAX_HALF, 9));
    const yTop = i => TOP_PAD + i * BAND_H;
    const spoutBottomY = yTop(stages.length) + 30;
    const tipY = spoutBottomY + 14;

    const bands = stages.map((s, i) => {
      const topH = half[i];
      const botH = i < stages.length - 1 ? half[i + 1] : SPOUT_HALF;
      const yt = yTop(i);
      const yb = yTop(i + 1);
      return {
        ...s,
        topH, botH, yt, yb,
        points: `${CX - topH},${yt} ${CX + topH},${yt} ${CX + botH},${yb} ${CX - botH},${yb}`,
        labelY: yt + BAND_H / 2,
      };
    });

    // Funnel silhouette for clipping the flow + embers.
    const left = bands.map(b => `${CX - b.topH},${b.yt}`);
    left.push(`${CX - SPOUT_HALF},${yTop(stages.length)}`, `${CX - SPOUT_HALF},${spoutBottomY}`, `${CX},${tipY}`);
    const right = [`${CX + SPOUT_HALF},${spoutBottomY}`, `${CX + SPOUT_HALF},${yTop(stages.length)}`];
    bands.slice().reverse().forEach(b => right.push(`${CX + b.topH},${b.yt}`));
    const silhouette = `M ${left.join(' L ')} L ${right.join(' L ')} Z`;

    const totals = data.totals;

    return { stages, alumni, bands, silhouette, spoutBottomY, tipY, totals, maxCount };
  }, [data]);

  if (loading && !data) return <div className="forge"><div className="forge-empty">Stoking the pipeline…</div></div>;
  if (error) return <div className="forge"><div className="forge-empty">{error}</div></div>;
  if (!model) return null;

  const { stages, alumni, bands, silhouette, spoutBottomY, tipY, totals } = model;
  const totalForShare = stages.reduce((sum, s) => sum + s.creatorCount, 0) || 1;
  const sel = selected ? [...stages, alumni].find(s => s.key === selected) : null;

  const embers = Array.from({ length: 8 }, (_, i) => i);
  const sparks = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div className="forge">
      <div className="forge-head">
        <div>
          <div className="forge-eyebrow">Creative Production Pipeline</div>
          <h1>The Forge</h1>
          <p className="forge-sub">
            Where creators sit in the pipeline, and what the fire produces. Each contracted creator feeds an
            expected number of new assets per month. Tap a stage to inspect it.
          </p>
        </div>
        <button type="button" className="primary-action" onClick={load} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="forge-grid">
        {/* ── Flame funnel ─────────────────────────────────────────────── */}
        <div>
          <svg className="forge-stage-svg" viewBox="-112 0 644 476" role="img" aria-label="Creator pipeline funnel">
            <defs>
              <clipPath id="forge-clip"><path d={silhouette} /></clipPath>
              <linearGradient id="forge-shade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(255,255,255,0.10)" />
                <stop offset="1" stopColor="rgba(0,0,0,0.22)" />
              </linearGradient>
              <radialGradient id="forge-heat" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="rgba(242,68,5,0.42)" />
                <stop offset="1" stopColor="rgba(242,68,5,0)" />
              </radialGradient>
            </defs>

            {/* heat glow behind the hot end */}
            <ellipse className="forge-glow" cx={CX} cy={spoutBottomY - 30} rx="150" ry="120" fill="url(#forge-heat)" />

            {/* stage bands */}
            {bands.map(b => (
              <g
                key={b.key}
                className={`forge-band${selected && selected !== b.key ? ' dim' : ''}`}
                onClick={() => setSelected(selected === b.key ? null : b.key)}
                style={{ animationDelay: `${bands.indexOf(b) * 70}ms` }}
              >
                <polygon points={b.points} fill={b.color} />
                <polygon points={b.points} fill="url(#forge-shade)" />
                {selected === b.key && (
                  <polygon points={b.points} fill="none" stroke="#fff8ef" strokeWidth="1.5" />
                )}
                <text className="forge-band-label" x={-14} y={b.labelY + 1} textAnchor="end">{b.label}</text>
                <text className="forge-band-count" x={CX} y={b.labelY + 9} textAnchor="middle">{b.creatorCount}</text>
                <text className="forge-band-assets" x={434} y={b.labelY + 1} textAnchor="start">
                  {b.retainerMonthly > 0
                    ? `${fmtAssets(b.retainerMonthly)}/mo`
                    : b.committedAssets > 0
                      ? `${fmtAssets(b.committedAssets)} due`
                      : b.contractedCount ? `${b.contractedCount} signed` : '·'}
                </text>
              </g>
            ))}

            {/* flowing arrows + embers down the throat */}
            <g clipPath="url(#forge-clip)">
              {[-20, 0, 20].map(dx => (
                <path
                  key={dx}
                  className="forge-flow-line"
                  d={`M ${CX + dx},${TOP_PAD + 6} L ${CX + dx * 0.2},${spoutBottomY}`}
                  style={{ animationDelay: `${(dx + 20) * 12}ms` }}
                />
              ))}
              {embers.map(i => {
                const startX = CX + (i % 4 - 1.5) * 22;
                return (
                  <circle
                    key={i}
                    className="forge-ember"
                    cx={startX}
                    cy={TOP_PAD + 14}
                    r={2 + (i % 3)}
                    fill={i % 2 ? '#ffb347' : '#f24405'}
                    style={{ '--fall': `${tipY - TOP_PAD - 14}px`, '--dur': `${2.8 + (i % 4) * 0.5}s`, '--delay': `${i * 0.42}s` }}
                  />
                );
              })}
            </g>

            {/* sparks pouring out of the spout = assets produced */}
            {sparks.map(i => (
              <circle
                key={i}
                className="forge-spark"
                cx={CX}
                cy={tipY}
                r={1.6 + (i % 2)}
                fill={i % 2 ? '#ffce6b' : '#f2670a'}
                style={{ '--sx': `${(i % 3 - 1) * 26}px`, '--sy': `${30 + (i % 3) * 10}px`, '--dur': `${1.4 + (i % 3) * 0.3}s`, '--delay': `${i * 0.26}s` }}
              />
            ))}
          </svg>

          {/* graduated / cooled embers, kept out of the active taper */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setSelected(selected === alumni.key ? null : alumni.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 14px', cursor: 'pointer',
                background: selected === alumni.key ? '#efece6' : 'transparent',
                border: '1px solid var(--border)', borderRadius: 999, color: 'var(--muted)',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: alumni.color }} />
              Graduated · {alumni.creatorCount} creators
            </button>
          </div>
        </div>

        {/* ── Right rail ───────────────────────────────────────────────── */}
        <div>
          <div className="forge-hero">
            <div className="forge-hero-label">Recurring assets / month</div>
            <div className="forge-hero-num">{fmtAssets(totals.retainerMonthly)}</div>
            <div className="forge-hero-unit">from retainer creators</div>
            <p className="forge-hero-note">
              Retainers contribute their monthly commitment. One-off creators add {fmtAssets(totals.committedAssets)} committed
              deliverables on top. When no contract is recorded, the funnel falls back to a creator's agreed deliverables.
            </p>
          </div>

          <div className="forge-stats">
            <div className="forge-stat"><div className="k">In pipeline</div><div className="v">{totals.creatorCount.toLocaleString()}</div></div>
            <div className="forge-stat"><div className="k">Under contract</div><div className="v">{totals.contractedCount.toLocaleString()}</div></div>
            <div className="forge-stat"><div className="k">Recurring / mo</div><div className="v" style={{ color: totals.retainerMonthly ? 'var(--flame)' : 'inherit' }}>{fmtAssets(totals.retainerMonthly)}</div></div>
            <div className="forge-stat"><div className="k">Committed deliverables</div><div className="v">{fmtAssets(totals.committedAssets)}</div></div>
          </div>

          {sel ? (
            <div className="forge-detail" key={sel.key}>
              <div className="forge-detail-stage">
                <span className="forge-detail-dot" style={{ background: sel.color }} />
                <h3>{sel.label}</h3>
              </div>
              <div className="forge-detail-rows">
                <div className="forge-detail-row"><span className="k">Creators</span><span className="v">{sel.creatorCount}</span></div>
                <div className="forge-detail-row"><span className="k">Under contract</span><span className="v">{sel.contractedCount}</span></div>
                <div className="forge-detail-row"><span className="k">Recurring / mo</span><span className="v" style={{ color: sel.retainerMonthly ? 'var(--flame)' : 'inherit' }}>{fmtAssets(sel.retainerMonthly)}</span></div>
                <div className="forge-detail-row"><span className="k">Committed deliverables</span><span className="v">{fmtAssets(sel.committedAssets)}</span></div>
                {sel.key !== 'alumni' && (
                  <div className="forge-detail-row"><span className="k">Share of pipeline</span><span className="v">{Math.round((sel.creatorCount / totalForShare) * 100)}%</span></div>
                )}
              </div>
            </div>
          ) : (
            <div className="forge-hint">Tap a stage to focus it</div>
          )}
        </div>
      </div>
    </div>
  );
}
