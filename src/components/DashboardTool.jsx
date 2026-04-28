import React, { useState, useCallback, useEffect } from 'react';
import DealerCsvImport from './DealerCsvImport';

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

export default function DashboardTool({ view = 'cfo' }) {
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

  // CFO assumptions (loaded from /api/db/dashboard-settings).
  // Initialize with defaults so the panel renders even if the fetch is still pending or fails.
  const [settings, setSettings] = useState({
    grossMarginPct: 60, paymentFeePct: 2.9, paymentFeeFixed: 0.30,
    shippingCostPerOrder: 8, fulfillmentCostPerOrder: 3, monthlyOpex: 50000,
    googleSpend: {}, opexByMonth: {}, cfoStartMonth: '2026-03',
  });

  // Forecast (parsed from HOWL projections Google Sheet).
  const [forecast, setForecast] = useState(null);          // { sheetId, sheetName, months: [...] }
  const [forecastUpdatedAt, setForecastUpdatedAt] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState('');
  // Hydrate cached forecast on mount.
  useEffect(() => {
    fetch('/api/forecast').then(r => r.json()).then(d => {
      if (d.forecast) setForecast(d.forecast);
      if (d.updatedAt) setForecastUpdatedAt(new Date(d.updatedAt));
    }).catch(() => {});
  }, []);
  const refreshForecast = useCallback(async (overrideSettings) => {
    setForecastLoading(true); setForecastError('');
    try {
      const eff = overrideSettings || settings || {};
      const r = await fetch('/api/forecast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh',
          sheetId: eff.forecastSheetId || undefined,
          sheetName: eff.forecastSheetName || undefined,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setForecast(d.forecast);
      setForecastUpdatedAt(new Date());
    } catch (err) {
      setForecastError(err.message);
    } finally {
      setForecastLoading(false);
    }
  }, [settings]);

  // DB-snapshotted monthly metrics — preserves history past Shopify's 60-day window.
  const [historySnapshots, setHistorySnapshots] = useState([]); // [{month, shopify, meta, updated_at}]
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  useEffect(() => {
    fetch('/api/db/monthly-metrics').then(r => r.json()).then(d => {
      if (Array.isArray(d.rows)) setHistorySnapshots(d.rows);
    }).catch(() => {}).finally(() => setSnapshotsLoaded(true));
  }, []);

  // Most recent snapshot timestamp — used to decide whether to auto-refresh.
  const newestSnapshotAt = historySnapshots.reduce((max, r) => {
    const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    return t > max ? t : max;
  }, 0);
  const STALE_MS = 24 * 60 * 60 * 1000;
  const dataIsStale = !newestSnapshotAt || (Date.now() - newestSnapshotAt) > STALE_MS;
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetch('/api/db/dashboard-settings').then(r => r.json()).then(d => {
      if (d.settings) setSettings(d.settings);
    }).catch(() => {});
  }, []);

  // Snapshot fresh Shopify months to DB so they survive the 60-day window.
  useEffect(() => {
    if (!shopifyData?.months?.length) return;
    const snapshots = shopifyData.months.map(m => ({
      month: m.month,
      shopify: {
        netSales: m.netSales, orders: m.orders, shipping: m.shipping,
        newCustomers: m.newCustomers, returningCustomers: m.returningCustomers,
        newRevenue: m.newRevenue, returningRevenue: m.returningRevenue,
        cogs: m.cogs, costedRevenue: m.costedRevenue, uncostedRevenue: m.uncostedRevenue,
      },
    }));
    fetch('/api/db/monthly-metrics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot', snapshots }),
    }).then(() => fetch('/api/db/monthly-metrics'))
      .then(r => r?.json()).then(d => { if (Array.isArray(d?.rows)) setHistorySnapshots(d.rows); })
      .catch(() => {});
  }, [shopifyData]);

  // Snapshot fresh Meta months to DB.
  useEffect(() => {
    if (!data?.monthlyInsights?.length) return;
    const snapshots = data.monthlyInsights.map(m => ({
      month: m.month,
      meta: { spend: m.spend, impressions: m.impressions, clicks: m.clicks, purchases: m.purchases, cpa: m.cpa, roas: m.roas },
    }));
    fetch('/api/db/monthly-metrics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'snapshot', snapshots }),
    }).then(() => fetch('/api/db/monthly-metrics'))
      .then(r => r?.json()).then(d => { if (Array.isArray(d?.rows)) setHistorySnapshots(d.rows); })
      .catch(() => {});
  }, [data]);

  const saveSettings = useCallback(async (next) => {
    setSavingSettings(true);
    try {
      const r = await fetch('/api/db/dashboard-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      });
      const d = await r.json();
      if (d.settings) setSettings(d.settings);
    } finally { setSavingSettings(false); }
  }, []);

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

  // Auto-refresh when snapshots are missing or >24h stale. Runs once after
  // the snapshot fetch resolves so we know whether to auto-pull.
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    if (!snapshotsLoaded || autoTried) return;
    if (dataIsStale) {
      if (!data && !loading) loadDashboard();
      if (!shopifyData && !shopifyLoading) loadShopify();
    }
    setAutoTried(true);
  }, [snapshotsLoaded, autoTried, dataIsStale, data, shopifyData, loading, shopifyLoading, loadDashboard, loadShopify]);

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

  const VIEW_TITLES = {
    cfo:      { title: 'CFO View',  subtitle: 'New vs returning, NCAC, contribution margin, OpEx coverage.' },
    meta:     { title: 'Meta Ads',  subtitle: 'Live budget, formats, monthly velocity, recent launches.' },
    shopify:  { title: 'Shopify',   subtitle: 'Seasonality, monthly trend, CVR, product mix.' },
    creative: { title: 'Creative',  subtitle: 'Velocity, format mix, top creators — sourced from launch_history.' },
    forecast: { title: 'Forecast',  subtitle: 'Pacing actuals against the HOWL \'26 projections.' },
  };
  const v = VIEW_TITLES[view] || VIEW_TITLES.cfo;

  return (
    <div style={S.wrap}>
      {/* Header — shared across sub-tabs, with both load buttons */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Dashboard</div>
          <div className="display-lg" style={{ color: '#f0f4f8' }}>{v.title}</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', marginTop: 6 }}>
            {v.subtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {newestSnapshotAt > 0 && (
            <span style={{ fontSize: 9, color: dataIsStale ? '#f5a623' : '#6e7681', letterSpacing: 1 }}>
              Cache: {(() => {
                const ageMs = Date.now() - newestSnapshotAt;
                const m = Math.floor(ageMs / 60000);
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                const d = Math.floor(h / 24);
                return `${d}d ago`;
              })()}
            </span>
          )}
          <button onClick={loadDashboard} disabled={loading} style={loading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (data ? S.ghostBtn : S.btn)}>
            {loading ? 'Loading…' : data ? 'Refresh Meta' : 'Load Meta'}
          </button>
          <button onClick={loadShopify} disabled={shopifyLoading} style={shopifyLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (shopifyData ? S.ghostBtn : S.btn)}>
            {shopifyLoading ? 'Loading…' : shopifyData ? 'Refresh Shopify' : 'Load Shopify'}
          </button>
          {view === 'forecast' && (
            <button onClick={refreshForecast} disabled={forecastLoading} style={forecastLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (forecast ? S.ghostBtn : S.btn)}>
              {forecastLoading ? 'Pulling…' : forecast ? 'Refresh Forecast' : 'Pull Forecast'}
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ ...S.err, marginBottom: 20 }}>{error}</div>}

      {/* Launch Log stats — DB-backed, on Creative sub-tab */}
      {view === 'creative' && launches && launches.length > 0 && (() => {
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
      {view === 'creative' && launchesError && <div style={{ ...S.err, marginBottom: 20 }}>Launch log: {launchesError}</div>}
      {view === 'creative' && (!launches || launches.length === 0) && !launchesError && (
        <div style={{ ...S.card, color: '#8b949e', fontSize: 12 }}>No launches logged yet. Push an ad via UGC Inbox or Publish to populate this view.</div>
      )}

      {shopifyData?._meta?.customerScopeMissing && (
        <div style={{ ...S.err, marginBottom: 20, color: '#f5a623', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Shopify token is missing the <code>read_customers</code> scope — new vs returning columns will be zero. Re-install at{' '}
          <a href="/api/shopify-install?shop=howl-campfires.myshopify.com" style={{ color: '#f5a623', textDecoration: 'underline' }}>
            /api/shopify-install
          </a>{' '}to fix.
        </div>
      )}
      {data?.monthlyInsightsError && (
        <div style={{ ...S.err, marginBottom: 20, color: '#f5a623', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Meta monthly spend pull failed: {data.monthlyInsightsError}. CFO View ad-spend column will be blank until this is fixed.
        </div>
      )}
      {shopifyData?._meta?.inventoryScopeMissing && (
        <div style={{ ...S.err, marginBottom: 20, color: '#f5a623', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Shopify token is missing the <code>read_inventory</code> scope — COGS is using your Gross Margin assumption instead of per-unit cost. Re-install at{' '}
          <a href="/api/shopify-install?shop=howl-campfires.myshopify.com" style={{ color: '#f5a623', textDecoration: 'underline' }}>
            /api/shopify-install
          </a>{' '}to pull real costs.
        </div>
      )}

      {/* ── CFO / Head of Growth Section ──────────────────────────────────── */}
      {view === 'cfo' && (() => {
        const monthlyInsights = data?.monthlyInsights || [];
        const shopifyMonths = shopifyData?.months || [];
        // Render whenever we have ANY data: live OR snapshots OR settings can fall back to defaults.
        const hasAnyData = monthlyInsights.length > 0 || shopifyMonths.length > 0 || (historySnapshots && historySnapshots.length > 0);
        if (!hasAnyData) {
          return (
            <div style={{ ...S.card, color: '#8b949e', fontSize: 12 }}>
              {(loading || shopifyLoading) ? 'Loading…' : 'No data yet. Click Load Meta or Load Shopify above to populate the CFO View.'}
            </div>
          );
        }

        // Live data (current pull)
        const liveSpendByMonth = Object.fromEntries(monthlyInsights.map(m => [m.month, m]));
        const liveShopByMonth = Object.fromEntries(shopifyMonths.map(m => [m.month, m]));

        // Snapshotted history from DB (overlay BEHIND live data — live always wins for current months)
        const snapshotShopByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify).map(r => [r.month, r.shopify]));
        const snapshotMetaByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, r.meta]));
        const dealerByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify_dealer).map(r => [r.month, r.shopify_dealer]));

        // Sum primary (snapshot or live) + dealer (CSV) per month.
        const sumShopify = (a, b) => {
          if (!a && !b) return null;
          a = a || {}; b = b || {};
          const keys = ['netSales','orders','shipping','newCustomers','returningCustomers','newRevenue','returningRevenue','cogs','costedRevenue','uncostedRevenue'];
          const out = {};
          for (const k of keys) out[k] = (a[k] || 0) + (b[k] || 0);
          return out;
        };
        const allShopMonths = new Set([
          ...Object.keys(snapshotShopByMonth), ...Object.keys(liveShopByMonth), ...Object.keys(dealerByMonth),
        ]);
        const shopByMonth = {};
        for (const mk of allShopMonths) {
          const primary = liveShopByMonth[mk] || snapshotShopByMonth[mk] || null;
          const dealer = dealerByMonth[mk] || null;
          shopByMonth[mk] = sumShopify(primary, dealer);
        }
        const spendByMonth = { ...snapshotMetaByMonth, ...liveSpendByMonth };

        // Settings-derived maps (declared before allMonthKeys to avoid TDZ).
        const s = settings || { grossMarginPct: 60, paymentFeePct: 2.9, paymentFeeFixed: 0.30, shippingCostPerOrder: 8, fulfillmentCostPerOrder: 3, monthlyOpex: 50000, googleSpend: {}, opexByMonth: {}, revenueAddByMonth: {}, ordersAddByMonth: {} };
        const googleByMonth = s.googleSpend || {};
        const opexByMonth = s.opexByMonth || {};
        const revenueAddByMonth = s.revenueAddByMonth || {};
        const ordersAddByMonth = s.ordersAddByMonth || {};
        const newCustomersAddByMonth = s.newCustomersAddByMonth || {};
        const returningCustomersAddByMonth = s.returningCustomersAddByMonth || {};

        // Union of all months (live + snapshotted + manual overrides), filtered to start month
        const startMonth = settings?.cfoStartMonth || '2026-03';
        const allMonthKeys = Array.from(new Set([
          ...Object.keys(shopByMonth),
          ...Object.keys(spendByMonth),
          ...Object.keys(revenueAddByMonth),
          ...Object.keys(ordersAddByMonth),
          ...Object.keys(googleByMonth),
          ...Object.keys(opexByMonth),
        ])).filter(Boolean).filter(m => m >= startMonth).sort();
        // Hard cap to keep tables readable; will grow as we accumulate snapshots forward
        const recent13 = allMonthKeys.slice(-24);
        const defaultOpex = s.monthlyOpex || 0;
        const opexFor = (mk) => {
          const v = opexByMonth[mk];
          return (v == null || v === '') ? defaultOpex : Number(v);
        };

        // Per-order variable margin used for first-order payback math.
        // Avg revenue per order × gross margin − fees − ship − pick.
        const variableMarginPerOrder = (rev, orders) => {
          if (!orders) return 0;
          const aov = rev / orders;
          return aov * (s.grossMarginPct / 100) - aov * (s.paymentFeePct / 100) - s.paymentFeeFixed - s.shippingCostPerOrder - s.fulfillmentCostPerOrder;
        };

        const nowD = new Date();
        const currentMonthKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
        const dayOfMonth = nowD.getDate();
        const daysInCurrentMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
        const paceFactor = daysInCurrentMonth / dayOfMonth;

        const rows = recent13.map(mk => {
          const sh = shopByMonth[mk] || { netSales: 0, orders: 0, newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, cogs: 0, costedRevenue: 0, uncostedRevenue: 0 };
          const meta = spendByMonth[mk] || { spend: 0, purchases: 0 };
          const addRev = Number(revenueAddByMonth[mk] || 0);
          const addOrders = Number(ordersAddByMonth[mk] || 0);
          const addNewCust = Number(newCustomersAddByMonth[mk] || 0);
          const addReturningCust = Number(returningCustomersAddByMonth[mk] || 0);
          const revenue = (sh.netSales || 0) + addRev;
          const orders = (sh.orders || 0) + addOrders;
          // Hybrid COGS: actual unitCost × qty for line items where Shopify has cost set,
          // GM% assumption applied to (uncosted Shopify revenue + manual additions).
          const realCogs = sh.cogs || 0;
          const fallbackCogs = ((sh.uncostedRevenue || 0) + addRev) * (1 - (s.grossMarginPct / 100));
          const cogs = realCogs + fallbackCogs;
          const cogsActualPct = revenue > 0 ? (sh.costedRevenue || 0) / revenue : 0; // 1.0 = 100% real, 0 = all fallback
          const paymentFees = revenue * (s.paymentFeePct / 100) + orders * s.paymentFeeFixed;
          const shipCost = orders * s.shippingCostPerOrder;
          const fulfill = orders * s.fulfillmentCostPerOrder;
          const metaSpend = meta.spend || 0;
          const googleSpend = Number(googleByMonth[mk] || 0);
          const adSpend = metaSpend + googleSpend;
          const cm3 = revenue - cogs - paymentFees - shipCost - fulfill - adSpend;
          // NCAC stays Meta-only (Google not driving new customers per current understanding)
          const totalNewCust = (sh.newCustomers || 0) + addNewCust;
          const ncac = totalNewCust > 0 ? metaSpend / totalNewCust : null;
          const blendedNcac = totalNewCust > 0 ? adSpend / totalNewCust : null;
          const blendedRoas = adSpend > 0 ? revenue / adSpend : null;
          const newRoas = adSpend > 0 ? (sh.newRevenue || 0) / adSpend : null;
          // First-order payback: variable margin generated by new-customer first orders ÷ NCAC.
          // <100% = new customer doesn't pay back on first order (need repeats).
          const newOrderMargin = (sh.newRevenue || 0) * (s.grossMarginPct / 100)
                                - (sh.newRevenue || 0) * (s.paymentFeePct / 100)
                                - (sh.newCustomers || 0) * (s.paymentFeeFixed + s.shippingCostPerOrder + s.fulfillmentCostPerOrder);
          const firstOrderPayback = metaSpend > 0 ? newOrderMargin / metaSpend : null;
          const opexThis = opexFor(mk);
          const opexCoverage = opexThis > 0 ? cm3 / opexThis : null;
          const isCurrent = mk === currentMonthKey;
          const newCustomers = (sh.newCustomers || 0) + addNewCust;
          const returningCustomers = (sh.returningCustomers || 0) + addReturningCust;
          return { month: mk, revenue, orders, newCustomers, returningCustomers, newRevenue: sh.newRevenue || 0, returningRevenue: sh.returningRevenue || 0, metaSpend, googleSpend, adSpend, cogs, cogsActualPct, paymentFees, shipCost, fulfill, cm3, ncac, blendedNcac, blendedRoas, newRoas, firstOrderPayback, opex: opexThis, opexCoverage, isCurrent };
        });

        // Current-month pace projection (last row if it's the current month)
        const currentRow = rows.find(r => r.isCurrent);
        const pace = currentRow ? {
          revenue: currentRow.revenue * paceFactor,
          adSpend: currentRow.adSpend * paceFactor,
          newCustomers: Math.round(currentRow.newCustomers * paceFactor),
          returningCustomers: Math.round(currentRow.returningCustomers * paceFactor),
          cm3: currentRow.cm3 * paceFactor,
          opex: currentRow.opex,
          opexCoverage: currentRow.opex > 0 ? (currentRow.cm3 * paceFactor) / currentRow.opex : null,
          ncac: currentRow.newCustomers > 0 ? currentRow.metaSpend / currentRow.newCustomers : null, // run-rate NCAC, Meta only
        } : null;

        const ltm = rows.reduce((a, r) => ({
          revenue: a.revenue + r.revenue,
          orders: a.orders + r.orders,
          newCustomers: a.newCustomers + r.newCustomers,
          returningCustomers: a.returningCustomers + r.returningCustomers,
          metaSpend: a.metaSpend + r.metaSpend,
          googleSpend: a.googleSpend + r.googleSpend,
          adSpend: a.adSpend + r.adSpend,
          cm3: a.cm3 + r.cm3,
          newRevenue: a.newRevenue + r.newRevenue,
          opex: a.opex + r.opex,
        }), { revenue: 0, orders: 0, newCustomers: 0, returningCustomers: 0, metaSpend: 0, googleSpend: 0, adSpend: 0, cm3: 0, newRevenue: 0, opex: 0 });

        const ltmNcac = ltm.newCustomers > 0 ? ltm.metaSpend / ltm.newCustomers : null;
        const ltmBlendedNcac = ltm.newCustomers > 0 ? ltm.adSpend / ltm.newCustomers : null;
        const ltmRoas = ltm.adSpend > 0 ? ltm.revenue / ltm.adSpend : null;
        const ltmRepeatRate = (ltm.newCustomers + ltm.returningCustomers) > 0
          ? ltm.returningCustomers / (ltm.newCustomers + ltm.returningCustomers) : 0;
        const ltmCmMargin = ltm.revenue > 0 ? ltm.cm3 / ltm.revenue : 0;
        const ltmOpexCoverage = ltm.opex > 0 ? ltm.cm3 / ltm.opex : null;
        // For UI: show the default opex if no per-month overrides, else "$X avg"
        const opex = ltm.opex / Math.max(rows.length, 1);

        const fmtPct = (n) => (n == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%';
        const fmt$ = (n) => (n == null || isNaN(n)) ? '—' : '$' + Math.round(n).toLocaleString();

        const maxCustomers = Math.max(...rows.map(r => r.newCustomers + r.returningCustomers), 1);
        const ncacRange = rows.filter(r => r.ncac != null).map(r => r.ncac);
        const maxNcac = Math.max(...ncacRange, 1);
        const cmRange = rows.map(r => r.cm3);
        const cmMax = Math.max(...cmRange, 1);
        const cmMin = Math.min(...cmRange, 0);
        const cmAbsMax = Math.max(Math.abs(cmMax), Math.abs(cmMin), 1);

        const fmtMo = (mk) => {
          if (!mk) return '—';
          const [y, m] = mk.split('-');
          return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        };

        const dataReady = (data || shopifyData || (historySnapshots && historySnapshots.length > 0));

        return (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, marginTop: 28 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>CFO View</div>
                <div className="display-md" style={{ color: '#f0f4f8' }}>Growth & Contribution</div>
                <div className="display-italic" style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>
                  New vs returning, NCAC, and CM3 (revenue net of COGS, fees, shipping, fulfillment, ad spend).
                </div>
              </div>
              <button onClick={() => setShowAssumptions(v => !v)} style={S.ghostBtn}>
                {showAssumptions ? 'Hide' : 'Edit'} Assumptions
              </button>
            </div>

            {showAssumptions && settings && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <span style={S.label}>Assumptions (used for COGS, fees, CM3)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 10 }}>
                  {[
                    { k: 'grossMarginPct',         label: 'Gross Margin %',     suffix: '%'  },
                    { k: 'paymentFeePct',          label: 'Payment Fee %',      suffix: '%'  },
                    { k: 'paymentFeeFixed',        label: 'Payment $ / order',  suffix: '$'  },
                    { k: 'shippingCostPerOrder',   label: 'Shipping $ / order', suffix: '$'  },
                    { k: 'fulfillmentCostPerOrder',label: 'Pick/Pack $ / order',suffix: '$'  },
                    { k: 'monthlyOpex',            label: 'Monthly OpEx',       suffix: '$'  },
                  ].map(({ k, label, suffix }) => (
                    <div key={k}>
                      <span style={{ ...S.label, marginBottom: 4 }}>{label}</span>
                      <input
                        type="number" step="0.01"
                        value={settings[k]}
                        onChange={e => setSettings({ ...settings, [k]: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '6px 8px', background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, borderRadius: 4 }}
                      />
                      <span style={{ fontSize: 9, color: '#6e7681' }}>{suffix}</span>
                    </div>
                  ))}
                  <div>
                    <span style={{ ...S.label, marginBottom: 4 }}>CFO View Start</span>
                    <input
                      type="month"
                      value={settings.cfoStartMonth || '2026-03'}
                      onChange={e => setSettings({ ...settings, cfoStartMonth: e.target.value || '2026-03' })}
                      style={{ width: '100%', padding: '6px 8px', background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, borderRadius: 4 }}
                    />
                    <span style={{ fontSize: 9, color: '#6e7681' }}>YYYY-MM</span>
                  </div>
                </div>
                {/* Monthly OpEx, Google spend, additional revenue (dealer + historical) */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #2a3441' }}>
                  <span style={S.label}>Monthly Overrides — OpEx, Google, Add'l Revenue</span>
                  <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 10, letterSpacing: 1 }}>
                    Leave blank to use defaults. <strong>Add'l Revenue</strong> is added on top of Shopify primary — use it for dealer-store sales and pre-window months (Jan/Feb '26). Add'l Orders drives correct fees/ship/pick math.
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: 480 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 90px 100px 70px 70px 70px', gap: 5, alignItems: 'center', minWidth: 580 }}>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>Month</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>OpEx</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>Google</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>Add'l Rev</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>Add'l Ord</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>+ New</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600 }}>+ Ret</div>
                      {recent13.map(mk => {
                        const inp = (key, ph) => (
                          <input
                            type="number" step="1" placeholder={ph}
                            value={settings[key]?.[mk] ?? ''}
                            onChange={e => setSettings({ ...settings, [key]: { ...(settings[key] || {}), [mk]: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 } })}
                            style={{ width: '100%', padding: '4px 6px', background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, borderRadius: 3 }}
                          />
                        );
                        return (
                          <React.Fragment key={mk}>
                            <span style={{ fontSize: 11, color: '#c9d1d9' }}>{fmtMo(mk)}</span>
                            {inp('opexByMonth', String(defaultOpex))}
                            {inp('googleSpend', '0')}
                            {inp('revenueAddByMonth', '0')}
                            {inp('ordersAddByMonth', '0')}
                            {inp('newCustomersAddByMonth', '0')}
                            {inp('returningCustomersAddByMonth', '0')}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => saveSettings(settings)} disabled={savingSettings} style={S.btn}>
                    {savingSettings ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {!dataReady && (
              <div style={{ ...S.card, marginBottom: 20, color: '#8b949e', fontSize: 12 }}>
                Load Meta + Shopify data above to populate this view.
              </div>
            )}

            {dataReady && (
              <>
                {/* LTM KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: 'LTM Revenue',     value: fmt$(ltm.revenue) },
                    { label: 'LTM Ad Spend',    value: fmt$(ltm.adSpend) },
                    { label: 'LTM CM3',         value: fmt$(ltm.cm3), color: ltm.cm3 >= 0 ? '#3fb950' : '#f85149', sub: fmtPct(ltmCmMargin) + ' margin' },
                    { label: 'LTM OpEx Cov.',   value: ltmOpexCoverage == null ? '—' : fmtPct(ltmOpexCoverage), color: ltmOpexCoverage >= 1 ? '#3fb950' : '#f5a623', sub: fmt$(opex) + ' / mo opex' },
                    { label: 'LTM New Custs',   value: ltm.newCustomers.toLocaleString(), sub: ltm.returningCustomers.toLocaleString() + ' returning' },
                    { label: 'Avg NCAC',        value: ltmNcac == null ? '—' : '$' + ltmNcac.toFixed(0) },
                    { label: 'Repeat Rate',     value: fmtPct(ltmRepeatRate), sub: 'Blended ROAS ' + (ltmRoas == null ? '—' : ltmRoas.toFixed(2)) },
                  ].map(({ label, value, sub, color }) => (
                    <div key={label} style={S.card}>
                      <span style={S.label}>{label}</span>
                      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#f0f4f8', lineHeight: 1 }}>{value}</div>
                      {sub && <div style={{ fontSize: 9, color: '#6e7681', marginTop: 6, letterSpacing: 1 }}>{sub}</div>}
                    </div>
                  ))}
                </div>

                {/* Current-month pace */}
                {pace && (
                  <div style={{ ...S.card, marginBottom: 20, borderColor: '#DC440A' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                      <span style={S.label}>{fmtMo(currentMonthKey)} Pace — Day {dayOfMonth} of {daysInCurrentMonth}</span>
                      <span style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>(MTD × {paceFactor.toFixed(2)})</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
                      {[
                        { label: 'Projected Revenue', value: fmt$(pace.revenue), sub: fmt$(currentRow.revenue) + ' MTD' },
                        { label: 'Projected Ad Spend', value: fmt$(pace.adSpend), sub: fmt$(currentRow.adSpend) + ' MTD' },
                        { label: 'Projected CM3', value: fmt$(pace.cm3), color: pace.cm3 >= 0 ? '#3fb950' : '#f85149', sub: fmt$(currentRow.cm3) + ' MTD' },
                        { label: 'OpEx Coverage', value: pace.opexCoverage == null ? '—' : fmtPct(pace.opexCoverage), color: (pace.opexCoverage || 0) >= 1 ? '#3fb950' : (pace.opexCoverage || 0) >= 0.5 ? '#f5a623' : '#f85149', sub: 'vs ' + fmt$(pace.opex) },
                        { label: 'Projected New', value: pace.newCustomers.toLocaleString(), sub: currentRow.newCustomers + ' MTD' },
                        { label: 'NCAC (run rate)', value: pace.ncac == null ? '—' : '$' + pace.ncac.toFixed(0), sub: currentRow.newCustomers ? '' : 'no new yet' },
                      ].map(({ label, value, sub, color }) => (
                        <div key={label}>
                          <span style={S.label}>{label}</span>
                          <div style={{ fontSize: 18, fontWeight: 700, color: color || '#f0f4f8', lineHeight: 1 }}>{value}</div>
                          {sub && <div style={{ fontSize: 9, color: '#6e7681', marginTop: 4, letterSpacing: 1 }}>{sub}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* New vs Returning customers */}
                <div style={{ ...S.card, marginBottom: 20 }}>
                  <span style={S.label}>New vs Returning Customers — Monthly</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                    {rows.map(r => {
                      const tot = r.newCustomers + r.returningCustomers;
                      const barPct = (tot / maxCustomers) * 100;
                      const newPct = tot > 0 ? (r.newCustomers / tot) * 100 : 0;
                      return (
                        <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                          <div style={{ flex: 1, height: 16, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                              <div title={`New: ${r.newCustomers}`} style={{ width: `${newPct}%`, background: '#DC440A', height: '100%' }} />
                              <div title={`Returning: ${r.returningCustomers}`} style={{ width: `${100 - newPct}%`, background: '#2ea98f', height: '100%' }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: '#f0f4f8', width: 32, textAlign: 'right', fontWeight: 700 }}>{tot || '—'}</span>
                          <div style={{ display: 'flex', gap: 6, width: 96, justifyContent: 'flex-end', fontSize: 9 }}>
                            {r.newCustomers > 0 && <span style={{ color: '#DC440A', letterSpacing: 1 }}>{r.newCustomers}N</span>}
                            {r.returningCustomers > 0 && <span style={{ color: '#2ea98f', letterSpacing: 1 }}>{r.returningCustomers}R</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#DC440A' }} /><span style={{ fontSize: 9, color: '#8b949e', letterSpacing: 1 }}>New</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#2ea98f' }} /><span style={{ fontSize: 9, color: '#8b949e', letterSpacing: 1 }}>Returning</span></div>
                  </div>
                </div>

                {/* OpEx Coverage by month (full width) */}
                <div style={{ ...S.card, marginBottom: 20 }}>
                  <span style={S.label}>OpEx Coverage by Month — CM3 ÷ Monthly OpEx ({fmt$(opex)})</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                    {rows.map(r => {
                      const cov = r.opexCoverage;
                      const pct = cov == null ? 0 : Math.max(-1.5, Math.min(2, cov)); // clamp -150%..200%
                      const isFull = (cov || 0) >= 1;
                      const positive = (cov || 0) >= 0;
                      const barW = Math.min(Math.abs(pct), 1.5) * 50; // 50% of bar = 1x coverage
                      return (
                        <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}{r.isCurrent ? '*' : ''}</span>
                          <div style={{ flex: 1, height: 14, background: '#1c2330', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                            {/* 100% line */}
                            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#3fb950', opacity: 0.5 }} />
                            <div style={{
                              position: 'absolute', top: 0, bottom: 0,
                              ...(positive ? { left: '50%', width: `${barW}%` } : { right: '50%', width: `${barW}%` }),
                              background: isFull ? '#3fb950' : positive ? '#f5a623' : '#f85149',
                            }} />
                          </div>
                          <span style={{ fontSize: 11, color: cov == null ? '#6e7681' : isFull ? '#3fb950' : positive ? '#f5a623' : '#f85149', width: 60, textAlign: 'right', fontWeight: 700 }}>
                            {cov == null ? '—' : (cov * 100).toFixed(0) + '%'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, letterSpacing: 1 }}>
                    Green line = 100% (CM3 fully covers OpEx). * = current month (MTD, not annualized).
                  </div>
                </div>

                {/* NCAC + CM3 side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <div style={S.card}>
                    <span style={S.label}>NCAC by Month (Meta spend ÷ new customers)</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {rows.map(r => {
                        const barPct = r.ncac != null ? (r.ncac / maxNcac) * 100 : 0;
                        return (
                          <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                            <div style={{ flex: 1, height: 14, background: '#1c2330', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${barPct}%`, background: '#f5a623', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 10, color: r.ncac != null ? '#f0f4f8' : '#6e7681', width: 56, textAlign: 'right', fontWeight: r.ncac != null ? 700 : 400 }}>
                              {r.ncac != null ? '$' + r.ncac.toFixed(0) : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={S.card}>
                    <span style={S.label}>CM3 by Month (covers OpEx)</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {rows.map(r => {
                        const pos = r.cm3 >= 0;
                        const barPct = (Math.abs(r.cm3) / cmAbsMax) * 50; // 50% half-width either side of midline
                        return (
                          <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, color: '#8b949e', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                            <div style={{ flex: 1, height: 14, background: '#1c2330', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#2a3441' }} />
                              <div style={{
                                position: 'absolute', top: 0, bottom: 0,
                                ...(pos ? { left: '50%', width: `${barPct}%` } : { right: '50%', width: `${barPct}%` }),
                                background: pos ? '#3fb950' : '#f85149',
                              }} />
                            </div>
                            <span style={{ fontSize: 10, color: pos ? '#3fb950' : '#f85149', width: 72, textAlign: 'right', fontWeight: 700 }}>
                              {fmt$(r.cm3)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Detailed monthly P&L table */}
                <div style={{ ...S.card, marginBottom: 20 }}>
                  <span style={S.label}>Monthly P&L (CM3 build)</span>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, minWidth: 900 }}>
                      <thead>
                        <tr>
                          {['Month', 'Revenue', 'Orders', 'New', 'Ret', 'Meta', 'Google', 'NCAC', '1st Pay', 'COGS', 'Fees', 'Ship', 'Pick', 'CM3', 'CM%', 'OpEx', 'OpEx Cov', 'ROAS'].map(h => (
                            <th key={h} style={{ fontSize: 8, letterSpacing: 1, color: '#6e7681', textAlign: h === 'Month' ? 'left' : 'right', padding: '4px 6px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          const margin = r.revenue > 0 ? r.cm3 / r.revenue : 0;
                          return (
                            <tr key={r.month} style={{ borderTop: '1px solid #2a3441' }}>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#c9d1d9' }}>{fmtMo(r.month)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#f0f4f8', textAlign: 'right', fontWeight: 600 }}>{fmt$(r.revenue)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>{r.orders || '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#DC440A', textAlign: 'right', fontWeight: 600 }}>{r.newCustomers || '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#2ea98f', textAlign: 'right', fontWeight: 600 }}>{r.returningCustomers || '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>{fmt$(r.metaSpend)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.googleSpend > 0 ? '#c9d1d9' : '#6e7681', textAlign: 'right' }}>{r.googleSpend > 0 ? fmt$(r.googleSpend) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#f5a623', textAlign: 'right', fontWeight: 600 }}>{r.ncac != null ? '$' + r.ncac.toFixed(0) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.firstOrderPayback == null ? '#6e7681' : r.firstOrderPayback >= 1 ? '#3fb950' : '#f85149', textAlign: 'right', fontWeight: 600 }}>{r.firstOrderPayback == null ? '—' : (r.firstOrderPayback * 100).toFixed(0) + '%'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#8b949e', textAlign: 'right' }}>{fmt$(r.cogs)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#8b949e', textAlign: 'right' }}>{fmt$(r.paymentFees)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#8b949e', textAlign: 'right' }}>{fmt$(r.shipCost)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#8b949e', textAlign: 'right' }}>{fmt$(r.fulfill)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.cm3 >= 0 ? '#3fb950' : '#f85149', textAlign: 'right', fontWeight: 700 }}>{fmt$(r.cm3)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: margin >= 0 ? '#3fb950' : '#f85149', textAlign: 'right' }}>{r.revenue > 0 ? fmtPct(margin) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: opexByMonth[r.month] != null ? '#c9d1d9' : '#6e7681', textAlign: 'right' }}>{fmt$(r.opex)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.opexCoverage == null ? '#6e7681' : r.opexCoverage >= 1 ? '#3fb950' : r.opexCoverage >= 0 ? '#f5a623' : '#f85149', textAlign: 'right', fontWeight: 600 }}>{r.opexCoverage == null ? '—' : (r.opexCoverage * 100).toFixed(0) + '%'}</td>
                              <td style={{ padding: '6px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>{r.blendedRoas != null ? r.blendedRoas.toFixed(2) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #2a3441' }}>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 9, letterSpacing: 1, color: '#6e7681', textTransform: 'uppercase', fontWeight: 700 }}>LTM</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#f0f4f8', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.revenue)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>{ltm.orders.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#DC440A', textAlign: 'right', fontWeight: 700 }}>{ltm.newCustomers.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#2ea98f', textAlign: 'right', fontWeight: 700 }}>{ltm.returningCustomers.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.metaSpend)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltm.googleSpend > 0 ? '#c9d1d9' : '#6e7681', textAlign: 'right', fontWeight: 700 }}>{ltm.googleSpend > 0 ? fmt$(ltm.googleSpend) : '—'}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#f5a623', textAlign: 'right', fontWeight: 700 }}>{ltmNcac == null ? '—' : '$' + ltmNcac.toFixed(0)}</td>
                          <td colSpan={5} />
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltm.cm3 >= 0 ? '#3fb950' : '#f85149', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.cm3)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltmCmMargin >= 0 ? '#3fb950' : '#f85149', textAlign: 'right', fontWeight: 700 }}>{fmtPct(ltmCmMargin)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.opex)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltmOpexCoverage == null ? '#6e7681' : ltmOpexCoverage >= 1 ? '#3fb950' : '#f5a623', textAlign: 'right', fontWeight: 700 }}>{ltmOpexCoverage == null ? '—' : (ltmOpexCoverage * 100).toFixed(0) + '%'}</td>
                          <td style={{ padding: '8px 0 4px', fontSize: 11, color: '#c9d1d9', textAlign: 'right', fontWeight: 700 }}>{ltmRoas == null ? '—' : ltmRoas.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, letterSpacing: 1 }}>
                    CM3 = Revenue − COGS − Payment Fees − Shipping − Pick/Pack − (Meta + Google) Spend. COGS uses Shopify per-unit cost when set, GM% assumption otherwise. NCAC = Meta spend ÷ new lifetime customers. OpEx column = monthly P&L override or default. Bold OpEx = override set; dim = default.
                  </div>
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* ── Forecast / Pacing Section ─────────────────────────────────────── */}
      {view === 'forecast' && (() => {
        const sheetIdField = (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <span style={S.label}>Forecast Sheet ID</span>
            <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 8, letterSpacing: 1 }}>
              From the URL: docs.google.com/spreadsheets/d/<strong style={{ color: '#f5a623' }}>SHEET_ID</strong>/edit
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={settings?.forecastSheetId || ''}
                onChange={e => setSettings({ ...settings, forecastSheetId: e.target.value.trim() })}
                placeholder="1uzteHW4sWB6Q49Rt7pOFzmIMD_s0Dxec0lQwgTfFHRI"
                style={{ flex: 1, padding: '8px 10px', background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, borderRadius: 4 }}
              />
              <input
                type="text"
                value={settings?.forecastSheetName || 'P&L Monthly'}
                onChange={e => setSettings({ ...settings, forecastSheetName: e.target.value })}
                placeholder="P&L Monthly"
                style={{ width: 160, padding: '8px 10px', background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, borderRadius: 4 }}
              />
              <button onClick={() => saveSettings(settings)} disabled={savingSettings} style={S.btn}>
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, letterSpacing: 1 }}>
              Make sure the sheet is shared (Viewer) with <code style={{ color: '#f5a623' }}>howl-drive-uploader@howl-creative-studio.iam.gserviceaccount.com</code>. After saving, click Refresh Forecast.
            </div>
          </div>
        );

        if (forecastError) {
          return <>{sheetIdField}<div style={{ ...S.err, marginBottom: 20 }}>Forecast: {forecastError}</div></>;
        }
        if (!forecast) {
          return (
            <>
              {sheetIdField}
              <div style={{ ...S.card, color: '#8b949e', fontSize: 12 }}>
                <div style={{ fontSize: 13, color: '#f0f4f8', marginBottom: 10 }}>No forecast loaded yet.</div>
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Paste the Sheet ID above and Save.</li>
                  <li>Make sure the sheet is shared (Viewer) with the service account.</li>
                  <li>Click <strong>Pull Forecast</strong> in the header.</li>
                </ol>
                {forecastUpdatedAt && (
                  <div style={{ marginTop: 14, fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
                    Last cached: {forecastUpdatedAt.toLocaleString()}
                  </div>
                )}
              </div>
            </>
          );
        }

        // Build pacing rows: filter forecast months to start month forward, intersect with snapshots+live actuals.
        const startMonth = settings?.cfoStartMonth || '2026-03';
        const liveSpendByMonth = Object.fromEntries((data?.monthlyInsights || []).map(m => [m.month, m]));
        const liveShopByMonth = Object.fromEntries((shopifyData?.months || []).map(m => [m.month, m]));
        const snapShopByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify).map(r => [r.month, r.shopify]));
        const snapMetaByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, r.meta]));
        const dealerByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify_dealer).map(r => [r.month, r.shopify_dealer]));
        const sumShop = (a, b) => {
          if (!a && !b) return null;
          a = a || {}; b = b || {};
          const out = {};
          for (const k of ['netSales','orders','shipping','newCustomers','returningCustomers','newRevenue','returningRevenue','cogs','costedRevenue','uncostedRevenue']) out[k] = (a[k] || 0) + (b[k] || 0);
          return out;
        };
        const allShopMonths = new Set([...Object.keys(snapShopByMonth), ...Object.keys(liveShopByMonth), ...Object.keys(dealerByMonth)]);
        const shopByMonth = {};
        for (const mk of allShopMonths) {
          shopByMonth[mk] = sumShop(liveShopByMonth[mk] || snapShopByMonth[mk] || null, dealerByMonth[mk] || null);
        }
        const metaByMonth = { ...snapMetaByMonth, ...liveSpendByMonth };
        const googleByMonth = settings?.googleSpend || {};
        const opexByMonth = settings?.opexByMonth || {};
        const revenueAddByMonth = settings?.revenueAddByMonth || {};
        const ordersAddByMonth = settings?.ordersAddByMonth || {};
        const defaultOpex = settings?.monthlyOpex || 0;
        const s = settings;

        // Filter forecast to start month forward; current calendar year only.
        const nowD = new Date();
        const thisYear = String(nowD.getFullYear());
        const currentMonthKey = `${thisYear}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
        const dayOfMonth = nowD.getDate();
        const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();

        const forecastMonths = (forecast.months || []).filter(m => m.month >= startMonth && m.month.startsWith(thisYear));

        const rows = forecastMonths.map(f => {
          const sh = shopByMonth[f.month] || {};
          const meta = metaByMonth[f.month] || {};
          const isCurrent = f.month === currentMonthKey;
          const isPast = f.month < currentMonthKey;

          // Actuals — include manual revenue/orders adds (dealer + pre-window historical)
          const addRev = Number(revenueAddByMonth[f.month] || 0);
          const addOrders = Number(ordersAddByMonth[f.month] || 0);
          const actRevenue = (sh.netSales || 0) + addRev;
          const orders = (sh.orders || 0) + addOrders;
          const realCogs = sh.cogs || 0;
          const fallbackCogs = ((sh.uncostedRevenue || 0) + addRev) * (1 - ((s?.grossMarginPct || 60) / 100));
          const actCogs = realCogs + fallbackCogs;
          const actMetaSpend = meta.spend || 0;
          const actGoogleSpend = Number(googleByMonth[f.month] || 0);
          const actCac = actMetaSpend + actGoogleSpend;
          const actOpex = opexByMonth[f.month] != null && opexByMonth[f.month] !== ''
            ? Number(opexByMonth[f.month]) : defaultOpex;
          const actFees = actRevenue * ((s?.paymentFeePct || 2.9) / 100) + orders * (s?.paymentFeeFixed || 0.30);
          const actShip = orders * (s?.shippingCostPerOrder || 8);
          const actPick = orders * (s?.fulfillmentCostPerOrder || 3);
          const actCm3 = actRevenue - actCogs - actFees - actShip - actPick - actCac;

          // Project current-month actual to full month.
          const paceFactor = isCurrent ? daysInMonth / Math.max(dayOfMonth, 1) : 1;
          const projRevenue = isCurrent ? actRevenue * paceFactor : actRevenue;
          const projCac = isCurrent ? actCac * paceFactor : actCac;
          const projCm3 = isCurrent ? actCm3 * paceFactor : actCm3;

          // Targets (use DTC revenue as the comparable to Shopify netSales)
          const tgtRevenue = f.dtcRevenue ?? f.netRevenue ?? 0;
          const tgtCac = f.cac || 0;
          const tgtCm3 = f.contributionProfit || 0;
          const tgtOpex = f.totalOpex || 0;

          return {
            month: f.month, isCurrent, isPast,
            actRevenue, projRevenue, tgtRevenue,
            actCac, projCac, tgtCac,
            actOpex, tgtOpex,
            actCm3, projCm3, tgtCm3,
            forecast: f,
          };
        });

        // YTD totals (sum of past months actual + current MTD actual). Targets = sum of all forecast months in range.
        const ytdActual = rows.filter(r => r.isPast || r.isCurrent).reduce((a, r) => ({
          revenue: a.revenue + r.actRevenue,
          cac:     a.cac + r.actCac,
          opex:    a.opex + r.actOpex,
          cm3:     a.cm3 + r.actCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const ytdTargetSoFar = rows.filter(r => r.isPast || r.isCurrent).reduce((a, r) => ({
          revenue: a.revenue + r.tgtRevenue,
          cac:     a.cac + r.tgtCac,
          opex:    a.opex + r.tgtOpex,
          cm3:     a.cm3 + r.tgtCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        // Year-end projection: sum of past actuals + current MTD projected + future targets
        const eoyProjected = rows.reduce((a, r) => ({
          revenue: a.revenue + (r.isPast ? r.actRevenue : r.isCurrent ? r.projRevenue : r.tgtRevenue),
          cac:     a.cac + (r.isPast ? r.actCac : r.isCurrent ? r.projCac : r.tgtCac),
          opex:    a.opex + (r.isPast ? r.actOpex : r.isCurrent ? r.actOpex : r.tgtOpex), // future opex still uses target
          cm3:     a.cm3 + (r.isPast ? r.actCm3 : r.isCurrent ? r.projCm3 : r.tgtCm3),
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const eoyTarget = rows.reduce((a, r) => ({
          revenue: a.revenue + r.tgtRevenue,
          cac:     a.cac + r.tgtCac,
          opex:    a.opex + r.tgtOpex,
          cm3:     a.cm3 + r.tgtCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const fmt$ = (n) => n == null || isNaN(n) ? '—' : '$' + Math.round(n).toLocaleString();
        const fmtPct = (n) => n == null || isNaN(n) ? '—' : (n * 100).toFixed(1) + '%';
        const pctOf = (a, t) => t > 0 ? a / t : null;
        const fmtMo = (mk) => {
          const [y, m] = mk.split('-');
          return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short' });
        };

        const KPI_DEFS = [
          { key: 'revenue', label: 'Revenue',  goodWhen: 'higher' },
          { key: 'cac',     label: 'Ad Spend (CAC)', goodWhen: 'tracking' },  // hitting target = good
          { key: 'opex',    label: 'OpEx',     goodWhen: 'lower' },
          { key: 'cm3',     label: 'CM3',      goodWhen: 'higher' },
        ];
        const colorFor = (actual, target, goodWhen) => {
          if (target == null || target === 0) return '#8b949e';
          const ratio = actual / target;
          if (goodWhen === 'higher')  return ratio >= 1 ? '#3fb950' : ratio >= 0.85 ? '#f5a623' : '#f85149';
          if (goodWhen === 'lower')   return ratio <= 1 ? '#3fb950' : ratio <= 1.15 ? '#f5a623' : '#f85149';
          return Math.abs(ratio - 1) < 0.15 ? '#3fb950' : '#f5a623'; // tracking: ±15% of target
        };

        return (
          <>
            {forecastUpdatedAt && (
              <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1, marginBottom: 14 }}>
                Forecast last pulled {forecastUpdatedAt.toLocaleString()} · Sheet: {forecast.sheetName} · {(forecast.months || []).length} months parsed
              </div>
            )}

            {/* YTD Pacing strip */}
            <div style={{ ...S.card, marginBottom: 16 }}>
              <span style={S.label}>YTD Pacing — {thisYear} (through {fmtMo(currentMonthKey)})</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 12 }}>
                {KPI_DEFS.map(({ key, label, goodWhen }) => {
                  const a = ytdActual[key], t = ytdTargetSoFar[key];
                  const ratio = pctOf(a, t);
                  const color = colorFor(a, t, goodWhen);
                  return (
                    <div key={key} style={{ borderLeft: '2px solid #2a3441', paddingLeft: 14 }}>
                      <div style={{ ...S.label, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f4f8', lineHeight: 1 }}>{fmt$(a)}</div>
                      <div style={{ fontSize: 10, color: '#6e7681', marginTop: 4, letterSpacing: 1 }}>vs {fmt$(t)} target</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 6 }}>
                        {ratio == null ? '—' : (ratio * 100).toFixed(0) + '% to plan'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Year-end projection */}
            <div style={{ ...S.card, marginBottom: 20 }}>
              <span style={S.label}>{thisYear} Year-End Projection (past actuals + MTD pace + future targets)</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 12 }}>
                {KPI_DEFS.map(({ key, label, goodWhen }) => {
                  const proj = eoyProjected[key], tgt = eoyTarget[key];
                  const ratio = pctOf(proj, tgt);
                  const color = colorFor(proj, tgt, goodWhen);
                  return (
                    <div key={key} style={{ borderLeft: '2px solid #2a3441', paddingLeft: 14 }}>
                      <div style={{ ...S.label, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f4f8', lineHeight: 1 }}>{fmt$(proj)}</div>
                      <div style={{ fontSize: 10, color: '#6e7681', marginTop: 4, letterSpacing: 1 }}>vs {fmt$(tgt)} plan</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 6 }}>
                        {ratio == null ? '—' : (ratio * 100).toFixed(0) + '% of plan'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-month pacing table */}
            <div style={{ ...S.card }}>
              <span style={S.label}>Monthly Pacing — Actual vs Target</span>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, minWidth: 880 }}>
                  <thead>
                    <tr>
                      {['Month', 'Status', 'Revenue Act', 'Rev Tgt', 'Δ', 'CAC Act', 'CAC Tgt', 'Δ', 'CM3 Act', 'CM3 Tgt', 'Δ'].map((h, i) => (
                        <th key={i} style={{ fontSize: 8, letterSpacing: 1, color: '#6e7681', textAlign: i === 0 || i === 1 ? 'left' : 'right', padding: '4px 6px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const status = r.isPast ? 'actual' : r.isCurrent ? 'pace' : 'plan';
                      const statusColor = r.isPast ? '#3fb950' : r.isCurrent ? '#DC440A' : '#6e7681';
                      const revRow = r.isPast ? r.actRevenue : r.isCurrent ? r.projRevenue : r.tgtRevenue;
                      const cacRow = r.isPast ? r.actCac : r.isCurrent ? r.projCac : r.tgtCac;
                      const cm3Row = r.isPast ? r.actCm3 : r.isCurrent ? r.projCm3 : r.tgtCm3;
                      const dRev = r.tgtRevenue > 0 ? (revRow / r.tgtRevenue) - 1 : null;
                      const dCac = r.tgtCac > 0 ? (cacRow / r.tgtCac) - 1 : null;
                      const dCm3 = r.tgtCm3 > 0 ? (cm3Row / r.tgtCm3) - 1 : (r.tgtCm3 < 0 ? null : null);
                      const cell = (txt, color) => <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: color || '#c9d1d9', textAlign: 'right' }}>{txt}</td>;
                      const deltaCell = (d, goodWhen) => {
                        if (d == null) return cell('—', '#6e7681');
                        const sign = d > 0 ? '+' : '';
                        const good = goodWhen === 'lower' ? d <= 0 : d >= 0;
                        return cell(`${sign}${(d * 100).toFixed(0)}%`, good ? '#3fb950' : '#f85149');
                      };
                      return (
                        <tr key={r.month} style={{ borderTop: '1px solid #2a3441' }}>
                          <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.isCurrent ? '#DC440A' : '#c9d1d9', fontWeight: r.isCurrent ? 700 : 400 }}>{fmtMo(r.month)}</td>
                          <td style={{ padding: '6px 6px 6px 0', fontSize: 9, color: statusColor, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>{status}</td>
                          {cell(fmt$(revRow), '#f0f4f8')} {cell(fmt$(r.tgtRevenue))}{deltaCell(dRev, 'higher')}
                          {cell(fmt$(cacRow))} {cell(fmt$(r.tgtCac))}{deltaCell(dCac, 'lower')}
                          {cell(fmt$(cm3Row), cm3Row >= 0 ? '#3fb950' : '#f85149')} {cell(fmt$(r.tgtCm3))}{deltaCell(dCm3, 'higher')}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 9, color: '#6e7681', marginTop: 10, letterSpacing: 1 }}>
                STATUS — actual: closed month, pace: current month projected to month-end, plan: forecast value used. CAC delta uses "lower is better"; revenue & CM3 use "higher is better". Forecast revenue line = DTC Revenue (closest comp to Shopify net sales).
              </div>
            </div>
          </>
        );
      })()}

      {view === 'meta' && !data && !loading && (
        <div style={{ color: '#6e7681', fontSize: 12, padding: '40px 0' }}>
          Click "Load Meta" above to pull your ad shipping data from Meta.
        </div>
      )}

      {view === 'meta' && data && (
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
      {view === 'shopify' && shopifyUpdated && (
        <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1, marginBottom: 16 }}>
          Updated {shopifyUpdated.toLocaleTimeString()}
        </div>
      )}

      {view === 'shopify' && shopifyError && <div style={{ ...S.err, marginBottom: 20 }}>{shopifyError}</div>}

      {view === 'shopify' && (
        <DealerCsvImport onUploaded={() => {
          fetch('/api/db/monthly-metrics').then(r => r.json()).then(d => {
            if (Array.isArray(d.rows)) setHistorySnapshots(d.rows);
          }).catch(() => {});
        }} />
      )}

      {view === 'shopify' && !shopifyData && !shopifyLoading && (
        <div style={{ color: '#6e7681', fontSize: 12, padding: '40px 0' }}>
          Click "Load Shopify" above to pull store analytics from Shopify.
        </div>
      )}

      {view === 'shopify' && shopifyData && (() => {
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
