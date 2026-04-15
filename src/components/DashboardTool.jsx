import { useState, useCallback } from 'react';

const TYPE_COLORS = {
  static:  '#6e40c9',
  review:  '#DC440A',
  video:   '#1a7f37',
  other:   '#4a5568',
};

const TYPE_LABELS = { static: 'Static', review: 'Review', video: 'Video', other: 'Other' };

function parseAdType(name = '') {
  if (name.includes('| Static |')) return 'static';
  if (name.includes('| Review |')) return 'review';
  if (name.includes('| Video |'))  return 'video';
  return 'other';
}

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function fmtNumber(n) {
  if (!n) return '—';
  const num = parseFloat(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function fmtCurrency(n) {
  if (!n) return '—';
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtCtr(n) {
  if (!n) return '—';
  return parseFloat(n).toFixed(2) + '%';
}

const S = {
  wrap:    { padding: '28px 36px', maxWidth: 1100 },
  label:   { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 8, display: 'block' },
  ghostBtn:{ padding: '9px 18px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  btn:     { padding: '9px 18px', background: '#DC440A', border: 'none', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  card:    { background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: '16px 20px' },
  stat:    { fontSize: 28, fontWeight: 700, color: '#f0f4f8', lineHeight: 1 },
  divider: { borderTop: '1px solid #2a3441', margin: '28px 0' },
  err:     { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 10, borderRadius: 4 },
};

export default function DashboardTool() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_dashboard' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const ads = data?.ads || [];

  const now = new Date();
  const thisMonthKey = getMonthKey(now.toISOString());
  const thisYear     = now.getFullYear();

  const typeCounts = { static: 0, review: 0, video: 0, other: 0 };
  const monthMap   = {}; // key → { total, static, review, video, other }

  for (const ad of ads) {
    const type  = parseAdType(ad.name);
    const mKey  = getMonthKey(ad.created_time);
    typeCounts[type]++;
    if (!monthMap[mKey]) monthMap[mKey] = { total: 0, static: 0, review: 0, video: 0, other: 0 };
    monthMap[mKey].total++;
    monthMap[mKey][type]++;
  }

  const totalShipped  = ads.length;
  const thisMonthCount = monthMap[thisMonthKey]?.total || 0;
  const thisYearCount  = ads.filter(a => new Date(a.created_time).getFullYear() === thisYear).length;
  const activeCount    = ads.filter(a => a.status === 'ACTIVE').length;

  // Last 6 months for chart
  const chartMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    chartMonths.push(getMonthKey(d.toISOString()));
  }
  const maxBarCount = Math.max(...chartMonths.map(k => monthMap[k]?.total || 0), 1);

  const insights = data?.insights;

  // Recent 10 ads (sorted newest first)
  const recent = [...ads].sort((a, b) => new Date(b.created_time) - new Date(a.created_time)).slice(0, 10);

  // ── Active budget breakdown ──────────────────────────────────────────────
  const activeAdsets = data?.activeAdsets || [];
  const totalDailyBudget = activeAdsets.reduce((sum, as) => {
    const daily = as.daily_budget ? parseInt(as.daily_budget, 10) / 100 : 0;
    return sum + daily;
  }, 0);
  const totalLifetimeBudget = activeAdsets.reduce((sum, as) => {
    const lt = as.lifetime_budget ? parseInt(as.lifetime_budget, 10) / 100 : 0;
    return sum + lt;
  }, 0);
  const totalBudgetRemaining = activeAdsets.reduce((sum, as) => {
    const rem = as.budget_remaining ? parseInt(as.budget_remaining, 10) / 100 : 0;
    return sum + rem;
  }, 0);

  // Group active ad sets by campaign for breakdown
  const campaignNames = data?.campaignNames || {};
  const campaignBudgets = {};
  for (const as of activeAdsets) {
    const cid = as.campaign_id || 'unknown';
    if (!campaignBudgets[cid]) campaignBudgets[cid] = { adsets: [], totalDaily: 0 };
    const daily = as.daily_budget ? parseInt(as.daily_budget, 10) / 100 : 0;
    campaignBudgets[cid].adsets.push(as);
    campaignBudgets[cid].totalDaily += daily;
  }

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <span style={{ ...S.label, marginBottom: 0 }}>Ads Dashboard</span>
        <button onClick={loadDashboard} disabled={loading} style={loading ? { ...S.ghostBtn, cursor: 'not-allowed' } : S.btn}>
          {loading ? 'Loading…' : data ? 'Refresh' : 'Load Dashboard'}
        </button>
        {lastUpdated && (
          <span style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div style={{ ...S.err, marginBottom: 20 }}>{error}</div>}

      {!data && !loading && (
        <div style={{ color: '#6e7681', fontSize: 12, padding: '40px 0' }}>
          Click "Load Dashboard" to pull your ad shipping data from Meta.
        </div>
      )}

      {data && (
        <>
          {/* Live daily budget */}
          <div style={{ ...S.card, marginBottom: 20, borderColor: totalDailyBudget > 0 ? '#DC440A' : '#2a3441' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
              <div>
                <span style={S.label}>Live Daily Budget</span>
                <div style={{ fontSize: 36, fontWeight: 700, color: '#f0f4f8', lineHeight: 1 }}>
                  ${totalDailyBudget.toFixed(0)}<span style={{ fontSize: 16, color: '#8b949e', fontWeight: 400 }}>/day</span>
                </div>
                <div style={{ fontSize: 10, color: '#8b949e', marginTop: 8, letterSpacing: 1 }}>
                  {activeAdsets.length} active ad set{activeAdsets.length !== 1 ? 's' : ''}
                  {totalDailyBudget > 0 && <> — <span style={{ color: '#f0f4f8' }}>${(totalDailyBudget * 7).toFixed(0)}/wk</span> — <span style={{ color: '#f0f4f8' }}>${(totalDailyBudget * 30).toFixed(0)}/mo</span></>}
                </div>
                {totalLifetimeBudget > 0 && (
                  <div style={{ fontSize: 9, color: '#6e7681', marginTop: 4, letterSpacing: 1 }}>
                    + ${totalLifetimeBudget.toFixed(0)} in lifetime budgets (${totalBudgetRemaining.toFixed(0)} remaining)
                  </div>
                )}
              </div>
              {/* Per-campaign breakdown */}
              {Object.keys(campaignBudgets).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
                  <span style={{ ...S.label, marginBottom: 0 }}>By Campaign</span>
                  {Object.entries(campaignBudgets).sort((a, b) => b[1].totalDaily - a[1].totalDaily).slice(0, 6).map(([cid, cb]) => {
                    const pct = totalDailyBudget > 0 ? (cb.totalDaily / totalDailyBudget) * 100 : 0;
                    const campaignName = campaignNames[cid] || cid.slice(-8);
                    return (
                      <div key={cid}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: '#c9d1d9', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {campaignName} <span style={{ color: '#6e7681' }}>({cb.adsets.length})</span>
                          </span>
                          <span style={{ fontSize: 9, color: '#f0f4f8', fontWeight: 600 }}>${cb.totalDaily.toFixed(0)}/day</span>
                        </div>
                        <div style={{ height: 3, background: '#1c2330', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: '#DC440A', borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Top stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Shipped',  value: totalShipped },
              { label: 'This Month',     value: thisMonthCount },
              { label: 'This Year',      value: thisYearCount },
              { label: 'Currently Active', value: activeCount },
            ].map(({ label, value }) => (
              <div key={label} style={S.card}>
                <span style={S.label}>{label}</span>
                <div style={S.stat}>{value}</div>
              </div>
            ))}
          </div>

          {/* Type breakdown + 30-day insights */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {/* Type breakdown */}
            <div style={S.card}>
              <span style={S.label}>Type Breakdown</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                {Object.entries(typeCounts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const pct = totalShipped > 0 ? Math.round((count / totalShipped) * 100) : 0;
                  return (
                    <div key={type}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: TYPE_COLORS[type], fontWeight: 700, letterSpacing: 1 }}>{TYPE_LABELS[type]}</span>
                        <span style={{ fontSize: 11, color: '#8b949e' }}>{count} <span style={{ color: '#6e7681' }}>({pct}%)</span></span>
                      </div>
                      <div style={{ height: 4, background: '#2a3441', borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: TYPE_COLORS[type], borderRadius: 2, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 30-day account insights */}
            <div style={S.card}>
              <span style={S.label}>30-Day Account Stats</span>
              {insights ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 }}>
                  {[
                    { label: 'Spend',       value: fmtCurrency(insights.spend) },
                    { label: 'Impressions', value: fmtNumber(insights.impressions) },
                    { label: 'Clicks',      value: fmtNumber(insights.clicks) },
                    { label: 'CTR',         value: fmtCtr(insights.ctr) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <span style={{ ...S.label, marginBottom: 4 }}>{label}</span>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#f0f4f8' }}>{value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#6e7681', fontSize: 11, marginTop: 8 }}>No spend data available for this period.</div>
              )}
            </div>
          </div>

          {/* Monthly shipping velocity */}
          <div style={{ ...S.card, marginBottom: 20 }}>
            <span style={S.label}>Monthly Shipping Velocity</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {chartMonths.map(mKey => {
                const m = monthMap[mKey] || { total: 0 };
                const barPct = (m.total / maxBarCount) * 100;
                return (
                  <div key={mKey} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 10, color: '#8b949e', width: 48, flexShrink: 0, textAlign: 'right' }}>
                      {formatMonthLabel(mKey)}
                    </span>
                    <div style={{ flex: 1, height: 20, background: '#1c2330', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                      {/* Stacked bar: static / review / video / other */}
                      <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                        {['static', 'review', 'video', 'other'].map(type => {
                          const typeCount = monthMap[mKey]?.[type] || 0;
                          if (!typeCount) return null;
                          const typePct = m.total > 0 ? (typeCount / m.total) * 100 : 0;
                          return (
                            <div key={type} title={`${TYPE_LABELS[type]}: ${typeCount}`} style={{ width: `${typePct}%`, background: TYPE_COLORS[type], height: '100%' }} />
                          );
                        })}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: m.total > 0 ? '#f0f4f8' : '#6e7681', width: 28, textAlign: 'right', fontWeight: m.total > 0 ? 700 : 400 }}>
                      {m.total || '—'}
                    </span>
                    {/* Type mini breakdown */}
                    {m.total > 0 && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {['static', 'review', 'video'].filter(t => monthMap[mKey]?.[t] > 0).map(t => (
                          <span key={t} style={{ fontSize: 8, color: TYPE_COLORS[t], letterSpacing: 1, textTransform: 'uppercase' }}>
                            {monthMap[mKey][t]}{TYPE_LABELS[t][0]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 9, color: '#8b949e', letterSpacing: 1 }}>{TYPE_LABELS[type]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent ads */}
          <div style={S.card}>
            <span style={S.label}>Recent Ads</span>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead>
                <tr>
                  {['Name', 'Type', 'Status', 'Created'].map(h => (
                    <th key={h} style={{ fontSize: 8, letterSpacing: 2, color: '#6e7681', textAlign: 'left', padding: '4px 8px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map(ad => {
                  const type = parseAdType(ad.name);
                  return (
                    <tr key={ad.id} style={{ borderTop: '1px solid #2a3441' }}>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#c9d1d9', maxWidth: 320 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{ad.name}</span>
                      </td>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 9, letterSpacing: 1 }}>
                        <span style={{ color: TYPE_COLORS[type], textTransform: 'uppercase' }}>{TYPE_LABELS[type]}</span>
                      </td>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 9 }}>
                        <span style={{ color: ad.status === 'ACTIVE' ? '#3fb950' : ad.status === 'PAUSED' ? '#8b949e' : '#f85149', letterSpacing: 1, textTransform: 'uppercase' }}>
                          {ad.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 0', fontSize: 10, color: '#8b949e', whiteSpace: 'nowrap' }}>
                        {new Date(ad.created_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ads.length > 10 && (
              <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, letterSpacing: 1 }}>
                Showing 10 most recent of {ads.length} total ads
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
