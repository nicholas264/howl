import { useState, useCallback, useEffect } from 'react';

const TYPE_COLORS = {
  static:  '#6e40c9',
  review:  '#DC440A',
  video:   '#1a7f37',
  other:   '#4a5568',
};

const TYPE_LABELS = { static: 'Static', review: 'Review', video: 'Video', other: 'Other' };

function parseAdType(ad) {
  const name = ad?.name || '';
  const objectType = ad?.creative?.object_type || '';

  // Check name convention first
  if (name.includes('| Static |')) return 'static';
  if (name.includes('| Review |')) return 'review';
  if (name.includes('| Video |'))  return 'video';

  // Fall back to creative object_type from Meta
  if (objectType === 'VIDEO') return 'video';
  if (objectType === 'PHOTO' || objectType === 'SHARE') return 'static';

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

  // Launch history (DB-backed — more reliable than Meta's filtered list)
  const [launches, setLaunches] = useState(null);
  const [launchesError, setLaunchesError] = useState('');

  const loadLaunches = useCallback(async () => {
    try {
      const r = await fetch('/api/db/launch-history?limit=1000');
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setLaunches(d.rows || []);
    } catch (err) {
      setLaunchesError(err.message);
    }
  }, []);

  useEffect(() => { loadLaunches(); }, [loadLaunches]);

  // Shopify analytics state
  const [shopifyData,    setShopifyData]    = useState(null);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError,   setShopifyError]   = useState('');
  const [shopifyUpdated, setShopifyUpdated] = useState(null);

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

  const loadShopify = useCallback(async () => {
    setShopifyLoading(true);
    setShopifyError('');
    try {
      const r = await fetch('/api/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_analytics' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setShopifyData(d);
      setShopifyUpdated(new Date());
    } catch (err) {
      setShopifyError(err.message);
    } finally {
      setShopifyLoading(false);
    }
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const ads = data?.ads || [];

  const now = new Date();
  const thisMonthKey = getMonthKey(now.toISOString());
  const thisYear     = now.getFullYear();

  const typeCounts = { static: 0, review: 0, video: 0, other: 0 };
  const monthMap   = {}; // key → { total, static, review, video, other }

  // Deduplicate by underlying asset (image_hash / video_id from creatives endpoint)
  const creativeAssets = data?.creativeAssets || {};
  const seenAssets = new Set();
  const uniqueAds = [];
  for (const ad of ads) {
    const cid = ad.creative?.id;
    const asset = cid ? creativeAssets[cid] : null;
    const assetKey = asset?.image_hash || asset?.video_id || cid;
    if (assetKey && seenAssets.has(assetKey)) continue;
    if (assetKey) seenAssets.add(assetKey);
    uniqueAds.push(ad);
  }

  for (const ad of uniqueAds) {
    const type  = parseAdType(ad);
    const mKey  = getMonthKey(ad.created_time);
    typeCounts[type]++;
    if (!monthMap[mKey]) monthMap[mKey] = { total: 0, static: 0, review: 0, video: 0, other: 0 };
    monthMap[mKey].total++;
    monthMap[mKey][type]++;
  }

  const totalShipped  = uniqueAds.length;
  const thisMonthCount = monthMap[thisMonthKey]?.total || 0;
  const thisYearCount  = uniqueAds.filter(a => new Date(a.created_time).getFullYear() === thisYear).length;
  const seenActiveAssets = new Set();
  const activeAds = ads.filter(a => {
    if ((a.effective_status || a.status) !== 'ACTIVE') return false;
    const cid = a.creative?.id;
    const asset = cid ? creativeAssets[cid] : null;
    const assetKey = asset?.image_hash || asset?.video_id || cid;
    if (assetKey && seenActiveAssets.has(assetKey)) return false;
    if (assetKey) seenActiveAssets.add(assetKey);
    return true;
  });
  const activeCount    = activeAds.length;

  const activeTypeCounts = { static: 0, review: 0, video: 0, other: 0 };
  for (const ad of activeAds) {
    activeTypeCounts[parseAdType(ad)]++;
  }

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
  const campaignNames = data?.campaignNames || {};
  const campaignBudgetData = data?.campaignBudgetData || {};

  // Group ad sets by campaign, detect CBO vs ABO
  const campaignBudgets = {};
  for (const as of activeAdsets) {
    const cid = as.campaign_id || 'unknown';
    if (!campaignBudgets[cid]) {
      const cb = campaignBudgetData[cid] || {};
      const isCBO = !!cb.daily_budget || !!cb.lifetime_budget;
      campaignBudgets[cid] = {
        adsets: [],
        totalDaily: 0,
        isCBO,
        campaignDailyBudget: cb.daily_budget ? parseInt(cb.daily_budget, 10) / 100 : 0,
        campaignLifetimeBudget: cb.lifetime_budget ? parseInt(cb.lifetime_budget, 10) / 100 : 0,
        campaignBudgetRemaining: cb.budget_remaining ? parseInt(cb.budget_remaining, 10) / 100 : 0,
        bidStrategy: as.bid_strategy || cb.bid_strategy || null,
      };
    }
    const daily = as.daily_budget ? parseInt(as.daily_budget, 10) / 100 : 0;
    campaignBudgets[cid].adsets.push(as);
    campaignBudgets[cid].totalDaily += daily;
  }

  // Calculate totals: use campaign budget for CBO, adset budgets for ABO
  let totalDailyBudget = 0;
  let totalLifetimeBudget = 0;
  let totalBudgetRemaining = 0;
  for (const cb of Object.values(campaignBudgets)) {
    if (cb.isCBO) {
      totalDailyBudget += cb.campaignDailyBudget;
      totalLifetimeBudget += cb.campaignLifetimeBudget;
      totalBudgetRemaining += cb.campaignBudgetRemaining;
    } else {
      for (const as of cb.adsets) {
        totalDailyBudget += as.daily_budget ? parseInt(as.daily_budget, 10) / 100 : 0;
        totalLifetimeBudget += as.lifetime_budget ? parseInt(as.lifetime_budget, 10) / 100 : 0;
        totalBudgetRemaining += as.budget_remaining ? parseInt(as.budget_remaining, 10) / 100 : 0;
      }
    }
  }

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Insights</div>
          <div className="display-lg" style={{ color: '#f0f4f8' }}>Ads Dashboard</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', marginTop: 6 }}>
            Live view of what's running and what it's costing.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdated && (
            <span style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button onClick={loadDashboard} disabled={loading} style={loading ? { ...S.ghostBtn, cursor: 'not-allowed' } : S.btn}>
            {loading ? 'Loading…' : data ? 'Refresh' : 'Load Dashboard'}
          </button>
        </div>
      </div>

      {error && <div style={{ ...S.err, marginBottom: 20 }}>{error}</div>}

      {/* Launch Log stats — DB-backed, always visible, split by format */}
      {launches && launches.length > 0 && (() => {
        const now = new Date();
        const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const last24h = new Date(now.getTime() - 24*60*60*1000);

        const classify = (l) => {
          const mt = (l.mime_type || '').toLowerCase();
          if (mt.startsWith('video/')) return 'video';
          if (mt.startsWith('image/')) return 'static';
          const name = (l.ad_name || '').toLowerCase();
          if (/\|\s*(video|ugc)\s*\|/.test(name)) return 'video';
          if (/\|\s*(static|review|founder|image)\s*\|/.test(name)) return 'static';
          return 'other';
        };

        const buckets = (since) => {
          const list = launches.filter(l => new Date(l.launched_at) >= since);
          const out = { total: list.length, video: 0, static: 0, other: 0 };
          for (const l of list) out[classify(l)]++;
          return out;
        };
        const allTime = { total: launches.length, video: 0, static: 0, other: 0 };
        for (const l of launches) allTime[classify(l)]++;

        const periods = [
          { label: '24h',         data: buckets(last24h) },
          { label: 'This Week',   data: buckets(startOfWeek) },
          { label: 'This Month',  data: buckets(startOfMonth) },
          { label: 'This Year',   data: buckets(startOfYear) },
          { label: 'All Time',    data: allTime },
        ];

        // Last 6 months velocity, by format
        const monthBuckets = {};
        for (const l of launches) {
          const d = new Date(l.launched_at);
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          if (!monthBuckets[k]) monthBuckets[k] = { total: 0, video: 0, static: 0, other: 0 };
          const t = classify(l);
          monthBuckets[k].total++;
          monthBuckets[k][t]++;
        }
        const last6 = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
          last6.push({ key: k, ...(monthBuckets[k] || { total: 0, video: 0, static: 0, other: 0 }) });
        }
        const maxLaunch = Math.max(...last6.map(m => m.total), 1);

        // Top creators (this month) split by format
        const creatorMap = {};
        for (const l of launches.filter(l => new Date(l.launched_at) >= startOfMonth)) {
          const c = l.creator || 'unknown';
          if (!creatorMap[c]) creatorMap[c] = { total: 0, video: 0, static: 0, other: 0 };
          const t = classify(l);
          creatorMap[c].total++;
          creatorMap[c][t]++;
        }
        const topCreators = Object.entries(creatorMap).sort((a,b) => b[1].total - a[1].total).slice(0, 5);

        const FMT_COLORS = { video: '#DC440A', static: '#2ea98f', other: '#8b949e' };

        return (
          <>
            <div style={{ ...S.card, marginBottom: 20, borderColor: '#3fb950' }}>
              <span style={S.label}>Creative Shipped (Launch Log)</span>

              {/* Period stats split by format */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginTop: 10 }}>
                {periods.map(({ label, data }) => (
                  <div key={label} style={{ borderLeft: '2px solid #2a3441', paddingLeft: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#6e7681', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#f0f4f8', lineHeight: 1, marginBottom: 8 }}>{data.total}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: FMT_COLORS.video, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Video</span>
                        <span style={{ color: data.video > 0 ? '#f0f4f8' : '#6e7681', fontWeight: 700 }}>{data.video}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: FMT_COLORS.static, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Static</span>
                        <span style={{ color: data.static > 0 ? '#f0f4f8' : '#6e7681', fontWeight: 700 }}>{data.static}</span>
                      </div>
                      {data.other > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: FMT_COLORS.other, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Other</span>
                          <span style={{ color: '#f0f4f8', fontWeight: 700 }}>{data.other}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
                {/* Last 6 months — stacked */}
                <div>
                  <span style={S.label}>Last 6 Months (stacked)</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {last6.map(m => {
                      const [y, mm] = m.key.split('-');
                      const lbl = new Date(parseInt(y), parseInt(mm) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                      const barPct = (m.total / maxLaunch) * 100;
                      return (
                        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>{lbl}</span>
                          <div style={{ flex: 1, height: 16, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                              {['video', 'static', 'other'].map(t => {
                                if (!m[t]) return null;
                                const w = m.total > 0 ? (m[t] / m.total) * 100 : 0;
                                return <div key={t} title={`${t}: ${m[t]}`} style={{ width: `${w}%`, background: FMT_COLORS[t], height: '100%' }} />;
                              })}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: m.total > 0 ? '#f0f4f8' : '#6e7681', width: 28, textAlign: 'right', fontWeight: m.total > 0 ? 700 : 400 }}>{m.total || '—'}</span>
                          {m.total > 0 && (
                            <div style={{ display: 'flex', gap: 6, width: 60, justifyContent: 'flex-end' }}>
                              {m.video > 0 && <span style={{ fontSize: 8, color: FMT_COLORS.video, letterSpacing: 1 }}>{m.video}V</span>}
                              {m.static > 0 && <span style={{ fontSize: 8, color: FMT_COLORS.static, letterSpacing: 1 }}>{m.static}S</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                    {[['video', 'Video'], ['static', 'Static'], ['other', 'Other']].map(([k, l]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: FMT_COLORS[k] }} />
                        <span style={{ fontSize: 9, color: '#8b949e', letterSpacing: 1 }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top creators */}
                <div>
                  <span style={S.label}>Top Creators (This Month)</span>
                  {topCreators.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8 }}>No launches yet this month.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {topCreators.map(([c, d]) => {
                        const max = topCreators[0][1].total;
                        const barPct = (d.total / max) * 100;
                        return (
                          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, color: '#c9d1d9', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                            <div style={{ flex: 1, height: 14, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ display: 'flex', height: '100%', width: `${barPct}%` }}>
                                {['video', 'static', 'other'].map(t => {
                                  if (!d[t]) return null;
                                  const w = d.total > 0 ? (d[t] / d.total) * 100 : 0;
                                  return <div key={t} title={`${t}: ${d[t]}`} style={{ width: `${w}%`, background: FMT_COLORS[t], height: '100%' }} />;
                                })}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: '#f0f4f8', width: 24, textAlign: 'right', fontWeight: 700 }}>{d.total}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 9, color: '#6e7681', marginTop: 12, letterSpacing: 1 }}>
                Source: launch_history · {launches.length} ads logged · {allTime.video} video / {allTime.static} static{allTime.other > 0 ? ` / ${allTime.other} other` : ''}
              </div>
            </div>
          </>
        );
      })()}
      {launchesError && <div style={{ ...S.err, marginBottom: 20 }}>Launch log: {launchesError}</div>}

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
                  {Object.entries(campaignBudgets).sort((a, b) => {
                    const aDaily = a[1].isCBO ? a[1].campaignDailyBudget : a[1].totalDaily;
                    const bDaily = b[1].isCBO ? b[1].campaignDailyBudget : b[1].totalDaily;
                    return bDaily - aDaily;
                  }).slice(0, 8).map(([cid, cb]) => {
                    const dailyForCampaign = cb.isCBO ? cb.campaignDailyBudget : cb.totalDaily;
                    const pct = totalDailyBudget > 0 ? (dailyForCampaign / totalDailyBudget) * 100 : 0;
                    const campaignName = campaignNames[cid] || cid.slice(-8);
                    const strategyLabel = cb.bidStrategy === 'COST_CAP' ? 'cost cap'
                      : cb.bidStrategy === 'BID_CAP' ? 'bid cap'
                      : cb.isCBO ? 'CBO' : '';
                    return (
                      <div key={cid}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: '#c9d1d9', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {campaignName} <span style={{ color: '#6e7681' }}>({cb.adsets.length})</span>
                            {strategyLabel && <span style={{ color: '#f5a623', marginLeft: 4 }}>{strategyLabel}</span>}
                          </span>
                          <span style={{ fontSize: 9, color: '#f0f4f8', fontWeight: 600 }}>
                            {dailyForCampaign > 0 ? `$${dailyForCampaign.toFixed(0)}/day` : cb.campaignLifetimeBudget > 0 ? `$${cb.campaignLifetimeBudget.toFixed(0)} LT` : '—'}
                          </span>
                        </div>
                        <div style={{ height: 3, background: '#1c2330', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: '#DC440A', borderRadius: 2 }} />
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
              { label: 'Unique Assets Shipped',  value: totalShipped },
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

          {/* Active ads by type */}
          {activeCount > 0 && (() => {
            const FORMAT_COLORS = { video: '#DC440A', static: '#e8722a', review: '#f5a623', other: '#8b949e' };
            const maxTypeCount = Math.max(...Object.values(activeTypeCounts), 1);
            return (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <span style={S.label}>Live Ads by Format</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                  {[
                    { type: 'video', label: 'Video' },
                    { type: 'static', label: 'Static Image' },
                    { type: 'review', label: 'Review' },
                    { type: 'other', label: 'Other' },
                  ].filter(({ type }) => activeTypeCounts[type] > 0).map(({ type, label }) => {
                    const count = activeTypeCounts[type];
                    const pct = Math.round((count / activeCount) * 100);
                    const barPct = (count / maxTypeCount) * 100;
                    return (
                      <div key={type}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 600 }}>{label}</span>
                          <span style={{ fontSize: 20, fontWeight: 700, color: '#f0f4f8' }}>
                            {count} <span style={{ fontSize: 11, color: '#6e7681', fontWeight: 400 }}>({pct}%)</span>
                          </span>
                        </div>
                        <div style={{ height: 10, background: '#1c2330', borderRadius: 5, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: FORMAT_COLORS[type], borderRadius: 5, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
                  const type = parseAdType(ad);
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

      {/* ── Shopify Analytics Section ─────────────────────────────────────── */}
      <div style={S.divider} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <span style={{ ...S.label, marginBottom: 0 }}>Shopify Analytics</span>
        <button onClick={loadShopify} disabled={shopifyLoading} style={shopifyLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : S.btn}>
          {shopifyLoading ? 'Loading…' : shopifyData ? 'Refresh' : 'Load Shopify Data'}
        </button>
        {shopifyUpdated && (
          <span style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
            Updated {shopifyUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {shopifyError && <div style={{ ...S.err, marginBottom: 20 }}>{shopifyError}</div>}

      {!shopifyData && !shopifyLoading && (
        <div style={{ color: '#6e7681', fontSize: 12, padding: '40px 0' }}>
          Click "Load Shopify Data" to pull store analytics from Shopify.
        </div>
      )}

      {shopifyData && (() => {
        const months = shopifyData.months || [];
        const topProducts = shopifyData.topProducts || [];

        // Compute averages and insights
        const fullMonths = months.filter(m => m.orders > 0);
        const avgCvr = fullMonths.length > 0 ? fullMonths.reduce((s, m) => s + m.cvr, 0) / fullMonths.length : 0;
        const totalRevenue = months.reduce((s, m) => s + m.netSales, 0);
        const totalOrders = months.reduce((s, m) => s + m.orders, 0);
        const totalSessions = months.reduce((s, m) => s + m.sessions, 0);

        // Best / worst months
        const bestCvrMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.cvr > b.cvr ? a : b) : null;
        const worstCvrMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.cvr < b.cvr ? a : b) : null;
        const bestRevMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.netSales > b.netSales ? a : b) : null;

        // Current month pace
        const now = new Date();
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const currentMonthData = months.length > 0 ? months[months.length - 1] : null;
        const projectedRevenue = currentMonthData ? (currentMonthData.netSales / dayOfMonth) * daysInMonth : 0;

        // MoM trend
        const last2 = months.slice(-2);
        const momTrend = last2.length === 2 && last2[0].netSales > 0
          ? ((last2[1].netSales - last2[0].netSales) / last2[0].netSales) * 100
          : null;

        // Chart maxes
        const maxCvr = Math.max(...months.map(m => m.cvr), 0.1);
        const maxRevenue = Math.max(...months.map(m => m.netSales), 1);
        const maxProductRevenue = topProducts.length > 0 ? topProducts[0].totalRevenue : 1;

        const fmtMonth = (mStr) => {
          if (!mStr) return '—';
          const parts = mStr.split('-');
          if (parts.length >= 2) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1);
            return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          }
          return mStr;
        };

        return (
          <>
            {/* Seasonality Insights */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Best CVR Month', value: bestCvrMonth ? `${bestCvrMonth.cvr.toFixed(2)}%` : '—', sub: bestCvrMonth ? fmtMonth(bestCvrMonth.month) : '' },
                { label: 'Worst CVR Month', value: worstCvrMonth ? `${worstCvrMonth.cvr.toFixed(2)}%` : '—', sub: worstCvrMonth ? fmtMonth(worstCvrMonth.month) : '' },
                { label: 'Best Revenue Month', value: bestRevMonth ? `$${Math.round(bestRevMonth.netSales).toLocaleString()}` : '—', sub: bestRevMonth ? fmtMonth(bestRevMonth.month) : '' },
                { label: 'This Month Pace', value: `$${Math.round(projectedRevenue).toLocaleString()}`, sub: currentMonthData ? `$${Math.round(currentMonthData.netSales).toLocaleString()} so far` : '' },
                { label: 'MoM Trend', value: momTrend !== null ? `${momTrend >= 0 ? '+' : ''}${momTrend.toFixed(1)}%` : '—', sub: momTrend !== null ? (momTrend >= 0 ? 'Revenue up' : 'Revenue down') : '', color: momTrend !== null ? (momTrend >= 0 ? '#3fb950' : '#f85149') : '#f0f4f8' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={S.card}>
                  <span style={S.label}>{label}</span>
                  <div style={{ fontSize: 22, fontWeight: 700, color: color || '#f0f4f8', lineHeight: 1 }}>{value}</div>
                  {sub && <div style={{ fontSize: 9, color: '#6e7681', marginTop: 6, letterSpacing: 1 }}>{sub}</div>}
                </div>
              ))}
            </div>

            {/* Monthly Trend Table */}
            <div style={{ ...S.card, marginBottom: 20 }}>
              <span style={S.label}>Monthly Trend</span>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead>
                  <tr>
                    {['Month', 'Revenue', 'Orders', 'Sessions', 'CVR%', 'AOV'].map(h => (
                      <th key={h} style={{ fontSize: 8, letterSpacing: 2, color: '#6e7681', textAlign: h === 'Month' ? 'left' : 'right', padding: '4px 8px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map(m => {
                    const isCurrentMonth = currentMonthData && m.month === currentMonthData.month && months.indexOf(m) === months.length - 1;
                    const cvrColor = m.cvr > avgCvr ? '#3fb950' : m.cvr > 0 ? '#f85149' : '#6e7681';
                    return (
                      <tr key={m.month} style={{ borderTop: '1px solid #2a3441', background: isCurrentMonth ? 'rgba(220,68,10,0.08)' : 'transparent' }}>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: isCurrentMonth ? '#DC440A' : '#c9d1d9', fontWeight: isCurrentMonth ? 700 : 400 }}>
                          {fmtMonth(m.month)} {isCurrentMonth && <span style={{ fontSize: 8, color: '#DC440A', letterSpacing: 1 }}>(CURRENT)</span>}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#f0f4f8', textAlign: 'right', fontWeight: 600 }}>
                          ${Math.round(m.netSales).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>
                          {m.orders.toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>
                          {m.sessions.toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: cvrColor, textAlign: 'right', fontWeight: 600 }}>
                          {m.cvr > 0 ? m.cvr.toFixed(2) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>
                          {m.aov > 0 ? '$' + m.aov.toFixed(0) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, letterSpacing: 1 }}>
                Avg CVR: {avgCvr.toFixed(2)}% — Total Revenue: ${Math.round(totalRevenue).toLocaleString()} — Total Orders: {totalOrders.toLocaleString()} — Total Sessions: {totalSessions.toLocaleString()}
              </div>
            </div>

            {/* CVR Trend + Revenue by Month charts side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {/* CVR Trend Chart */}
              <div style={{ ...S.card }}>
                <span style={S.label}>CVR by Month</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {months.map(m => {
                    const barPct = maxCvr > 0 ? (m.cvr / maxCvr) * 100 : 0;
                    return (
                      <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>
                          {fmtMonth(m.month)}
                        </span>
                        <div style={{ flex: 1, height: 16, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: '#DC440A', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 10, color: m.cvr > 0 ? '#f0f4f8' : '#6e7681', width: 40, textAlign: 'right', fontWeight: m.cvr > 0 ? 700 : 400 }}>
                          {m.cvr > 0 ? m.cvr.toFixed(2) + '%' : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Revenue by Month Chart */}
              <div style={{ ...S.card }}>
                <span style={S.label}>Revenue by Month</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {months.map(m => {
                    const barPct = maxRevenue > 0 ? (m.netSales / maxRevenue) * 100 : 0;
                    return (
                      <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>
                          {fmtMonth(m.month)}
                        </span>
                        <div style={{ flex: 1, height: 16, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: '#2ea98f', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 10, color: m.netSales > 0 ? '#f0f4f8' : '#6e7681', width: 52, textAlign: 'right', fontWeight: m.netSales > 0 ? 700 : 400 }}>
                          {m.netSales > 0 ? '$' + Math.round(m.netSales).toLocaleString() : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Product Mix */}
            {topProducts.length > 0 && (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <span style={S.label}>Product Mix (Top {topProducts.length})</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                  {topProducts.map(p => {
                    const barPct = maxProductRevenue > 0 ? (p.totalRevenue / maxProductRevenue) * 100 : 0;
                    return (
                      <div key={p.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: '#f0f4f8', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            ${Math.round(p.totalRevenue).toLocaleString()} <span style={{ fontSize: 9, color: '#6e7681', fontWeight: 400 }}>({p.totalOrders} orders)</span>
                          </span>
                        </div>
                        <div style={{ height: 8, background: '#1c2330', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: '#2ea98f', borderRadius: 4, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
