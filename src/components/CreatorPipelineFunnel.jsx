import { useCallback, useEffect, useState } from 'react';

const STAGE_META = [
  ['sourced', 'Sourced', '#b9b4a8'],
  ['contacted', 'Contacted', '#c79a6b'],
  ['interested', 'Interested', '#d4923f'],
  ['briefing', 'Briefing', '#e07b2e'],
  ['producing', 'Producing', '#d84a17'],
  ['active', 'Active', '#2ea98f'],
  ['alumni', 'Alumni', '#9a958c'],
];

// Stages where signed creators are actively shipping creative.
const PRODUCTION_STAGES = new Set(['producing', 'active']);

function fmtAssets(value) {
  if (!value) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function CreatorPipelineFunnel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/creators?summary=funnel');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="creator-empty">Loading pipeline…</div>;
  if (error) return <div className="creator-empty">{error}</div>;
  if (!data) return null;

  const { funnel, totals } = data;
  const rows = STAGE_META.map(([key, label, color]) => {
    const row = funnel.find(f => f.stage === key) || { creatorCount: 0, contractedCount: 0, monthlyAssets: 0 };
    return { key, label, color, ...row };
  });
  const maxCount = Math.max(1, ...rows.map(r => r.creatorCount));

  // Expected monthly assets from creators currently in production-bearing stages.
  const producingAssets = rows
    .filter(r => PRODUCTION_STAGES.has(r.key))
    .reduce((sum, r) => sum + r.monthlyAssets, 0);

  const headline = [
    { label: 'Creators in pipeline', value: totals.creatorCount.toLocaleString() },
    { label: 'Under contract', value: totals.contractedCount.toLocaleString() },
    { label: 'Expected assets / mo (producing + active)', value: fmtAssets(Math.round(producingAssets * 10) / 10), accent: true },
    { label: 'Contracted run rate / mo (all stages)', value: fmtAssets(totals.monthlyAssets) },
  ];

  return (
    <div className="creator-pipeline-funnel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {headline.map(({ label, value, accent }) => (
          <div key={label} style={{ background: '#fff', border: '1px solid #e7e3da', borderRadius: 8, padding: '14px 16px' }}>
            <span style={{ fontSize: 9, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, marginTop: 6, color: accent ? '#d84a17' : '#171717' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e7e3da', borderRadius: 8, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 10, color: '#77746f', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 }}>Creative Production Pipeline</span>
          <span style={{ fontSize: 9, color: '#a8a39a', letterSpacing: 1 }}>creators per stage · expected assets / month</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const widthPct = (r.creatorCount / maxCount) * 100;
            return (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, color: '#57544f', width: 88, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>{r.label}</span>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div
                    title={`${r.creatorCount} creators · ${r.contractedCount} contracted`}
                    style={{
                      width: `${Math.max(widthPct, r.creatorCount ? 8 : 2)}%`,
                      minWidth: r.creatorCount ? 36 : 6,
                      height: 30,
                      background: r.color,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 700,
                      transition: 'width 0.4s',
                    }}
                  >
                    {r.creatorCount || ''}
                  </div>
                </div>
                <div style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  {r.monthlyAssets > 0 ? (
                    <>
                      <span style={{ fontSize: 13, fontWeight: 700, color: PRODUCTION_STAGES.has(r.key) ? '#d84a17' : '#57544f' }}>{fmtAssets(r.monthlyAssets)} assets/mo</span>
                      <span style={{ fontSize: 9, color: '#a8a39a', letterSpacing: 1 }}>{r.contractedCount} contracted</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: '#c4bfb5' }}>{r.contractedCount ? `${r.contractedCount} contracted` : '—'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 10, color: '#a8a39a', marginTop: 16, lineHeight: 1.5 }}>
          Expected assets/month is derived from each creator's active or approved contract. Monthly commitments count
          directly; fixed total commitments are amortized across the contract's start–end span. Headline “producing + active”
          reflects creators who are currently shipping.
        </p>
      </div>
    </div>
  );
}
