import React, { useState, useCallback, useEffect } from 'react';
import DealerCsvImport from './DealerCsvImport';
import CreativePerformanceWorkspace from './CreativePerformanceWorkspace';
import { getAnnualRevenuePace } from '../utils/forecastPace';

const TYPE_COLORS = {
  static:  '#6e40c9',
  review:  '#d84a17',
  video:   '#1a7f37',
  other:   '#4a5568',
};

const TYPE_LABELS = { static: 'Static', review: 'Review', video: 'Video', other: 'Other' };

const DASH = {
  bg: '#f7f6f2',
  surface: '#fff',
  surface2: '#f4f1ea',
  surface3: '#faf9f6',
  border: '#dedbd3',
  border2: '#c9c4ba',
  text: '#171717',
  text2: '#343330',
  muted: '#6f6d68',
  muted2: '#88857f',
  flame: '#d84a17',
  flameDim: '#fff0e9',
  flameBorder: '#efb9a4',
  success: '#256b35',
  warning: '#9a6a0a',
  danger: '#b42318',
  blue: '#315f91',
};

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

function netRevenueFor(source, overrideRevenue) {
  if (overrideRevenue != null) return Number(overrideRevenue || 0);
  return Number(source?.shopifyNetSales ?? source?.netSales ?? 0);
}

function grossRevenueFor(source) {
  if (!source) return 0;
  if (source.grossSales != null) return Number(source.grossSales || 0);
  const netSales = Number(source?.netSales || 0);
  const shopifyNetSales = Number(source?.shopifyNetSales || 0);
  if (shopifyNetSales > 0 && netSales > shopifyNetSales) return netSales;
  return netSales;
}

function sumGrossRevenue(...sources) {
  return sources.reduce((sum, source) => sum + grossRevenueFor(source), 0);
}

function sumNetRevenue(...sources) {
  return sources.reduce((sum, source) => sum + netRevenueFor(source), 0);
}

function wholesaleGrossMarginPct(dtcGrossMarginPct, wholesaleRetailPct) {
  const retailPct = Math.max(Number(wholesaleRetailPct || 70), 1) / 100;
  const retailCogsRate = 1 - (Number(dtcGrossMarginPct || 0) / 100);
  return Math.max(0, Math.min(100, (1 - (retailCogsRate / retailPct)) * 100));
}

function estimatedCogsFor(source, revenue, fallbackGrossMarginPct) {
  const costedRevenue = Math.min(Number(source?.costedRevenue || 0), Number(revenue || 0));
  const actualCogs = Number(source?.cogs || 0);
  const fallbackRevenue = Math.max(Number(revenue || 0) - costedRevenue, 0);
  return actualCogs + fallbackRevenue * (1 - (Number(fallbackGrossMarginPct || 0) / 100));
}

function numberInputValue(value) {
  return value ?? '';
}

function numberInputChange(value) {
  return value === '' ? '' : Number(value);
}

function assumptionNumber(value, fallback = 0) {
  return value === '' || value == null || Number.isNaN(Number(value)) ? fallback : Number(value);
}

function acquisitionRevenueFor(source, revenue) {
  const totalRevenue = Number(revenue || 0);
  if (totalRevenue <= 0) return 0;
  const rawNewRevenue = Number(source?.newRevenue || 0);
  const rawReturningRevenue = Number(source?.returningRevenue || 0);
  const classifiedCoverage = (rawNewRevenue + rawReturningRevenue) / totalRevenue;

  if (rawNewRevenue > 0 && classifiedCoverage >= 0.8) {
    return rawNewRevenue;
  }

  const newCustomers = Number(source?.newCustomers || 0);
  const returningCustomers = Number(source?.returningCustomers || 0);
  const totalCustomers = newCustomers + returningCustomers;
  if (totalCustomers <= 0) return rawNewRevenue;
  return totalRevenue * (newCustomers / totalCustomers);
}

function fmtCtr(n) {
  if (!n) return '—';
  return parseFloat(n).toFixed(2) + '%';
}

function getCreativeStatus(g) {
  const spend = Number(g.spend) || 0;
  const roas = Number(g.roas) || 0;
  const cpa = Number(g.cpa) || 0;
  const ctr = Number(g.ctr) || 0;
  const hookRate = Number(g.hookRate) || 0;
  const purchases = Number(g.purchases) || 0;
  const profit = Number(g.contribProfit) || 0;

  if (spend < 50 && purchases === 0) {
    return { label: 'Learning', color: DASH.muted, bg: '#f4f1ea', border: '#d8d4ca' };
  }
  if (profit > 0 && roas >= 2 && purchases >= 2) {
    return { label: 'Winner', color: DASH.success, bg: '#edf7ee', border: '#afd5b7' };
  }
  if (spend >= 100 && roas < 1 && purchases <= 1) {
    return { label: 'Stop', color: DASH.danger, bg: '#fde4df', border: '#efb3a6' };
  }
  if (ctr > 0 && ctr < 0.008 && spend >= 75) {
    return { label: 'Hook Weak', color: DASH.warning, bg: '#fff6dc', border: '#ead28b' };
  }
  if (hookRate > 0.25 && (roas < 1.5 || cpa > 80)) {
    return { label: 'Fix Offer', color: DASH.warning, bg: '#fff6dc', border: '#ead28b' };
  }
  return { label: 'Watch', color: DASH.blue, bg: '#eaf2fb', border: '#b8d0ea' };
}

function getCreativeNextTests(g) {
  const status = getCreativeStatus(g).label;
  const hookRate = Number(g.hookRate) || 0;
  const holdRate = Number(g.holdRate) || 0;
  const ctr = Number(g.ctr) || 0;
  const roas = Number(g.roas) || 0;
  const cpa = Number(g.cpa) || 0;
  const ideas = [];

  if (status === 'Winner') {
    ideas.push('Make 5 hook variants from this opening');
    ideas.push('Brief 2 creators to copy the format');
  } else if (status === 'Stop') {
    ideas.push('Pause unless it has a strategic learning');
    ideas.push('Reuse only the product proof, not the hook');
  } else if (status === 'Hook Weak' || ctr < 0.008) {
    ideas.push('Rewrite the first 2 seconds');
    ideas.push('Test a stronger opening frame');
  } else if (status === 'Fix Offer' || (hookRate > 0.25 && roas < 1.5)) {
    ideas.push('Keep the hook, test price/proof/body copy');
    ideas.push('Send traffic to the best product-specific URL');
  } else if (holdRate > 0 && holdRate < 0.2) {
    ideas.push('Tighten the middle and show product sooner');
  } else if (cpa > 0 && cpa > 80) {
    ideas.push('Test lower-friction copy and clearer proof');
  } else {
    ideas.push('Let it spend to signal threshold');
  }

  return ideas.slice(0, 2);
}

const S = {
  wrap:    { padding: '40px 42px 72px', maxWidth: 1100, minHeight: '100vh', background: DASH.bg, color: DASH.text, fontFamily: "'Helvetica Neue', Helvetica, sans-serif" },
  label:   { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: DASH.muted2, marginBottom: 8, display: 'block', fontWeight: 700 },
  ghostBtn:{ padding: '10px 15px', background: DASH.surface, border: `1px solid ${DASH.border}`, color: DASH.muted, fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, cursor: 'pointer', borderRadius: 9 },
  btn:     { padding: '10px 15px', background: DASH.text, border: 'none', color: '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, cursor: 'pointer', borderRadius: 9 },
  card:    { background: DASH.surface, border: `1px solid ${DASH.border}`, borderRadius: 16, padding: '18px 20px', boxShadow: '0 16px 36px rgba(45,40,30,.07)' },
  stat:    { fontSize: 30, fontWeight: 400, color: DASH.text, lineHeight: 1, fontFamily: "'Instrument Serif', Georgia, serif" },
  divider: { borderTop: `1px solid ${DASH.border}`, margin: '28px 0' },
  err:     { padding: '10px 13px', border: `1px solid ${DASH.flameBorder}`, background: '#fff3ed', color: DASH.danger, fontSize: 11, borderRadius: 10 },
};

const DASH_TABS = [
  { key: 'dashboard-cfo',      view: 'cfo',      label: 'CFO' },
  { key: 'dashboard-growth',   view: 'growth',   label: 'Growth' },
  { key: 'dashboard-meta',     view: 'meta',     label: 'Meta' },
  { key: 'dashboard-shopify',  view: 'shopify',  label: 'Shopify' },
  { key: 'dashboard-creative', view: 'creative', label: 'Creative' },
  { key: 'dashboard-forecast', view: 'forecast', label: 'Forecast' },
];

export default function DashboardTool({ view = 'cfo', setActiveTab, canManageCreators = false }) {
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

  // Top Creatives — Motion-style sortable table. Reads from creative_performance +
  // creative_insights_daily (populated by sync_creative_analytics). One fetch per
  // window change, no Meta call on page load.
  const [creativeTable, setCreativeTable] = useState(null);
  const [creativeTableLoading, setCreativeTableLoading] = useState(false);
  const [creativeTableError, setCreativeTableError] = useState('');
  const [creativeWindowDays, setCreativeWindowDays] = useState(14);
  const [creativeSortKey, setCreativeSortKey] = useState('spend');
  const [creativeSortDir, setCreativeSortDir] = useState('desc');
  const [creativeSyncing, setCreativeSyncing] = useState(false);
  const [creativeSyncMsg, setCreativeSyncMsg] = useState('');
  const [creativeExpanded, setCreativeExpanded] = useState({}); // groupKey -> { loading, ads }
  const [analysisQueue, setAnalysisQueue] = useState(null);
  const [analysisQueueLoading, setAnalysisQueueLoading] = useState(false);
  const [analysisQueueMessage, setAnalysisQueueMessage] = useState('');
  const [analysisBatchRunning, setAnalysisBatchRunning] = useState(false);
  const creativeWorkspaceMode = 'motion';

  const loadCreativeTable = useCallback(async (days) => {
    setCreativeTableLoading(true); setCreativeTableError('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_creative_table', sinceDays: days }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCreativeTable(d);
    } catch (err) { setCreativeTableError(err.message); }
    finally { setCreativeTableLoading(false); }
  }, []);

  // Auto-load Top Creatives when entering the creative view or changing the window.
  useEffect(() => {
    if (view !== 'creative') return;
    loadCreativeTable(creativeWindowDays);
  }, [view, creativeWindowDays, loadCreativeTable]);

  const loadAnalysisQueue = useCallback(async () => {
    setAnalysisQueueLoading(true);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_creative_analysis_queue' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAnalysisQueue(d.queue || null);
    } catch (err) {
      setAnalysisQueueMessage(`Queue status failed: ${err.message}`);
    } finally {
      setAnalysisQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== 'creative') return;
    loadAnalysisQueue();
  }, [view, loadAnalysisQueue]);

  const [creativeInitMsg, setCreativeInitMsg] = useState('');
  const [creativeIniting, setCreativeIniting] = useState(false);
  const initCreativeTables = useCallback(async () => {
    setCreativeIniting(true); setCreativeInitMsg('');
    try {
      const r = await fetch('/api/db/schema', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Schema init failed');
      setCreativeInitMsg('Tables ready. Click Sync from Meta to pull data.');
      setCreativeTableError('');
      await loadCreativeTable(creativeWindowDays);
    } catch (err) {
      setCreativeInitMsg(`Init failed: ${err.message}`);
    } finally { setCreativeIniting(false); }
  }, [creativeWindowDays, loadCreativeTable]);

  const syncCreativeAnalytics = useCallback(async () => {
    setCreativeSyncing(true); setCreativeSyncMsg('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_creative_analytics', sinceDays: 30, force: true }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCreativeSyncMsg(`Synced ${d.adsUpserted || 0} ads · ${d.insightsUpserted || 0} daily rows · ${d.queuedForAnalysis || 0} queued`);
      await loadCreativeTable(creativeWindowDays);
      await loadAnalysisQueue();
    } catch (err) { setCreativeSyncMsg(`Sync failed: ${err.message}`); }
    finally { setCreativeSyncing(false); }
  }, [creativeWindowDays, loadAnalysisQueue, loadCreativeTable]);

  const assignCreativeCreator = useCallback(async (groupKey, creatorId, source = {}) => {
    const r = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'assign_creative_creator',
        groupKey,
        creatorId: creatorId || null,
        sourceType: source.sourceType || null,
        sourceLabel: source.sourceLabel || null,
      }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Could not assign creative source');
    setCreativeTable(prev => prev ? {
      ...prev,
      groups: prev.groups.map(group => group.groupKey === groupKey ? {
        ...group,
        creatorId: d.creator?.id ? Number(d.creator.id) : null,
        creatorName: d.creator?.name || null,
        sourceType: d.sourceType || null,
        sourceLabel: d.sourceLabel || null,
        creatorConflict: false,
        suggestedCreatorId: d.creator?.id ? null : group.suggestedCreatorId,
        suggestedCreatorName: d.creator?.id ? null : group.suggestedCreatorName,
        suggestionConfidence: d.creator?.id ? null : group.suggestionConfidence,
        suggestionReason: d.creator?.id ? null : group.suggestionReason,
      } : group),
    } : prev);
    return d;
  }, []);

  const assignCreativeCreators = useCallback(async (assignments) => {
    const r = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign_creative_creators', assignments }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Could not assign creators');
    const updates = new Map((d.assignments || []).map(item => [item.groupKey, item]));
    setCreativeTable(prev => prev ? {
      ...prev,
      groups: prev.groups.map(group => {
        const update = updates.get(group.groupKey);
        return update ? {
          ...group,
          creatorId: Number(update.creatorId),
          creatorName: update.creatorName,
          sourceType: 'external_creator',
          sourceLabel: update.creatorName,
          creatorConflict: false,
          suggestedCreatorId: null,
          suggestedCreatorName: null,
          suggestionConfidence: null,
          suggestionReason: null,
        } : group;
      }),
    } : prev);
    return d;
  }, []);

  const processAnalysisBatch = useCallback(async () => {
    setAnalysisBatchRunning(true);
    setAnalysisQueueMessage('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_creative_analysis_queue', batchSize: 3 }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAnalysisQueue(d.queue || null);
      const completed = (d.results || []).filter(item => item.status === 'completed').length;
      const retrying = (d.results || []).filter(item => item.status === 'retrying').length;
      const failed = (d.results || []).filter(item => item.status === 'failed').length;
      setAnalysisQueueMessage(`Processed ${d.processed || 0}: ${completed} complete${retrying ? ` · ${retrying} retrying` : ''}${failed ? ` · ${failed} failed` : ''}`);
      await loadCreativeTable(creativeWindowDays);
    } catch (err) {
      setAnalysisQueueMessage(`Batch failed: ${err.message}`);
    } finally {
      setAnalysisBatchRunning(false);
    }
  }, [creativeWindowDays, loadCreativeTable]);

  const retryAnalysisBatch = useCallback(async () => {
    setAnalysisQueueMessage('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry_creative_analysis_queue' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAnalysisQueue(d.queue || null);
      setAnalysisQueueMessage(`${d.retried || 0} failed job${d.retried === 1 ? '' : 's'} returned to the queue`);
    } catch (err) {
      setAnalysisQueueMessage(`Retry failed: ${err.message}`);
    }
  }, []);

  // Creative DNA — per-group AI analysis. Drawer shows on demand.
  const [analyzingGroup, setAnalyzingGroup] = useState(null);   // groupKey currently being analyzed
  const [analysisDrawer, setAnalysisDrawer] = useState(null);   // { groupKey, name, analysis, loading, error }
  const openAnalysis = useCallback(async (groupKey, name) => {
    setAnalysisDrawer({ groupKey, name, analysis: null, loading: true, error: '' });
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_creative_analysis', groupKey }),
      });
      const d = await r.json();
      setAnalysisDrawer({ groupKey, name, analysis: d.analysis, loading: false, error: d.error || '' });
    } catch (err) {
      setAnalysisDrawer({ groupKey, name, analysis: null, loading: false, error: err.message });
    }
  }, []);
  const runAnalysis = useCallback(async (groupKey, name, manualTranscript) => {
    setAnalyzingGroup(groupKey);
    setAnalysisDrawer({ groupKey, name, analysis: null, loading: true, error: '' });
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze_creative_group', groupKey, manualTranscript }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      // Reshape API response to DB row shape so the drawer renders the same way for fresh + cached analyses.
      const a = d.analysis;
      setAnalysisDrawer({
        groupKey, name, loading: false, error: '',
        analysis: {
          group_key: a.groupKey, asset_kind: a.assetKind, transcript: a.transcript,
          hook_text_verbatim: a.hookTextVerbatim, hook_type: a.hookType,
          format: a.format, angle: a.angle, talent_description: a.talentDescription,
          visual_summary: a.visualSummary, why_it_worked: a.whyItWorked,
          performance_snapshot: a.performance, generated_at: a.generatedAt,
        },
        debug: d.debug || null,
      });
      // Reflect the new analyzed status on the row without a full refetch.
      setCreativeTable(prev => prev ? {
        ...prev,
        groups: prev.groups.map(g => g.groupKey === groupKey
          ? { ...g, isAnalyzed: true, analysisQueueStatus: 'completed' }
          : g),
      } : prev);
      await loadAnalysisQueue();
    } catch (err) {
      setAnalysisDrawer({ groupKey, name, analysis: null, loading: false, error: err.message });
    } finally { setAnalyzingGroup(null); }
  }, [loadAnalysisQueue]);

  const toggleCreativeRow = useCallback(async (groupKey) => {
    setCreativeExpanded(prev => {
      if (prev[groupKey]?.ads) {
        const { [groupKey]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [groupKey]: { loading: true, ads: null } };
    });
    if (creativeExpanded[groupKey]?.ads) return;
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_creative_group_ads', groupKey, sinceDays: creativeWindowDays }),
      });
      const d = await r.json();
      setCreativeExpanded(prev => ({ ...prev, [groupKey]: { loading: false, ads: d.ads || [] } }));
    } catch {
      setCreativeExpanded(prev => ({ ...prev, [groupKey]: { loading: false, ads: [] } }));
    }
  }, [creativeWindowDays, creativeExpanded]);

  // Shopify analytics state
  const [shopifyData,    setShopifyData]    = useState(null);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError,   setShopifyError]   = useState('');
  const [shopifyUpdated, setShopifyUpdated] = useState(null);

  // Google Ads state
  const [googleData,    setGoogleData]    = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError,   setGoogleError]   = useState('');
  const [googleUpdated, setGoogleUpdated] = useState(null);

  // Klaviyo growth reporting state
  const [klaviyoData,    setKlaviyoData]    = useState(null);
  const [klaviyoLoading, setKlaviyoLoading] = useState(false);
  const [klaviyoError,   setKlaviyoError]   = useState('');
  const [klaviyoUpdated, setKlaviyoUpdated] = useState(null);

  // Growth AI analysis state
  const [performanceQuestion, setPerformanceQuestion] = useState('What is most limiting profitable growth right now, and which ratios are out of bounds?');
  const [performanceAnswer, setPerformanceAnswer] = useState('');
  const [performanceChatLoading, setPerformanceChatLoading] = useState(false);
  const [performanceChatError, setPerformanceChatError] = useState('');

  // CFO assumptions (loaded from /api/db/dashboard-settings).
  // Initialize with defaults so the panel renders even if the fetch is still pending or fails.
  const [settings, setSettings] = useState({
    grossMarginPct: 60, dealerWholesaleRetailPct: 70, paymentFeePct: 2.9, paymentFeeFixed: 0.30,
    shippingCostPerOrder: 8, fulfillmentCostPerOrder: 3, monthlyOpex: 50000,
    googleSpend: {}, opexByMonth: {}, dealerRevenueByMonth: {}, dealerOrdersByMonth: {},
    offPlatformRevenueByMonth: {}, offPlatformOrdersByMonth: {}, cfoStartMonth: '2026-01',
    annualRevenueTargetBase: 13000000, annualRevenueTargetStretch: 15000000,
    annualRevenueCurveBase: [
      286002.327, 326854.894, 509399.839, 487593.84,
      598425.6439, 672240.6439, 1162449.05, 1263926.085,
      1373676.285, 1527816.515, 3260132.345, 994944.915,
    ],
    annualRevenueCurveStretch: [
      307279.9112, 471602.8484, 721536.7344, 738059.3916,
      735743.7212, 996673.7412, 861438.8592, 1224937.8,
      1537078.032, 1678832.376, 3792607.048, 1484514.324,
    ],
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

  const STALE_MS = 24 * 60 * 60 * 1000;
  const newestSourceSnapshotAt = (...fields) => historySnapshots.reduce((max, row) => {
    for (const field of fields) {
      const t = row[field]?.snapshotAt ? new Date(row[field].snapshotAt).getTime() : 0;
      if (t > max) max = t;
    }
    return max;
  }, 0);
  const newestShopifySnapshotAt = newestSourceSnapshotAt('shopify', 'shopify_dealer');
  const newestMetaSnapshotAt = newestSourceSnapshotAt('meta');
  const newestKlaviyoSnapshotAt = newestSourceSnapshotAt('klaviyo');
  const shopifyIsStale = !newestShopifySnapshotAt || (Date.now() - newestShopifySnapshotAt) > STALE_MS;
  const metaIsStale = !newestMetaSnapshotAt || (Date.now() - newestMetaSnapshotAt) > STALE_MS;
  const klaviyoIsStale = !newestKlaviyoSnapshotAt || (Date.now() - newestKlaviyoSnapshotAt) > STALE_MS;
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
    const snapshotAt = new Date().toISOString();
    const hasStoreBreakdown = !!shopifyData._stores;
    const primaryMonths = hasStoreBreakdown
      ? (shopifyData._stores?.primary?.months || [])
      : shopifyData.months;
    const dealerMonths = shopifyData._stores?.dealer?.months || [];
    const byMonth = new Map();
    for (const m of primaryMonths) {
      byMonth.set(m.month, {
        month: m.month,
        shopify: {
          netSales: m.netSales, grossSales: m.grossSales ?? m.netSales, orders: m.orders, shipping: m.shipping,
          sessions: m.sessions, cvr: m.cvr,
          customers: m.customers, shopifyNetSales: m.shopifyNetSales,
          newCustomers: m.newCustomers, returningCustomers: m.returningCustomers,
          newRevenue: m.newRevenue, returningRevenue: m.returningRevenue,
          cogs: m.cogs, costedRevenue: m.costedRevenue, uncostedRevenue: m.uncostedRevenue,
          customerKeys: m.customerKeys, newCustomerKeys: m.newCustomerKeys,
          returningCustomerKeys: m.returningCustomerKeys,
          reportYtd: shopifyData?._stores?.primary?.ytd,
          snapshotAt,
        },
      });
    }
    for (const m of dealerMonths) {
      const snapshot = byMonth.get(m.month) || { month: m.month };
      snapshot.shopify_dealer = {
        netSales: m.netSales, grossSales: m.grossSales ?? m.netSales, orders: m.orders, shipping: m.shipping,
        sessions: m.sessions, cvr: m.cvr,
        customers: m.customers, shopifyNetSales: m.shopifyNetSales,
        newCustomers: m.newCustomers, returningCustomers: m.returningCustomers,
        newRevenue: m.newRevenue, returningRevenue: m.returningRevenue,
        cogs: m.cogs, costedRevenue: m.costedRevenue, uncostedRevenue: m.uncostedRevenue,
        customerKeys: m.customerKeys, newCustomerKeys: m.newCustomerKeys,
        returningCustomerKeys: m.returningCustomerKeys,
        reportYtd: shopifyData?._stores?.dealer?.ytd,
        snapshotAt,
      };
      byMonth.set(m.month, snapshot);
    }
    const snapshots = [...byMonth.values()];
    if (!snapshots.length) return;
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
    const snapshotAt = new Date().toISOString();
    const snapshots = data.monthlyInsights.map(m => ({
      month: m.month,
      meta: { spend: m.spend, impressions: m.impressions, clicks: m.clicks, purchases: m.purchases, cpa: m.cpa, roas: m.roas, snapshotAt },
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

  const loadGoogle = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleError('');
    try {
      const r = await fetch('/api/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_monthly' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setGoogleData(d);
      setGoogleUpdated(new Date());
      // Refresh snapshots so the merged view reflects the upsert.
      try {
        const r2 = await fetch('/api/db/monthly-metrics');
        const d2 = await r2.json();
        if (Array.isArray(d2.rows)) setHistorySnapshots(d2.rows);
      } catch {}
    } catch (err) {
      setGoogleError(err.message);
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  const loadKlaviyo = useCallback(async () => {
    setKlaviyoLoading(true);
    setKlaviyoError('');
    try {
      const r = await fetch('/api/klaviyo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_monthly' }),
      });
      const d = await r.json();
      if (d.error && d.configured !== false) throw new Error(d.error);
      setKlaviyoData(d);
      setKlaviyoUpdated(new Date());
      try {
        const r2 = await fetch('/api/db/monthly-metrics');
        const d2 = await r2.json();
        if (Array.isArray(d2.rows)) setHistorySnapshots(d2.rows);
      } catch {}
    } catch (err) {
      setKlaviyoError(err.message);
    } finally {
      setKlaviyoLoading(false);
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
    if (metaIsStale && !data && !loading) loadDashboard();
    if (shopifyIsStale && !shopifyData && !shopifyLoading) loadShopify();
    if (klaviyoIsStale && !klaviyoData && !klaviyoLoading) loadKlaviyo();
    setAutoTried(true);
  }, [snapshotsLoaded, autoTried, metaIsStale, shopifyIsStale, klaviyoIsStale, data, shopifyData, klaviyoData, loading, shopifyLoading, klaviyoLoading, loadDashboard, loadShopify, loadKlaviyo]);

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
    cfo:      { title: 'CFO View',  subtitle: 'Revenue, contribution margin, OpEx coverage, and estimated profitability.' },
    growth:   { title: 'Growth Data', subtitle: 'Media mix, channel spend, and acquisition context.' },
    meta:     { title: 'Meta Ads',  subtitle: 'Live budget, formats, monthly velocity, recent launches.' },
    shopify:  { title: 'Shopify',   subtitle: 'Seasonality, monthly trend, CVR, product mix.' },
    creative: { title: 'Creative',  subtitle: 'Velocity, format mix, top creators — sourced from launch_history.' },
    forecast: { title: 'Forecast',  subtitle: 'Pacing actuals against the HOWL \'26 projections.' },
  };
  const v = VIEW_TITLES[view] || VIEW_TITLES.cfo;

  return (
    <div className="dashboard-workspace dashboard-motion-workspace" style={{ ...S.wrap, maxWidth: view === 'creative' ? 1600 : S.wrap.maxWidth }}>
      {setActiveTab && (
        <div className="dash-subnav">
          {DASH_TABS.map(t => (
            <button
              key={t.key}
              className={`dash-subtab ${view === t.view ? 'on' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >{t.label}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Dashboard</div>
          <div className="display-lg" style={{ color: '#171717' }}>{v.title}</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#77746f', marginTop: 6 }}>
            {v.subtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(newestShopifySnapshotAt > 0 || newestMetaSnapshotAt > 0 || newestKlaviyoSnapshotAt > 0) && (
            <span style={{ fontSize: 9, color: (shopifyIsStale || metaIsStale || klaviyoIsStale) ? '#9a6a0a' : '#88857f', letterSpacing: 1 }}>
              Shopify {(() => {
                if (!newestShopifySnapshotAt) return 'not synced';
                const ageMs = Date.now() - newestShopifySnapshotAt;
                const m = Math.floor(ageMs / 60000);
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                const d = Math.floor(h / 24);
                return `${d}d ago`;
              })()} · Meta {(() => {
                if (!newestMetaSnapshotAt) return 'not synced';
                const ageMs = Date.now() - newestMetaSnapshotAt;
                const m = Math.floor(ageMs / 60000);
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                const d = Math.floor(h / 24);
                return `${d}d ago`;
              })()} · Klaviyo {(() => {
                if (!newestKlaviyoSnapshotAt) return 'not synced';
                const ageMs = Date.now() - newestKlaviyoSnapshotAt;
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
          <button onClick={loadGoogle} disabled={googleLoading} style={googleLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (googleData ? S.ghostBtn : S.btn)}>
            {googleLoading ? 'Loading…' : googleData ? 'Refresh Google' : 'Load Google'}
          </button>
          {view === 'growth' && (
            <button onClick={loadKlaviyo} disabled={klaviyoLoading} style={klaviyoLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (klaviyoData ? S.ghostBtn : S.btn)}>
              {klaviyoLoading ? 'Loading…' : klaviyoData ? 'Refresh Klaviyo' : 'Load Klaviyo'}
            </button>
          )}
          {view === 'forecast' && (
            <button onClick={refreshForecast} disabled={forecastLoading} style={forecastLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : (forecast ? S.ghostBtn : S.btn)}>
              {forecastLoading ? 'Pulling…' : forecast ? 'Refresh Forecast' : 'Pull Forecast'}
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ ...S.err, marginBottom: 20 }}>{error}</div>}
      {googleError && <div style={{ ...S.err, marginBottom: 20 }}>Google Ads: {googleError}</div>}
      {klaviyoError && <div style={{ ...S.err, marginBottom: 20 }}>Klaviyo: {klaviyoError}</div>}
      {googleData && !googleError && (
        <div style={{ padding: '8px 12px', border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.08)', color: '#256b35', fontSize: 10, borderRadius: 4, marginBottom: 20 }}>
          Google Ads: pulled {googleData.months?.length || 0} months · ${(googleData.months || []).reduce((a, m) => a + (m.spend || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} total spend
        </div>
      )}
      {view === 'growth' && klaviyoData && !klaviyoError && (
        <div style={{ padding: '8px 12px', border: `1px solid ${klaviyoData.configured === false ? 'rgba(245,166,35,0.4)' : 'rgba(63,185,80,0.4)'}`, background: klaviyoData.configured === false ? 'rgba(245,166,35,0.1)' : 'rgba(63,185,80,0.08)', color: klaviyoData.configured === false ? '#9a6a0a' : '#256b35', fontSize: 10, borderRadius: 4, marginBottom: 20 }}>
          Klaviyo: {klaviyoData.configured === false ? (klaviyoData.error || 'not configured') : `pulled ${klaviyoData.months?.length || 0} months · $${Math.round((klaviyoData.months || []).reduce((a, m) => a + (m.revenue || 0), 0)).toLocaleString()} attributed revenue`}
        </div>
      )}

      {view === 'creative' && creativeWorkspaceMode === 'motion' && (
        <CreativePerformanceWorkspace
          creativeTable={creativeTable}
          loading={creativeTableLoading}
          error={creativeTableError}
          windowDays={creativeWindowDays}
          setWindowDays={setCreativeWindowDays}
          syncing={creativeSyncing}
          syncMessage={creativeSyncMsg}
          onSync={syncCreativeAnalytics}
          analysisQueue={analysisQueue}
          analysisQueueLoading={analysisQueueLoading}
          analysisQueueMessage={analysisQueueMessage}
          analysisBatchRunning={analysisBatchRunning}
          onProcessAnalysisBatch={processAnalysisBatch}
          onRetryAnalysisBatch={retryAnalysisBatch}
          onRefreshAnalysisQueue={loadAnalysisQueue}
          onAnalyze={runAnalysis}
          onOpenAnalysis={openAnalysis}
          onAssignCreator={assignCreativeCreator}
          onAssignCreators={assignCreativeCreators}
          canManageCreators={canManageCreators}
          setActiveTab={setActiveTab}
        />
      )}

      {/* Legacy operating table kept behind the workspace mode during rollout. */}
      {view === 'creative' && creativeWorkspaceMode === 'legacy' && (() => {
        const COLS = [
          { key: 'name',            label: 'Creative',     align: 'left',  sortable: false, kind: 'name' },
          { key: 'status',          label: 'Status',       align: 'left',  sortable: false, kind: 'status' },
          { key: 'nextTest',        label: 'Next test',    align: 'left',  sortable: false, kind: 'nextTest' },
          { key: 'firstLaunchDate', label: 'Launch date',  align: 'left',  sortable: true,  kind: 'date' },
          { key: 'spend',           label: 'Spend',        align: 'right', sortable: true,  kind: 'money', heat: 'high' },
          { key: 'purchaseValue',   label: 'Purchase value', align: 'right', sortable: true, kind: 'money', heat: 'high' },
          { key: 'contribProfit',   label: 'Contrib profit', align: 'right', sortable: true, kind: 'money', heat: 'high' },
          { key: 'contribMargin',   label: 'Contrib margin', align: 'right', sortable: true, kind: 'pct',   heat: 'high' },
          { key: 'roas',            label: 'ROAS',         align: 'right', sortable: true,  kind: 'x',     heat: 'high' },
          { key: 'cpa',             label: 'CPA',          align: 'right', sortable: true,  kind: 'money', heat: 'low' },
          { key: 'cpc',             label: 'CPC',          align: 'right', sortable: true,  kind: 'money', heat: 'low' },
          { key: 'hookRate',        label: 'Hook rate',    align: 'right', sortable: true,  kind: 'pct',   heat: 'high' },
          { key: 'holdRate',        label: 'Hold rate',    align: 'right', sortable: true,  kind: 'pct',   heat: 'high' },
          { key: 'ctr',             label: 'CTR',          align: 'right', sortable: true,  kind: 'pct',   heat: 'high' },
          { key: '__analyze',       label: '',             align: 'right', sortable: false, kind: 'action' },
        ];

	        // Pull CFO assumptions for per-creative contribution profit.
	        const s = settings || {};
	        const gmPct = assumptionNumber(s.grossMarginPct, 60) / 100;
	        const pfPct = assumptionNumber(s.paymentFeePct, 2.9) / 100;
	        const pfFixed = assumptionNumber(s.paymentFeeFixed, 0.30);
	        const shipPerOrder = assumptionNumber(s.shippingCostPerOrder, 8);
	        const fulfillPerOrder = assumptionNumber(s.fulfillmentCostPerOrder, 3);

        const groups = (creativeTable?.groups || []).map(g => {
          const rev = g.purchaseValue || 0;
          const orders = g.purchases || 0;
          const contribProfit =
            rev * gmPct
            - rev * pfPct
            - orders * pfFixed
            - orders * shipPerOrder
            - orders * fulfillPerOrder
            - (g.spend || 0);
          const contribMargin = rev > 0 ? contribProfit / rev : 0;
          return { ...g, contribProfit, contribMargin };
        });
        const sortKey = creativeSortKey;
        const dir = creativeSortDir === 'asc' ? 1 : -1;
        groups.sort((a, b) => {
          const av = a[sortKey], bv = b[sortKey];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });

        // Percentile-based heatmap. For 'low' columns (CPA/CPC), invert.
        const heatRanges = {};
        for (const c of COLS) {
          if (!c.heat) continue;
          const vals = groups.map(g => g[c.key]).filter(v => typeof v === 'number' && !isNaN(v) && v > 0);
          if (vals.length === 0) { heatRanges[c.key] = null; continue; }
          const sorted = [...vals].sort((a, b) => a - b);
          heatRanges[c.key] = { min: sorted[0], max: sorted[sorted.length - 1], heat: c.heat };
        }
        const heatColor = (key, val) => {
          const r = heatRanges[key];
          if (!r || typeof val !== 'number' || isNaN(val) || val <= 0 || r.max === r.min) return null;
          let t = (val - r.min) / (r.max - r.min); // 0..1
          if (r.heat === 'low') t = 1 - t;
          // alpha 0..0.35 of green
          const a = Math.max(0.05, Math.min(0.4, t * 0.4));
          return `rgba(63,185,80,${a.toFixed(3)})`;
        };
        const fmt = (kind, v) => {
          if (v == null || (typeof v === 'number' && (isNaN(v) || v === 0 && kind !== 'money'))) {
            if (kind === 'money' && v === 0) return '$0';
            if (v == null) return '—';
          }
          if (kind === 'money') {
            const n = v || 0;
            const sign = n < 0 ? '-' : '';
            return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          }
          if (kind === 'x') return `${(v || 0).toFixed(2)}x`;
          if (kind === 'pct') return `${((v || 0) * 100).toFixed(2)}%`;
          if (kind === 'date') {
            try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
            catch { return '—'; }
          }
          return v;
        };
        const sortClick = (key) => {
          if (creativeSortKey === key) {
            setCreativeSortDir(creativeSortDir === 'asc' ? 'desc' : 'asc');
          } else {
            setCreativeSortKey(key);
            setCreativeSortDir('desc');
          }
        };
        const sortIcon = (key) => creativeSortKey !== key ? '' : (creativeSortDir === 'desc' ? ' ▼' : ' ▲');
        const statusCounts = groups.reduce((acc, g) => {
          const label = getCreativeStatus(g).label;
          acc[label] = (acc[label] || 0) + 1;
          return acc;
        }, {});
        const statusOrder = ['Winner', 'Fix Offer', 'Hook Weak', 'Watch', 'Learning', 'Stop'];

        return (
          <div style={{ ...S.card, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <span style={S.label}>Top Creatives</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {[7, 14, 30, 90].map(d => (
                  <button key={d} onClick={() => setCreativeWindowDays(d)} disabled={creativeTableLoading} style={{
                    padding: '5px 10px',
                    background: creativeWindowDays === d ? 'rgba(220,68,10,0.15)' : 'none',
                    border: `1px solid ${creativeWindowDays === d ? '#d84a17' : '#dedbd3'}`,
                    color: creativeWindowDays === d ? '#d84a17' : '#77746f',
                    fontFamily: 'inherit', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
                    cursor: creativeTableLoading ? 'not-allowed' : 'pointer', borderRadius: 3,
                  }}>{d}d</button>
                ))}
                <button onClick={syncCreativeAnalytics} disabled={creativeSyncing} style={S.ghostBtn}>
                  {creativeSyncing ? 'Syncing…' : 'Sync from Meta'}
                </button>
              </div>
            </div>

            {creativeSyncMsg && (
              <div style={{ fontSize: 10, color: creativeSyncMsg.startsWith('Sync failed') ? '#b42318' : '#256b35', marginBottom: 10 }}>
                {creativeSyncMsg}
              </div>
            )}
            {creativeTableError && (
              <div style={{ ...S.err, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>{creativeTableError}</span>
                {/relation .* does not exist/i.test(creativeTableError) && (
                  <button onClick={initCreativeTables} disabled={creativeIniting} style={S.ghostBtn}>
                    {creativeIniting ? 'Initializing…' : 'Initialize tables'}
                  </button>
                )}
              </div>
            )}
            {creativeInitMsg && (
              <div style={{ fontSize: 10, color: creativeInitMsg.startsWith('Init failed') ? '#b42318' : '#256b35', marginBottom: 10 }}>
                {creativeInitMsg}
              </div>
            )}

            {groups.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                {statusOrder.filter(label => statusCounts[label]).map(label => {
                  const sample = groups.find(g => getCreativeStatus(g).label === label);
                  const status = sample ? getCreativeStatus(sample) : getCreativeStatus({});
                  return (
                    <span key={label} style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 8px',
                      borderRadius: 3,
                      border: `1px solid ${status.border}`,
                      background: status.bg,
                      color: status.color,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                    }}>
                      {label} <span style={{ color: '#171717' }}>{statusCounts[label]}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {creativeTableLoading && !creativeTable && (
              <div style={{ fontSize: 11, color: '#88857f', padding: '20px 0' }}>Loading…</div>
            )}

            {creativeTable && groups.length === 0 && (
              <div style={{ fontSize: 11, color: '#88857f', padding: '14px 0' }}>
                No creative performance in this window. Try a longer window or click Sync from Meta.
              </div>
            )}

            {groups.length > 0 && (
              <div style={{ marginTop: 4, overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 10.5, tableLayout: 'auto' }}>
                  <thead>
                    <tr style={{ color: '#88857f', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                      {COLS.map(c => (
                        <th key={c.key}
                            onClick={() => c.sortable && sortClick(c.key)}
                            style={{
                              textAlign: c.align, padding: '7px 6px',
                              cursor: c.sortable ? 'pointer' : 'default',
                              borderBottom: '1px solid #dedbd3',
                              userSelect: 'none',
                              color: creativeSortKey === c.key ? '#d84a17' : '#88857f',
                              whiteSpace: 'nowrap',
                            }}>
                          {c.label}{sortIcon(c.key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const exp = creativeExpanded[g.groupKey];
                      const isOpen = !!exp;
                      return (
                        <React.Fragment key={g.groupKey}>
                          <tr onClick={() => toggleCreativeRow(g.groupKey)}
                              style={{ borderTop: '1px solid #dedbd3', cursor: 'pointer', background: isOpen ? 'rgba(220,68,10,0.04)' : 'transparent' }}>
                            <td style={{ padding: '7px 6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {g.thumbnailUrl
                                  ? <img src={g.thumbnailUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#f4f1ea' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                                  : <div style={{ width: 32, height: 32, background: '#f4f1ea', borderRadius: 4, flexShrink: 0 }} />
                                }
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ color: '#171717', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{g.name || '(unnamed)'}</div>
                                  <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase' }}>{g.adCount} {g.adCount === 1 ? 'ad' : 'ads'}</div>
                                </div>
                              </div>
                            </td>
                            {COLS.slice(1).map(c => {
                              if (c.kind === 'status') {
                                const status = getCreativeStatus(g);
                                return (
                                  <td key={c.key} style={{ padding: '7px 6px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                                    <span style={{
                                      display: 'inline-block',
                                      padding: '4px 8px',
                                      borderRadius: 3,
                                      border: `1px solid ${status.border}`,
                                      background: status.bg,
                                      color: status.color,
                                      fontSize: 9,
                                      fontWeight: 700,
                                      letterSpacing: 1,
                                      textTransform: 'uppercase',
                                    }}>{status.label}</span>
                                  </td>
                                );
                              }
                              if (c.kind === 'nextTest') {
                                const ideas = getCreativeNextTests(g);
                                return (
                                  <td key={c.key} style={{ padding: '7px 6px', textAlign: 'left', minWidth: 190, maxWidth: 260 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                      {ideas.map((idea, idx) => (
                                        <span key={idx} style={{ color: idx === 0 ? '#171717' : '#77746f', fontSize: 9.5, lineHeight: 1.25 }}>
                                          {idea}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                );
                              }
                              if (c.kind === 'action') {
                                const isAnalyzing = analyzingGroup === g.groupKey;
                                const handler = (e) => {
                                  e.stopPropagation();
                                  if (isAnalyzing) return;
                                  if (g.isAnalyzed) openAnalysis(g.groupKey, g.name);
                                  else runAnalysis(g.groupKey, g.name);
                                };
                                return (
                                  <td key={c.key} style={{ padding: '7px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button onClick={handler} disabled={isAnalyzing} style={{
                                      padding: '4px 9px', fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase',
                                      fontFamily: 'inherit', borderRadius: 3, cursor: isAnalyzing ? 'wait' : 'pointer',
                                      background: g.isAnalyzed ? 'rgba(63,185,80,0.12)' : 'rgba(220,68,10,0.12)',
                                      border: `1px solid ${g.isAnalyzed ? 'rgba(63,185,80,0.5)' : 'rgba(220,68,10,0.5)'}`,
                                      color: g.isAnalyzed ? '#256b35' : '#d84a17',
                                    }}>
                                      {isAnalyzing ? '…' : (g.isAnalyzed ? 'View DNA' : 'Analyze')}
                                    </button>
                                  </td>
                                );
                              }
                              const v = g[c.key];
                              const bg = c.heat ? heatColor(c.key, v) : null;
                              return (
                                <td key={c.key} style={{
                                  padding: '7px 6px', textAlign: c.align,
                                  background: bg || 'transparent',
                                  color: '#343330', whiteSpace: 'nowrap',
                                  fontWeight: c.kind === 'money' || c.kind === 'x' ? 600 : 400,
                                }}>{fmt(c.kind, v)}</td>
                              );
                            })}
                          </tr>
                          {isOpen && (
                            <tr style={{ background: 'rgba(28,35,48,0.6)' }}>
                              <td colSpan={COLS.length} style={{ padding: '4px 10px 12px 56px' }}>
                                {exp.loading && <div style={{ fontSize: 10, color: '#88857f', padding: '8px 0' }}>Loading ads…</div>}
                                {!exp.loading && exp.ads && exp.ads.length === 0 && (
                                  <div style={{ fontSize: 10, color: '#88857f', padding: '8px 0' }}>No ads.</div>
                                )}
                                {!exp.loading && exp.ads && exp.ads.length > 0 && (
                                  <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ color: '#88857f', letterSpacing: 1, textTransform: 'uppercase', fontSize: 8 }}>
                                        <th style={{ textAlign: 'left',  padding: '4px 8px' }}>Ad name</th>
                                        <th style={{ textAlign: 'left',  padding: '4px 8px' }}>Status</th>
                                        <th style={{ textAlign: 'left',  padding: '4px 8px' }}>Created</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Spend</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Revenue</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Purchases</th>
                                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>ROAS</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {exp.ads.map(ad => {
                                        const spend = Number(ad.spend) || 0;
                                        const rev = Number(ad.purchase_value) || 0;
                                        const roas = spend > 0 ? rev / spend : 0;
                                        return (
                                          <tr key={ad.ad_id} style={{ borderTop: '1px solid #dedbd3' }}>
                                            <td style={{ padding: '5px 8px', color: '#343330', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.ad_name || ad.ad_id}</td>
                                            <td style={{ padding: '5px 8px', color: '#77746f' }}>{ad.status || '—'}</td>
                                            <td style={{ padding: '5px 8px', color: '#77746f' }}>{ad.created_time ? new Date(ad.created_time).toLocaleDateString() : '—'}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', color: '#77746f' }}>${spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', color: '#171717', fontWeight: 600 }}>${rev.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', color: '#77746f' }}>{Number(ad.purchases) || 0}</td>
                                            <td style={{ padding: '5px 8px', textAlign: 'right', color: roas >= 2 ? '#256b35' : roas >= 1 ? '#9a6a0a' : '#b42318', fontWeight: 700 }}>{roas.toFixed(2)}x</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1, marginTop: 12 }}>
              Window: last {creativeTable?.sinceDays || creativeWindowDays}d · {groups.length} creative {groups.length === 1 ? 'group' : 'groups'} · grouped by video / image hash
            </div>
          </div>
        );
      })()}


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
        const sourceTypeLabel = (type) => ({
          external_creator: 'Creator UGC',
          internal_employee: 'Internal',
          founder: 'Founder',
          tool_generated: 'Tool generated',
        })[type] || (type ? type.replaceAll('_', ' ') : 'Unattributed');
        const sourceName = (l) => l.creator || l.source_label || sourceTypeLabel(l.source_type);

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

        // Top sources (this month) split by format
        const sourceMap = {};
        for (const l of launches.filter(l => new Date(l.launched_at) >= startOfMonth)) {
          const c = sourceName(l) || 'unknown';
          if (!sourceMap[c]) sourceMap[c] = { total: 0, video: 0, static: 0, other: 0 };
          const t = classify(l);
          sourceMap[c].total++;
          sourceMap[c][t]++;
        }
        const topSources = Object.entries(sourceMap).sort((a,b) => b[1].total - a[1].total).slice(0, 5);

        const FMT_COLORS = { video: '#d84a17', static: '#2ea98f', other: '#77746f' };

        return (
          <>
            <div style={{ ...S.card, marginBottom: 20, borderColor: '#256b35' }}>
              <span style={S.label}>Creative Shipped (Launch Log)</span>

              {/* Period stats split by format */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginTop: 10 }}>
                {periods.map(({ label, data }) => (
                  <div key={label} style={{ borderLeft: '2px solid #dedbd3', paddingLeft: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#88857f', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#171717', lineHeight: 1, marginBottom: 8 }}>{data.total}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: FMT_COLORS.video, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Video</span>
                        <span style={{ color: data.video > 0 ? '#171717' : '#88857f', fontWeight: 700 }}>{data.video}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: FMT_COLORS.static, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Static</span>
                        <span style={{ color: data.static > 0 ? '#171717' : '#88857f', fontWeight: 700 }}>{data.static}</span>
                      </div>
                      {data.other > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: FMT_COLORS.other, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>Other</span>
                          <span style={{ color: '#171717', fontWeight: 700 }}>{data.other}</span>
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
                          <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{lbl}</span>
                          <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                              {['video', 'static', 'other'].map(t => {
                                if (!m[t]) return null;
                                const w = m.total > 0 ? (m[t] / m.total) * 100 : 0;
                                return <div key={t} title={`${t}: ${m[t]}`} style={{ width: `${w}%`, background: FMT_COLORS[t], height: '100%' }} />;
                              })}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: m.total > 0 ? '#171717' : '#88857f', width: 28, textAlign: 'right', fontWeight: m.total > 0 ? 700 : 400 }}>{m.total || '—'}</span>
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
                        <span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top sources */}
                <div>
                  <span style={S.label}>Top Sources (This Month)</span>
                  {topSources.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#88857f', marginTop: 8 }}>No launches yet this month.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {topSources.map(([c, d]) => {
                        const max = topSources[0][1].total;
                        const barPct = (d.total / max) * 100;
                        return (
                          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, color: '#343330', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                            <div style={{ flex: 1, height: 14, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ display: 'flex', height: '100%', width: `${barPct}%` }}>
                                {['video', 'static', 'other'].map(t => {
                                  if (!d[t]) return null;
                                  const w = d.total > 0 ? (d[t] / d.total) * 100 : 0;
                                  return <div key={t} title={`${t}: ${d[t]}`} style={{ width: `${w}%`, background: FMT_COLORS[t], height: '100%' }} />;
                                })}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: '#171717', width: 24, textAlign: 'right', fontWeight: 700 }}>{d.total}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 9, color: '#88857f', marginTop: 12, letterSpacing: 1 }}>
                Source: launch_history · {launches.length} ads logged · {allTime.video} video / {allTime.static} static{allTime.other > 0 ? ` / ${allTime.other} other` : ''}
              </div>
            </div>
          </>
        );
      })()}
      {view === 'creative' && launchesError && <div style={{ ...S.err, marginBottom: 20 }}>Launch log: {launchesError}</div>}
      {view === 'creative' && (!launches || launches.length === 0) && !launchesError && (
        <div style={{ ...S.card, color: '#77746f', fontSize: 12 }}>No launches logged yet. Push an ad via Launcher to populate this view.</div>
      )}

      {/* Creative DNA drawer — overlay on top of Creative Analytics */}
      {analysisDrawer && (
        <div onClick={() => setAnalysisDrawer(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 'min(620px, 100%)', height: '100%', overflowY: 'auto',
            background: '#fff', borderLeft: '1px solid #dedbd3', padding: '24px 28px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#88857f', textTransform: 'uppercase', marginBottom: 6 }}>Creative DNA</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#171717', maxWidth: 460 }}>{analysisDrawer.name || '(unnamed)'}</div>
              </div>
              <button onClick={() => setAnalysisDrawer(null)} style={{
                padding: '6px 10px', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
                background: 'none', border: '1px solid #dedbd3', color: '#77746f',
                fontFamily: 'inherit', borderRadius: 3, cursor: 'pointer',
              }}>Close</button>
            </div>

            {analysisDrawer.loading && (
              <div style={{ fontSize: 11, color: '#77746f', padding: '20px 0' }}>
                {analyzingGroup === analysisDrawer.groupKey
                  ? 'Fetching asset, transcribing, and analyzing… This takes 30–90 seconds.'
                  : 'Loading…'}
              </div>
            )}
            {analysisDrawer.error && (
              <div style={{ ...S.err, marginBottom: 12 }}>{analysisDrawer.error}</div>
            )}

            {!analysisDrawer.loading && !analysisDrawer.analysis && !analysisDrawer.error && (
              <div style={{ fontSize: 11, color: '#77746f', padding: '14px 0' }}>
                Not analyzed yet.{' '}
                <button onClick={() => runAnalysis(analysisDrawer.groupKey, analysisDrawer.name)} style={S.ghostBtn}>
                  Analyze now
                </button>
              </div>
            )}

            {analysisDrawer.analysis && (() => {
              const a = analysisDrawer.analysis;
              const Field = ({ label, value }) => value ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: '#88857f', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 12.5, color: '#171717', lineHeight: 1.55 }}>{value}</div>
                </div>
              ) : null;
              const Pill = ({ label, value }) => value ? (
                <span style={{
                  display: 'inline-block', padding: '4px 9px', fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase',
                  background: 'rgba(220,68,10,0.1)', border: '1px solid rgba(220,68,10,0.4)', color: '#d84a17',
                  borderRadius: 3, marginRight: 6, marginBottom: 6, fontWeight: 600,
                }}>{label}: {value}</span>
              ) : null;

              return (
                <>
                  <div style={{ marginBottom: 18 }}>
                    <Pill label="Hook" value={a.hook_type} />
                    <Pill label="Format" value={a.format} />
                    <Pill label="Angle" value={a.angle} />
                  </div>

                  <Field label="Hook (verbatim)" value={a.hook_text_verbatim ? `"${a.hook_text_verbatim}"` : null} />
                  <Field label="Why it worked" value={a.why_it_worked} />
                  <Field label="Visual summary" value={a.visual_summary} />
                  <Field label="Talent" value={a.talent_description} />

                  {a.transcript && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, letterSpacing: 2, color: '#88857f', textTransform: 'uppercase', marginBottom: 4 }}>Transcript</div>
                      <div style={{ fontSize: 11.5, color: '#343330', lineHeight: 1.55, padding: 12, background: '#f4f1ea', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                        {a.transcript}
                      </div>
                    </div>
                  )}

                  {!a.transcript && a.asset_kind === 'video' && (
                    <div style={{ marginBottom: 16, padding: 12, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.4)', borderRadius: 4, fontSize: 11, color: '#9a6a0a', lineHeight: 1.55 }}>
                      <strong>No transcript captured.</strong> Meta restricts the video source URL on most ad-hosted videos, so Whisper can't access the audio. Paste the script below and click Re-analyze with this script — Claude will use it instead.
                      {analysisDrawer.debug && (
                        <div style={{ marginTop: 10, fontSize: 10, color: '#343330', fontFamily: 'JetBrains Mono, monospace' }}>
                          <div>video_fields: {analysisDrawer.debug.videoFieldsResolved || '—'}</div>
                          <div>video_source: {analysisDrawer.debug.videoSourceUrl || '—'}</div>
                          <div>video_bytes: {analysisDrawer.debug.videoBytes || 0}</div>
                          <div>whisper: {analysisDrawer.debug.whisper || '—'}</div>
                          <div>image: {analysisDrawer.debug.image || '—'}</div>
                        </div>
                      )}
                      <ManualTranscriptPaste
                        groupKey={analysisDrawer.groupKey}
                        name={analysisDrawer.name}
                        analyzing={analyzingGroup === analysisDrawer.groupKey}
                        onSubmit={(text) => runAnalysis(analysisDrawer.groupKey, analysisDrawer.name, text)}
                      />
                    </div>
                  )}

                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #dedbd3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1 }}>
                      {a.generated_at ? `Analyzed ${new Date(a.generated_at).toLocaleString()}` : ''}
                    </div>
                    <button onClick={() => runAnalysis(analysisDrawer.groupKey, analysisDrawer.name)}
                            disabled={analyzingGroup === analysisDrawer.groupKey}
                            style={S.ghostBtn}>
                      {analyzingGroup === analysisDrawer.groupKey ? 'Re-analyzing…' : 'Re-analyze'}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {shopifyData?._meta?.customerScopeMissing && (
        <div style={{ ...S.err, marginBottom: 20, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Shopify token is missing the <code>read_customers</code> scope — new vs returning columns will be zero. Re-install at{' '}
          <a href="/api/shopify-install?shop=howl-campfires.myshopify.com" style={{ color: '#9a6a0a', textDecoration: 'underline' }}>
            /api/shopify-install
          </a>{' '}to fix.
        </div>
      )}
      {data?.monthlyInsightsError && (
        <div style={{ ...S.err, marginBottom: 20, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Meta monthly spend pull failed: {data.monthlyInsightsError}. CFO View ad-spend column will be blank until this is fixed.
        </div>
      )}
      {shopifyData?._meta?.inventoryScopeMissing && (
        <div style={{ ...S.err, marginBottom: 20, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          Shopify token is missing the <code>read_inventory</code> scope — COGS is using your Gross Margin assumption instead of per-unit cost. Re-install at{' '}
          <a href="/api/shopify-install?shop=howl-campfires.myshopify.com" style={{ color: '#9a6a0a', textDecoration: 'underline' }}>
            /api/shopify-install
          </a>{' '}to pull real costs.
        </div>
      )}
      {shopifyData?._meta?.errors?.length > 0 && (
        <div style={{ ...S.err, marginBottom: 20, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
          One or more Shopify stores failed to load and were skipped:
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {shopifyData._meta.errors.map((e, i) => (
              <li key={i}><b>{e.role}</b> ({e.store}) — {e.error}</li>
            ))}
          </ul>
        </div>
      )}
      {shopifyData && shopifyData?._meta?.dealerStorePresent && !shopifyData?._meta?.dealerConfigured && (
        <div style={{ ...S.err, marginBottom: 20, color: '#b42318', borderColor: 'rgba(248,81,73,0.5)', background: 'rgba(248,81,73,0.1)' }}>
          Dealer Shopify is disconnected: <code>SHOPIFY_DEALER_ACCESS_TOKEN</code> is empty in Vercel. Dealer revenue will only include previously imported CSV snapshots.{' '}
          <a
            href={`/api/shopify-install?shop=${encodeURIComponent(shopifyData._meta.dealerStore)}&role=dealer`}
            style={{ color: '#b42318', fontWeight: 700, textDecoration: 'underline' }}
          >
            Reconnect dealer Shopify
          </a>
        </div>
      )}

      {/* ── CFO / Head of Growth Section ──────────────────────────────────── */}
      {(view === 'cfo' || view === 'growth') && (() => {
        const monthlyInsights = data?.monthlyInsights || [];
        const shopifyMonths = shopifyData?.months || [];
        // Render whenever we have ANY data: live OR snapshots OR settings can fall back to defaults.
        const hasAnyData = monthlyInsights.length > 0 || shopifyMonths.length > 0 || (historySnapshots && historySnapshots.length > 0);
	        if (!hasAnyData) {
	          return (
	            <div style={{ ...S.card, color: '#77746f', fontSize: 12 }}>
	              {(loading || shopifyLoading) ? 'Loading…' : `No data yet. Click Load Meta or Load Shopify above to populate the ${view === 'growth' ? 'Growth Data' : 'CFO'} view.`}
	            </div>
	          );
	        }

        // Live data (current pull)
        const liveSpendByMonth = Object.fromEntries(monthlyInsights.map(m => [m.month, m]));
        const livePrimaryMonths = shopifyData?._stores
          ? (shopifyData._stores?.primary?.months || [])
          : shopifyMonths;
        const liveDealerMonths = shopifyData?._stores?.dealer?.months || [];
        const liveShopByMonth = Object.fromEntries(livePrimaryMonths.map(m => [m.month, m]));
        const liveDealerByMonth = Object.fromEntries(liveDealerMonths.map(m => [m.month, m]));

        // Snapshotted history from DB (overlay BEHIND live data — live always wins for current months)
        const snapshotShopByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify).map(r => [r.month, r.shopify]));
        const snapshotMetaByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, r.meta]));
        const snapshotGoogleByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.google).map(r => [r.month, r.google]));
        const snapshotKlaviyoByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.klaviyo).map(r => [r.month, r.klaviyo]));
        const dealerByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify_dealer).map(r => [r.month, r.shopify_dealer]));

        // Sum primary (snapshot or live) + dealer (CSV) per month.
        const sumShopify = (a, b) => {
          if (!a && !b) return null;
          a = a || {}; b = b || {};
          const keys = ['orders','shipping','sessions','newCustomers','returningCustomers','newRevenue','returningRevenue','cogs','costedRevenue','uncostedRevenue'];
          const out = {};
          for (const k of keys) out[k] = (a[k] || 0) + (b[k] || 0);
          out.netSales = sumNetRevenue(a, b);
          out.grossSales = sumGrossRevenue(a, b);
          out.shopifyNetSales = out.netSales;
          out.cvr = out.sessions > 0 ? (out.orders / out.sessions) * 100 : 0;
          const legacyCount = (source, key) => {
            if ((source.customerKeys || []).length > 0) return Number(source[`legacy${key}`] || 0);
            return Number(source[key.charAt(0).toLowerCase() + key.slice(1)] || 0)
              + Number(source[`legacy${key}`] || 0);
          };
          out.legacyNewCustomers = legacyCount(a, 'NewCustomers') + legacyCount(b, 'NewCustomers');
          out.legacyReturningCustomers = legacyCount(a, 'ReturningCustomers') + legacyCount(b, 'ReturningCustomers');
          for (const k of ['customerKeys', 'newCustomerKeys', 'returningCustomerKeys']) {
            out[k] = [...new Set([...(a[k] || []), ...(b[k] || [])])];
          }
          out.returningCustomerKeys = out.returningCustomerKeys.filter(
            key => !out.newCustomerKeys.includes(key),
          );
          const hasReportedNew = Number(a.newCustomers || 0) > 0 || Number(b.newCustomers || 0) > 0;
          const hasReportedReturning = Number(a.returningCustomers || 0) > 0 || Number(b.returningCustomers || 0) > 0;
          if (!hasReportedNew) out.newCustomers = out.newCustomerKeys.length + out.legacyNewCustomers;
          if (!hasReportedReturning) out.returningCustomers = out.returningCustomerKeys.length + out.legacyReturningCustomers;
          return out;
        };
        const allShopMonths = new Set([
          ...Object.keys(snapshotShopByMonth), ...Object.keys(liveShopByMonth),
          ...Object.keys(dealerByMonth), ...Object.keys(liveDealerByMonth),
        ]);
        const shopByMonth = {};
        const primaryByMonth = {};
        const dealerSourceByMonth = {};
        for (const mk of allShopMonths) {
          const primary = liveShopByMonth[mk] || snapshotShopByMonth[mk] || null;
          const dealer = liveDealerByMonth[mk] || dealerByMonth[mk] || null;
          primaryByMonth[mk] = primary;
          dealerSourceByMonth[mk] = dealer;
          shopByMonth[mk] = sumShopify(primary, dealer);
        }
        const spendByMonth = { ...snapshotMetaByMonth, ...liveSpendByMonth };

        // Settings-derived maps (declared before allMonthKeys to avoid TDZ).
        const s = settings || { grossMarginPct: 60, dealerWholesaleRetailPct: 70, paymentFeePct: 2.9, paymentFeeFixed: 0.30, shippingCostPerOrder: 8, fulfillmentCostPerOrder: 3, monthlyOpex: 50000, googleSpend: {}, opexByMonth: {}, dealerRevenueByMonth: {}, dealerOrdersByMonth: {}, offPlatformRevenueByMonth: {}, offPlatformOrdersByMonth: {} };
        const grossMarginPct = assumptionNumber(s.grossMarginPct, 60);
        const dealerWholesaleRetailPct = assumptionNumber(s.dealerWholesaleRetailPct, 70);
        const paymentFeePct = assumptionNumber(s.paymentFeePct, 2.9);
        const paymentFeeFixed = assumptionNumber(s.paymentFeeFixed, 0.30);
        const shippingCostPerOrder = assumptionNumber(s.shippingCostPerOrder, 8);
        const fulfillmentCostPerOrder = assumptionNumber(s.fulfillmentCostPerOrder, 3);
        const dealerGrossMarginPct = wholesaleGrossMarginPct(grossMarginPct, dealerWholesaleRetailPct);
        // Google spend pulled live from /api/google → monthly_metrics.google → snapshot.
        // Manual settings.googleSpend is ignored (column removed from assumptions UI).
        const googleByMonth = Object.fromEntries(
          Object.entries(snapshotGoogleByMonth).map(([k, v]) => [k, Number(v?.spend || 0)])
        );
        const opexByMonth = s.opexByMonth || {};
        const dealerRevenueByMonth = s.dealerRevenueByMonth || {};
        const dealerOrdersByMonth = s.dealerOrdersByMonth || {};
        const offPlatformRevenueByMonth = s.offPlatformRevenueByMonth || {};
        const offPlatformOrdersByMonth = s.offPlatformOrdersByMonth || {};
        const newCustomersAddByMonth = s.newCustomersAddByMonth || {};
        const returningCustomersAddByMonth = s.returningCustomersAddByMonth || {};

        // Build every available month first. The table start month controls display
        // only; the annual rollup always uses the full current calendar year.
        const startMonth = settings?.cfoStartMonth || '2026-01';
        const allMonthKeys = Array.from(new Set([
          ...Object.keys(shopByMonth),
          ...Object.keys(spendByMonth),
          ...Object.keys(dealerRevenueByMonth),
          ...Object.keys(dealerOrdersByMonth),
          ...Object.keys(offPlatformRevenueByMonth),
          ...Object.keys(offPlatformOrdersByMonth),
          ...Object.keys(googleByMonth),
          ...Object.keys(snapshotKlaviyoByMonth),
          ...Object.keys(opexByMonth),
        ])).filter(Boolean).sort();
        // Hard cap to keep tables readable; will grow as we accumulate snapshots forward
        const recent24 = allMonthKeys.slice(-24);
        const defaultOpex = assumptionNumber(s.monthlyOpex, 0);
        const opexFor = (mk) => {
          const v = opexByMonth[mk];
          return (v == null || v === '') ? defaultOpex : Number(v);
        };

        // Per-order variable margin used for first-order payback math.
        // Avg revenue per order × gross margin − fees − ship − pick.
        const variableMarginPerOrder = (rev, orders) => {
          if (!orders) return 0;
          const aov = rev / orders;
          return aov * (grossMarginPct / 100) - aov * (paymentFeePct / 100) - paymentFeeFixed - shippingCostPerOrder - fulfillmentCostPerOrder;
        };

        const nowD = new Date();
        const currentMonthKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
        const dayOfMonth = nowD.getDate();
        const daysInCurrentMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
        const paceFactor = daysInCurrentMonth / dayOfMonth;

        const allRows = recent24.map(mk => {
          const sh = shopByMonth[mk] || { netSales: 0, orders: 0, sessions: 0, cvr: 0, newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, cogs: 0, costedRevenue: 0, uncostedRevenue: 0 };
          const dtc = primaryByMonth[mk] || {};
          const dealer = dealerSourceByMonth[mk] || {};
          const meta = spendByMonth[mk] || { spend: 0, purchases: 0 };
          const klaviyo = snapshotKlaviyoByMonth[mk] || {};
          const hasDealerRevenueOverride = Object.prototype.hasOwnProperty.call(dealerRevenueByMonth, mk)
            && dealerRevenueByMonth[mk] !== '';
          const hasDealerOrdersOverride = Object.prototype.hasOwnProperty.call(dealerOrdersByMonth, mk)
            && dealerOrdersByMonth[mk] !== '';
          const dtcNetRevenue = netRevenueFor(dtc);
          const dtcRevenue = grossRevenueFor(dtc);
          const dtcAcquisitionRevenue = acquisitionRevenueFor(dtc, dtcNetRevenue);
          const dealerRevenue = hasDealerRevenueOverride
            ? Number(dealerRevenueByMonth[mk] || 0)
            : netRevenueFor(dealer);
          const dealerAcquisitionRevenue = acquisitionRevenueFor(dealer, dealerRevenue);
          const offPlatformRevenue = Number(offPlatformRevenueByMonth[mk] || 0);
          const dtcOrders = Number(dtc.orders || 0);
          const dealerOrders = hasDealerOrdersOverride
            ? Number(dealerOrdersByMonth[mk] || 0)
            : Number(dealer.orders || 0);
          const offPlatformOrders = Number(offPlatformOrdersByMonth[mk] || 0);
          const addNewCust = Number(newCustomersAddByMonth[mk] || 0);
          const addReturningCust = Number(returningCustomersAddByMonth[mk] || 0);
          const revenue = dtcRevenue + dealerRevenue + offPlatformRevenue;
          const netRevenue = dtcNetRevenue + dealerRevenue + offPlatformRevenue;
          const orders = dtcOrders + dealerOrders + offPlatformOrders;
          const shopifyOrders = Number(sh.orders || 0);
          const sessions = Number(sh.sessions || 0);
          const cvr = sessions > 0 ? shopifyOrders / sessions : null;
          // Hybrid COGS by channel: actual unitCost × qty where available,
          // with fallback margin assumptions per revenue source.
          const dealerCogsSource = hasDealerRevenueOverride ? {} : dealer;
          const dtcCogs = estimatedCogsFor(dtc, dtcNetRevenue, grossMarginPct);
          const dealerCogs = estimatedCogsFor(dealerCogsSource, dealerRevenue, dealerGrossMarginPct);
          const offPlatformCogs = offPlatformRevenue * (1 - (grossMarginPct / 100));
          const cogs = dtcCogs + dealerCogs + offPlatformCogs;
          const costedRevenue = Number(dtc.costedRevenue || 0) + Number(dealerCogsSource.costedRevenue || 0);
          const cogsActualPct = netRevenue > 0 ? costedRevenue / netRevenue : 0; // 1.0 = 100% real, 0 = all fallback
          const paymentFees = netRevenue * (paymentFeePct / 100) + orders * paymentFeeFixed;
          const shipCost = orders * shippingCostPerOrder;
          const fulfill = orders * fulfillmentCostPerOrder;
          const metaSpend = meta.spend || 0;
          const googleSpend = Number(googleByMonth[mk] || 0);
          const adSpend = metaSpend + googleSpend;
          // Platform-reported revenue (pixel-attributed). Used for channel-level
          // ROAS — distinct from MER which uses true Shopify revenue.
          const metaRoasReported = meta.roas != null ? Number(meta.roas) : null;
          const metaPurchaseValue = metaRoasReported != null ? metaSpend * metaRoasReported : 0;
          const googleConvValue = Number(snapshotGoogleByMonth[mk]?.conversionValue || 0);
          const googleRoasReported = googleSpend > 0 ? googleConvValue / googleSpend : null;
          const cm3 = netRevenue - cogs - paymentFees - shipCost - fulfill - adSpend;
          // NCAC = total ad spend (Meta + Google) ÷ new customers.
          const classifiedNewRevenue = dtcAcquisitionRevenue + dealerAcquisitionRevenue;
          const classifiedNewCustomers = Number(sh.newCustomers || 0) + addNewCust;
          const totalNewCust = classifiedNewCustomers;
          const ncac = totalNewCust > 0 ? adSpend / totalNewCust : null;
          const blendedNcac = ncac;
          const blendedRoas = adSpend > 0 ? revenue / adSpend : null;
          const newRoas = adSpend > 0 ? classifiedNewRevenue / adSpend : null;
          // First-order payback: variable margin generated by new-customer first orders ÷ NCAC.
          // <100% = new customer doesn't pay back on first order (need repeats).
          const dtcNewMargin = dtcAcquisitionRevenue * (grossMarginPct / 100);
          const dealerNewMargin = dealerAcquisitionRevenue * (dealerGrossMarginPct / 100);
          const newOrderMargin = (dtcNewMargin + dealerNewMargin)
                                - classifiedNewRevenue * (paymentFeePct / 100)
                                - classifiedNewCustomers * (paymentFeeFixed + shippingCostPerOrder + fulfillmentCostPerOrder);
          const firstOrderPayback = adSpend > 0 ? newOrderMargin / adSpend : null;
          const opexThis = opexFor(mk);
          const opexCoverage = opexThis > 0 ? cm3 / opexThis : null;
          const klaviyoRevenue = Number(klaviyo.revenue || 0);
          const klaviyoOrders = Number(klaviyo.orders || 0);
          const klaviyoRevenuePct = netRevenue > 0 ? klaviyoRevenue / netRevenue : null;
          const emailSends = Number(klaviyo.emailSends || 0);
          const emailOpens = Number(klaviyo.emailOpens || 0);
          const emailClicks = Number(klaviyo.emailClicks || 0);
          const emailOpenRate = emailSends > 0 ? emailOpens / emailSends : null;
          const emailClickRate = emailSends > 0 ? emailClicks / emailSends : null;
          const isCurrent = mk === currentMonthKey;
          const projectedCm3 = isCurrent ? cm3 * paceFactor : cm3;
          const netProfit = cm3 - opexThis;
          const projectedNetProfit = projectedCm3 - opexThis;
          const newCustomers = classifiedNewCustomers;
          const returningCustomers = Number(sh.returningCustomers || 0) + addReturningCust;
          return {
            month: mk, revenue, netRevenue, dtcRevenue, dtcNetRevenue, dealerRevenue, offPlatformRevenue,
            dtcGrossRevenue: dtcRevenue,
            orders, shopifyOrders, sessions, cvr, dtcOrders, dealerOrders, offPlatformOrders, newCustomers, returningCustomers,
            customers: dtc.customers || 0,
            customerKeys: dtc.customerKeys || [], newCustomerKeys: dtc.newCustomerKeys || [],
            returningCustomerKeys: dtc.returningCustomerKeys || [],
            legacyNewCustomers: dtc.legacyNewCustomers || 0,
            legacyReturningCustomers: dtc.legacyReturningCustomers || 0,
            manualNewCustomers: addNewCust, manualReturningCustomers: addReturningCust,
            newRevenue: classifiedNewRevenue, returningRevenue: sh.returningRevenue || 0,
            metaSpend, googleSpend, adSpend, metaPurchaseValue, googleConvValue,
            metaRoasReported, googleRoasReported, cogs, cogsActualPct, paymentFees,
            shipCost, fulfill, cm3, ncac, blendedNcac, blendedRoas, newRoas,
            firstOrderPayback, opex: opexThis, opexCoverage, netProfit, projectedNetProfit, isCurrent,
            klaviyoRevenue, klaviyoOrders, klaviyoFlowRevenue: Number(klaviyo.flowRevenue || 0),
            klaviyoCampaignRevenue: Number(klaviyo.campaignRevenue || 0), klaviyoRevenuePct,
            emailSends, emailOpens, emailClicks, emailOpenRate, emailClickRate,
            emailUnsubscribes: Number(klaviyo.unsubscribes || 0),
          };
        });
        const rows = allRows.filter(r => r.month >= startMonth);
        const recent13 = rows;
        const summaryYear = String(nowD.getFullYear());
        const rollupRows = allRows.filter(r => r.month.startsWith(`${summaryYear}-`) && r.month <= currentMonthKey);

        // Current-month pace projection (last row if it's the current month)
        const currentRow = rows.find(r => r.isCurrent);
        const pace = currentRow ? {
          revenue: currentRow.revenue * paceFactor,
          adSpend: currentRow.adSpend * paceFactor,
          newCustomers: Math.round(currentRow.newCustomers * paceFactor),
          returningCustomers: Math.round(currentRow.returningCustomers * paceFactor),
          cm3: currentRow.cm3 * paceFactor,
          netProfit: currentRow.cm3 * paceFactor - currentRow.opex,
          opex: currentRow.opex,
          opexCoverage: currentRow.opex > 0 ? (currentRow.cm3 * paceFactor) / currentRow.opex : null,
          ncac: currentRow.newCustomers > 0 ? currentRow.adSpend / currentRow.newCustomers : null,
        } : null;

        const ltm = rollupRows.reduce((a, r) => ({
          revenue: a.revenue + r.revenue,
          netRevenue: a.netRevenue + r.netRevenue,
          dtcRevenue: a.dtcRevenue + r.dtcRevenue,
          dtcNetRevenue: a.dtcNetRevenue + r.dtcNetRevenue,
          dtcGrossRevenue: a.dtcGrossRevenue + r.dtcGrossRevenue,
          dealerRevenue: a.dealerRevenue + r.dealerRevenue,
          offPlatformRevenue: a.offPlatformRevenue + r.offPlatformRevenue,
          orders: a.orders + r.orders,
          shopifyOrders: a.shopifyOrders + r.shopifyOrders,
          sessions: a.sessions + r.sessions,
          newCustomers: a.newCustomers + r.newCustomers,
          returningCustomers: a.returningCustomers + r.returningCustomers,
          metaSpend: a.metaSpend + r.metaSpend,
          googleSpend: a.googleSpend + r.googleSpend,
          adSpend: a.adSpend + r.adSpend,
          metaPurchaseValue: a.metaPurchaseValue + r.metaPurchaseValue,
          googleConvValue: a.googleConvValue + r.googleConvValue,
          cm3: a.cm3 + r.cm3,
          netProfit: a.netProfit + r.netProfit,
          projectedNetProfit: a.projectedNetProfit + r.projectedNetProfit,
          newRevenue: a.newRevenue + r.newRevenue,
          opex: a.opex + r.opex,
          klaviyoRevenue: a.klaviyoRevenue + r.klaviyoRevenue,
          klaviyoOrders: a.klaviyoOrders + r.klaviyoOrders,
          klaviyoFlowRevenue: a.klaviyoFlowRevenue + r.klaviyoFlowRevenue,
          klaviyoCampaignRevenue: a.klaviyoCampaignRevenue + r.klaviyoCampaignRevenue,
          emailSends: a.emailSends + r.emailSends,
          emailOpens: a.emailOpens + r.emailOpens,
          emailClicks: a.emailClicks + r.emailClicks,
          emailUnsubscribes: a.emailUnsubscribes + r.emailUnsubscribes,
        }), { revenue: 0, netRevenue: 0, dtcRevenue: 0, dtcNetRevenue: 0, dtcGrossRevenue: 0, dealerRevenue: 0, offPlatformRevenue: 0, orders: 0, shopifyOrders: 0, sessions: 0, newCustomers: 0, returningCustomers: 0, metaSpend: 0, googleSpend: 0, adSpend: 0, metaPurchaseValue: 0, googleConvValue: 0, cm3: 0, netProfit: 0, projectedNetProfit: 0, newRevenue: 0, opex: 0, klaviyoRevenue: 0, klaviyoOrders: 0, klaviyoFlowRevenue: 0, klaviyoCampaignRevenue: 0, emailSends: 0, emailOpens: 0, emailClicks: 0, emailUnsubscribes: 0 });
        const priorNetProfit = rollupRows
          .filter(r => !r.isCurrent)
          .reduce((sum, r) => sum + r.netProfit, 0);
        const currentNetProfit = currentRow?.month?.startsWith(`${summaryYear}-`)
          ? currentRow.netProfit
          : 0;

        const livePrimaryYtd = shopifyData?._stores?.primary?.ytd;
        const snapPrimaryYtd = [...Object.values(snapshotShopByMonth)]
          .reverse()
          .find(month => month?.reportYtd)?.reportYtd;
        const authoritativeYtd = livePrimaryYtd?.year === Number(summaryYear)
          ? livePrimaryYtd
          : snapPrimaryYtd?.year === Number(summaryYear) ? snapPrimaryYtd : null;
        const uniqueCustomerKeys = new Set(rollupRows.flatMap(r => r.customerKeys || []));
        const uniqueNewCustomerKeys = new Set(rollupRows.flatMap(r => r.newCustomerKeys || []));
        const legacyNewCustomers = rollupRows.reduce((sum, r) => sum + r.legacyNewCustomers, 0);
        const legacyReturningCustomers = rollupRows.reduce((sum, r) => sum + r.legacyReturningCustomers, 0);
        const manualNewCustomers = rollupRows.reduce((sum, r) => sum + r.manualNewCustomers, 0);
        const manualReturningCustomers = rollupRows.reduce((sum, r) => sum + r.manualReturningCustomers, 0);
        const hasLegacyCustomerMonths = legacyNewCustomers > 0 || legacyReturningCustomers > 0;
        const totalCustomers = authoritativeYtd
          ? authoritativeYtd.customers + manualNewCustomers + manualReturningCustomers
          : uniqueCustomerKeys.size + legacyNewCustomers + legacyReturningCustomers
            + manualNewCustomers + manualReturningCustomers;
        ltm.newCustomers = authoritativeYtd
          ? authoritativeYtd.newCustomers + manualNewCustomers
          : uniqueNewCustomerKeys.size + legacyNewCustomers + manualNewCustomers;
        ltm.returningCustomers = authoritativeYtd
          ? authoritativeYtd.returningCustomers + manualReturningCustomers
          : Math.max(totalCustomers - ltm.newCustomers, 0);

        const ltmNcac = ltm.newCustomers > 0 ? ltm.adSpend / ltm.newCustomers : null;
        const ltmBlendedNcac = ltmNcac;
        const ltmRoas = ltm.adSpend > 0 ? ltm.revenue / ltm.adSpend : null;
        // Blended CPA = ad spend ÷ all orders (new + returning, since blended)
        const ltmCpa = ltm.orders > 0 ? ltm.adSpend / ltm.orders : null;
        // MER = total revenue ÷ total ad spend (mathematically equal to blended ROAS, surfaced separately for finance convention)
        const ltmMer = ltmRoas;
        // aMER (acquisition MER) = classified new-customer revenue ÷ total ad spend.
        // Includes connected Shopify stores; off-platform revenue is excluded unless
        // it can be classified into new/returning cohorts.
        const ltmAmer = ltm.adSpend > 0 ? ltm.newRevenue / ltm.adSpend : null;
        // Platform-reported ROAS by channel (pixel attribution, not Shopify-verified).
        const ltmMetaRoas   = ltm.metaSpend   > 0 ? ltm.metaPurchaseValue / ltm.metaSpend   : null;
        const ltmGoogleRoas = ltm.googleSpend > 0 ? ltm.googleConvValue   / ltm.googleSpend : null;
        const ltmRepeatRate = (ltm.newCustomers + ltm.returningCustomers) > 0
          ? ltm.returningCustomers / (ltm.newCustomers + ltm.returningCustomers) : 0;
        const ltmCvr = ltm.sessions > 0 ? ltm.shopifyOrders / ltm.sessions : null;
        const ltmKlaviyoRevenuePct = ltm.netRevenue > 0 ? ltm.klaviyoRevenue / ltm.netRevenue : null;
        const ltmEmailOpenRate = ltm.emailSends > 0 ? ltm.emailOpens / ltm.emailSends : null;
        const ltmEmailClickRate = ltm.emailSends > 0 ? ltm.emailClicks / ltm.emailSends : null;
        const ltmCmMargin = ltm.netRevenue > 0 ? ltm.cm3 / ltm.netRevenue : 0;
        const ltmOpexCoverage = ltm.opex > 0 ? ltm.cm3 / ltm.opex : null;
        // For UI: show the default opex if no per-month overrides, else "$X avg"
        const opex = ltm.opex / Math.max(rollupRows.length, 1);

        const fmtPct = (n) => (n == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%';
        const fmt$ = (n) => (n == null || isNaN(n)) ? '—' : '$' + Math.round(n).toLocaleString();

        const maxCustomers = Math.max(...rows.map(r => r.newCustomers + r.returningCustomers), 1);
        const ncacRange = rows.filter(r => r.ncac != null).map(r => r.ncac);
        const maxNcac = Math.max(...ncacRange, 1);
        const cmRange = rows.map(r => r.cm3);
        const cmMax = Math.max(...cmRange, 1);
        const cmMin = Math.min(...cmRange, 0);
        const cmAbsMax = Math.max(Math.abs(cmMax), Math.abs(cmMin), 1);
        const netProfitRange = rows.map(r => r.projectedNetProfit);
        const netProfitMax = Math.max(...netProfitRange, 1);
        const netProfitMin = Math.min(...netProfitRange, 0);
        const netProfitAbsMax = Math.max(Math.abs(netProfitMax), Math.abs(netProfitMin), 1);

        const fmtMo = (mk) => {
          if (!mk) return '—';
          const [y, m] = mk.split('-');
          return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        };

        const dataReady = (data || shopifyData || (historySnapshots && historySnapshots.length > 0));

        if (view === 'growth') {
          const maxSpend = Math.max(...rows.map(r => r.adSpend), 1);
          const mixMetaPct = ltm.adSpend > 0 ? ltm.metaSpend / ltm.adSpend : 0;
          const mixGooglePct = ltm.adSpend > 0 ? ltm.googleSpend / ltm.adSpend : 0;
          const metaPurchasesByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, Number(r.meta.purchases || 0)]));
          const googleConvByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.google).map(r => [r.month, Number(r.google.conversions || 0)]));
          const ltmMetaPurchases = rollupRows.reduce((a, r) => a + (metaPurchasesByMonth[r.month] || 0), 0);
          const ltmGoogleConv = rollupRows.reduce((a, r) => a + (googleConvByMonth[r.month] || 0), 0);
          const ltmMetaCpa = ltmMetaPurchases > 0 ? ltm.metaSpend / ltmMetaPurchases : null;
          const ltmGoogleCpa = ltmGoogleConv > 0 ? ltm.googleSpend / ltmGoogleConv : null;
          const maxKlaviyoRevenue = Math.max(...rows.map(r => r.klaviyoRevenue || 0), 1);
          const klaviyoTopDrivers = [
            ...(klaviyoData?.topFlows || []).map(item => ({ ...item, kind: 'Flow', color: '#2ea98f' })),
            ...(klaviyoData?.topMessages || []).map(item => ({ ...item, kind: 'Message', color: '#d84a17' })),
          ].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
          const healthyColor = '#256b35';
          const warningColor = '#9a6a0a';
          const dangerColor = '#b42318';
          const latestRevenueMonth = [...rows].reverse().find(r => r.revenue > 0 || r.adSpend > 0 || r.klaviyoRevenue > 0);
          const previousRevenueMonth = latestRevenueMonth
            ? [...rows].reverse().find(r => r.month < latestRevenueMonth.month && (r.revenue > 0 || r.adSpend > 0 || r.klaviyoRevenue > 0))
            : null;
          const revenueMom = latestRevenueMonth && previousRevenueMonth?.revenue > 0
            ? (latestRevenueMonth.revenue - previousRevenueMonth.revenue) / previousRevenueMonth.revenue
            : null;
          const cvrMom = latestRevenueMonth && previousRevenueMonth?.cvr
            ? latestRevenueMonth.cvr - previousRevenueMonth.cvr
            : null;
          const ratioStatus = (value, good, warn) => {
            if (value == null || Number.isNaN(value)) return { status: 'Missing', color: warningColor };
            if (good(value)) return { status: 'Healthy', color: healthyColor };
            if (warn(value)) return { status: 'Watch', color: warningColor };
            return { status: 'Off track', color: dangerColor };
          };
          const guardrails = [
            { label: 'MER', value: ltmMer == null ? '—' : ltmMer.toFixed(2) + 'x', ...ratioStatus(ltmMer, v => v >= 2.0, v => v >= 1.4), note: 'gross revenue / ad spend' },
            { label: 'aMER', value: ltmAmer == null ? '—' : ltmAmer.toFixed(2) + 'x', ...ratioStatus(ltmAmer, v => v >= 1.0, v => v >= 0.7), note: 'new-customer revenue / ad spend' },
            { label: 'NCAC', value: ltmNcac == null ? '—' : '$' + ltmNcac.toFixed(0), ...ratioStatus(ltmNcac, v => v <= 120, v => v <= 180), note: 'ad spend / new customer' },
            { label: 'CVR', value: ltmCvr == null ? '—' : fmtPct(ltmCvr), ...ratioStatus(ltmCvr, v => v >= 0.015, v => v >= 0.01), note: 'Shopify orders / Shopify sessions' },
            { label: 'CM3 Margin', value: fmtPct(ltmCmMargin), ...ratioStatus(ltmCmMargin, v => v >= 0.15, v => v >= 0.05), note: 'after COGS, fees, fulfillment, media' },
            { label: 'Klaviyo Rev Share', value: ltmKlaviyoRevenuePct == null ? '—' : fmtPct(ltmKlaviyoRevenuePct), ...ratioStatus(ltmKlaviyoRevenuePct, v => v >= 0.2, v => v >= 0.1), note: 'Klaviyo revenue / net revenue' },
          ];
          const dataHealthItems = [
            { label: 'Shopify CVR', status: ltm.sessions > 0 ? 'Live' : 'Missing', color: ltm.sessions > 0 ? healthyColor : warningColor, note: `${ltm.sessions.toLocaleString()} sessions` },
            { label: 'Meta Spend', status: ltm.metaSpend > 0 ? 'Live' : 'Missing', color: ltm.metaSpend > 0 ? healthyColor : warningColor, note: fmt$(ltm.metaSpend) },
            { label: 'Google Spend', status: ltm.googleSpend > 0 ? 'Live' : 'Missing', color: ltm.googleSpend > 0 ? healthyColor : warningColor, note: fmt$(ltm.googleSpend) },
            { label: 'Klaviyo', status: Object.keys(snapshotKlaviyoByMonth).length > 0 ? 'Live' : 'Missing', color: Object.keys(snapshotKlaviyoByMonth).length > 0 ? healthyColor : warningColor, note: Object.keys(snapshotKlaviyoByMonth).length > 0 ? fmt$(ltm.klaviyoRevenue) : 'add API key' },
            { label: 'AI Analysis', status: 'Ready', color: healthyColor, note: 'Anthropic -> OpenAI fallback' },
          ];
          const runPerformanceAnalysis = async () => {
            setPerformanceChatLoading(true);
            setPerformanceChatError('');
            setPerformanceAnswer('');
            try {
              const response = await fetch('/api/performance-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  question: performanceQuestion,
                  rows,
                  summary: {
                    year: summaryYear,
                    revenue: ltm.revenue,
                    netRevenue: ltm.netRevenue,
                    adSpend: ltm.adSpend,
                    mer: ltmMer,
                    amer: ltmAmer,
                    ncac: ltmNcac,
                    cvr: ltmCvr,
                    cm3: ltm.cm3,
                    netProfit: ltm.netProfit,
                    klaviyoRevenue: ltm.klaviyoRevenue,
                    klaviyoRevenuePct: ltmKlaviyoRevenuePct,
                    emailOpenRate: ltmEmailOpenRate,
                    emailClickRate: ltmEmailClickRate,
                  },
                  dataHealth: {
                    shopifyIsStale,
                    metaIsStale,
                    klaviyoIsStale,
                    klaviyoConfigured: klaviyoData?.configured !== false,
                    hasKlaviyoSnapshots: Object.keys(snapshotKlaviyoByMonth).length > 0,
                  },
                }),
              });
              const payload = await response.json();
              if (!response.ok || payload.error) throw new Error(payload.error || 'Analysis failed');
              setPerformanceAnswer(payload.answer || '');
            } catch (err) {
              setPerformanceChatError(err.message);
            } finally {
              setPerformanceChatLoading(false);
            }
          };
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, marginTop: 28 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Growth Data</div>
                  <div className="display-md" style={{ color: '#171717' }}>Performance Control Room</div>
                  <div className="display-italic" style={{ fontSize: 12, color: '#77746f', marginTop: 4 }}>
                    Ratio guardrails, source health, channel mix, and lifecycle revenue.
                  </div>
                </div>
              </div>
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <span style={S.label}>Data Health + Ratio Guardrails</span>
                  <span style={{ fontSize: 10, color: '#77746f', letterSpacing: 1 }}>
                    {latestRevenueMonth ? `${fmtMo(latestRevenueMonth.month)} latest · Rev ${fmt$(latestRevenueMonth.revenue)}${revenueMom == null ? '' : ` · MoM ${revenueMom >= 0 ? '+' : ''}${(revenueMom * 100).toFixed(1)}%`}` : 'Waiting on source data'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 16 }}>
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {guardrails.map(item => (
                        <div key={item.label} style={{ padding: 11, background: '#fff', border: '1px solid #dedbd3', borderRadius: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase', color: '#77746f', fontWeight: 700 }}>{item.label}</span>
                            <span style={{ fontSize: 9, color: item.color, fontWeight: 800, letterSpacing: 1 }}>{item.label === 'Klaviyo Rev Share' && Object.keys(snapshotKlaviyoByMonth).length === 0 ? 'Setup' : item.status}</span>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
                          <div style={{ marginTop: 5, fontSize: 9, color: '#88857f', lineHeight: 1.35 }}>{item.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {dataHealthItems.map(item => (
                        <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '8px 10px', background: '#fff', border: '1px solid #dedbd3', borderRadius: 6 }}>
                          <div>
                            <div style={{ fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: '#77746f', fontWeight: 700 }}>{item.label}</div>
                            <div style={{ marginTop: 3, fontSize: 10, color: '#88857f' }}>{item.note}</div>
                          </div>
                          <div style={{ fontSize: 10, color: item.color, fontWeight: 800, letterSpacing: 1 }}>{item.status}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #dedbd3', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 9, color: '#77746f', letterSpacing: 1 }}>
                  <span>YTD CVR {ltmCvr == null ? '—' : fmtPct(ltmCvr)}</span>
                  <span>Latest CVR {latestRevenueMonth?.cvr == null ? '—' : fmtPct(latestRevenueMonth.cvr)}</span>
                  <span>CVR MoM {cvrMom == null ? '—' : `${cvrMom >= 0 ? '+' : ''}${(cvrMom * 100).toFixed(2)} pts`}</span>
                  <span>Net Profit {fmt$(ltm.netProfit)}</span>
                </div>
              </div>
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <span style={S.label}>Media Mix — Meta vs Google</span>
                  <span style={{ fontSize: 10, color: '#77746f', letterSpacing: 1 }}>
                    {summaryYear} YTD: <span style={{ color: '#1877f2', fontWeight: 700 }}>{fmtPct(mixMetaPct)} Meta</span>
                    {' · '}
                    <span style={{ color: '#fbbc05', fontWeight: 700 }}>{fmtPct(mixGooglePct)} Google</span>
                    {' · '}
                    <span style={{ color: '#343330' }}>{fmt$(ltm.adSpend)} total</span>
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #dedbd3' }}>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#1877f2', marginBottom: 4, fontWeight: 600 }}>Meta CPA</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmMetaCpa == null ? '—' : '$' + ltmMetaCpa.toFixed(0)}</div>
                    <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltmMetaPurchases.toLocaleString()} purchases</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#fbbc05', marginBottom: 4, fontWeight: 600 }}>Google CPA</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmGoogleCpa == null ? '—' : '$' + ltmGoogleCpa.toFixed(0)}</div>
                    <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltmGoogleConv.toLocaleString(undefined, { maximumFractionDigits: 1 })} conversions</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4, fontWeight: 600 }}>Blended CPA</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmCpa == null ? '—' : '$' + ltmCpa.toFixed(0)}</div>
                    <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltm.orders.toLocaleString()} orders (Shopify)</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4, fontWeight: 600 }}>Channel CPA Delta</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: (ltmGoogleCpa != null && ltmMetaCpa != null) ? (ltmGoogleCpa < ltmMetaCpa ? '#256b35' : '#b42318') : '#171717', lineHeight: 1 }}>
                      {(ltmGoogleCpa != null && ltmMetaCpa != null) ? (ltmGoogleCpa < ltmMetaCpa ? 'Google ' : 'Meta ') + 'wins' : '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>
                      {(ltmGoogleCpa != null && ltmMetaCpa != null) ? '$' + Math.abs(ltmGoogleCpa - ltmMetaCpa).toFixed(0) + ' difference' : 'need both channels'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {rows.map(r => {
                    const barPct = (r.adSpend / maxSpend) * 100;
                    const metaPct = r.adSpend > 0 ? (r.metaSpend / r.adSpend) * 100 : 0;
                    return (
                      <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                        <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                            <div title={`Meta: ${fmt$(r.metaSpend)}`} style={{ width: `${metaPct}%`, background: '#1877f2', height: '100%' }} />
                            <div title={`Google: ${fmt$(r.googleSpend)}`} style={{ width: `${100 - metaPct}%`, background: '#fbbc05', height: '100%' }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: '#171717', width: 70, textAlign: 'right', fontWeight: 700 }}>{fmt$(r.adSpend)}</span>
                        <div style={{ display: 'flex', gap: 6, width: 140, justifyContent: 'flex-end', fontSize: 9 }}>
                          {r.metaSpend > 0 && <span style={{ color: '#1877f2', letterSpacing: 1 }}>{fmt$(r.metaSpend)}M</span>}
                          {r.googleSpend > 0 && <span style={{ color: '#fbbc05', letterSpacing: 1 }}>{fmt$(r.googleSpend)}G</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#1877f2' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>Meta</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#fbbc05' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>Google</span></div>
                </div>
              </div>
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <span style={S.label}>Klaviyo — Email/SMS Revenue Contribution</span>
                  <span style={{ fontSize: 10, color: '#77746f', letterSpacing: 1 }}>
                    {ltmKlaviyoRevenuePct == null ? 'No revenue snapshot' : `${summaryYear} YTD: ${fmt$(ltm.klaviyoRevenue)} · ${fmtPct(ltmKlaviyoRevenuePct)} of net revenue`}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #dedbd3' }}>
                  {[
                    { label: 'Attributed Revenue', value: fmt$(ltm.klaviyoRevenue), sub: `${ltm.klaviyoOrders.toLocaleString()} orders` },
                    { label: '% of Net Revenue', value: ltmKlaviyoRevenuePct == null ? '—' : fmtPct(ltmKlaviyoRevenuePct), color: ltmKlaviyoRevenuePct != null && ltmKlaviyoRevenuePct >= 0.25 ? '#256b35' : '#171717' },
                    { label: 'Flow Revenue', value: fmt$(ltm.klaviyoFlowRevenue), sub: ltm.klaviyoRevenue > 0 ? fmtPct(ltm.klaviyoFlowRevenue / ltm.klaviyoRevenue) + ' of Klaviyo' : '' },
                    { label: 'Open Rate', value: ltmEmailOpenRate == null ? '—' : fmtPct(ltmEmailOpenRate), sub: `${ltm.emailOpens.toLocaleString()} opens` },
                    { label: 'Click Rate', value: ltmEmailClickRate == null ? '—' : fmtPct(ltmEmailClickRate), sub: `${ltm.emailClicks.toLocaleString()} clicks` },
                  ].map(({ label, value, sub, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4, fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: color || '#171717', lineHeight: 1 }}>{value}</div>
                      {sub && <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{sub}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {rows.map(r => {
                    const barPct = ((r.klaviyoRevenue || 0) / maxKlaviyoRevenue) * 100;
                    const flowPct = r.klaviyoRevenue > 0 ? (r.klaviyoFlowRevenue / r.klaviyoRevenue) * 100 : 0;
                    const campaignPct = r.klaviyoRevenue > 0 ? Math.max(0, 100 - flowPct) : 0;
                    return (
                      <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                        <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                            <div title={`Flow: ${fmt$(r.klaviyoFlowRevenue)}`} style={{ width: `${flowPct}%`, background: '#2ea98f', height: '100%' }} />
                            <div title={`Campaign/message: ${fmt$(r.klaviyoCampaignRevenue)}`} style={{ width: `${campaignPct}%`, background: '#d84a17', height: '100%' }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: '#171717', width: 70, textAlign: 'right', fontWeight: 700 }}>{fmt$(r.klaviyoRevenue)}</span>
                        <span style={{ fontSize: 9, color: '#88857f', width: 92, textAlign: 'right', letterSpacing: 1 }}>{r.klaviyoRevenuePct == null ? '—' : fmtPct(r.klaviyoRevenuePct)} rev</span>
                      </div>
                    );
                  })}
                </div>
                {Object.keys(snapshotKlaviyoByMonth).length === 0 && (
                  <div style={{ fontSize: 10, color: '#9a6a0a', marginTop: 12, letterSpacing: 1 }}>
                    Add <code>KLAVIYO_API_KEY</code> in Vercel and click Load Klaviyo to populate this section.
                  </div>
                )}
                {klaviyoTopDrivers.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #dedbd3' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <span style={S.label}>Top Klaviyo Revenue Drivers</span>
                      <span style={{ fontSize: 9, color: '#88857f', letterSpacing: 1 }}>Loaded from latest Klaviyo pull</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {klaviyoTopDrivers.map(item => (
                        <div key={`${item.kind}-${item.id}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center', padding: '8px 10px', background: '#fff', border: '1px solid #dedbd3', borderRadius: 6 }}>
                          <span style={{ fontSize: 8, color: item.color, fontWeight: 800, letterSpacing: 1 }}>{item.kind}</span>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: '#343330' }} title={item.id}>{item.name || item.id}</span>
                          <span style={{ fontSize: 10, color: '#171717', fontWeight: 800 }}>{fmt$(item.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ ...S.card, marginBottom: 20 }}>
                <span style={S.label}>Performance AI — Ratio Check and Optimization Readout</span>
                <textarea
                  value={performanceQuestion}
                  onChange={e => setPerformanceQuestion(e.target.value)}
                  rows={3}
                  style={{ width: '100%', marginTop: 8, padding: 10, background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 12, borderRadius: 4, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 9, color: '#88857f', letterSpacing: 1 }}>
                    Uses monthly Shopify, Meta, Google, Klaviyo, CM3, and net profit rows.
                  </span>
                  <button onClick={runPerformanceAnalysis} disabled={performanceChatLoading || !performanceQuestion.trim()} style={performanceChatLoading ? { ...S.ghostBtn, cursor: 'not-allowed' } : S.btn}>
                    {performanceChatLoading ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
                {performanceChatError && <div style={{ ...S.err, marginTop: 12 }}>{performanceChatError}</div>}
                {performanceAnswer && (
                  <div style={{ marginTop: 14, padding: 14, background: '#fff', border: '1px solid #dedbd3', borderRadius: 6, color: '#343330', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {performanceAnswer}
                  </div>
                )}
              </div>
            </>
          );
        }

        return (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, marginTop: 28 }}>
	              <div>
	                <div className="eyebrow" style={{ marginBottom: 6 }}>CFO View</div>
	                <div className="display-md" style={{ color: '#171717' }}>Financial Performance</div>
	                <div className="display-italic" style={{ fontSize: 12, color: '#77746f', marginTop: 4 }}>
	                  Revenue, CM3, OpEx coverage, and estimated net profit.
	                </div>
              </div>
              <button onClick={() => setShowAssumptions(v => !v)} style={S.ghostBtn}>
                {showAssumptions ? 'Hide' : 'Edit'} Assumptions
              </button>
            </div>

            {hasLegacyCustomerMonths && (
              <div style={{ ...S.err, marginBottom: 16, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
                Some {summaryYear} customer snapshots predate unique-customer tracking. Click Load Shopify to refresh the year and replace legacy summed customer counts.
              </div>
            )}

            {showAssumptions && settings && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <span style={S.label}>Assumptions (used for COGS, fees, CM3)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 10 }}>
	                  {[
	                    { k: 'grossMarginPct',         label: 'Gross Margin %',     suffix: '%'  },
	                    { k: 'dealerWholesaleRetailPct', label: 'Wholesale % Retail', suffix: '%'  },
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
	                        value={numberInputValue(settings[k])}
	                        onFocus={e => e.target.select()}
	                        onChange={e => setSettings({ ...settings, [k]: numberInputChange(e.target.value) })}
	                        style={{ width: '100%', padding: '6px 8px', background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 12, borderRadius: 4 }}
	                      />
	                      <span style={{ fontSize: 9, color: '#88857f' }}>{suffix}</span>
	                    </div>
	                  ))}
                  <div style={{ gridColumn: '1 / -1', fontSize: 9, color: '#88857f', letterSpacing: 1 }}>
                    Dealer/wholesale COGS assumes wholesale revenue is {dealerWholesaleRetailPct.toFixed(0)}% of retail, deriving an estimated {dealerGrossMarginPct.toFixed(1)}% gross margin on wholesale revenue from the DTC gross margin.
                  </div>
                  <div>
                    <span style={{ ...S.label, marginBottom: 4 }}>Monthly Table Start</span>
                    <input
                      type="month"
                      value={settings.cfoStartMonth || '2026-01'}
                      onChange={e => setSettings({ ...settings, cfoStartMonth: e.target.value || '2026-01' })}
                      style={{ width: '100%', padding: '6px 8px', background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 12, borderRadius: 4 }}
                    />
                    <span style={{ fontSize: 9, color: '#88857f' }}>YYYY-MM</span>
                  </div>
                </div>
                {/* Monthly OpEx + explicit revenue-source overrides. Google spend
                    pulls live from the Ads API — no manual override column. */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #dedbd3' }}>
                  <span style={S.label}>Monthly Overrides — OpEx and Revenue Sources</span>
                  <div style={{ fontSize: 9, color: '#88857f', marginBottom: 10, letterSpacing: 1 }}>
                    Dealer values replace that month's imported/connected dealer snapshot. Off-platform values are added only for sales outside both Shopify stores.
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: 480 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 90px 95px 70px 95px 70px 70px 70px', gap: 5, alignItems: 'center', minWidth: 680 }}>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>Month</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>OpEx</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>Dealer Rev</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>Dealer Ord</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>Other Rev</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>Other Ord</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>+ New</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#88857f', fontWeight: 600 }}>+ Ret</div>
                      {recent13.map(({ month: mk }) => {
                        const inp = (key, ph) => (
                          <input
                            type="number" step="1" placeholder={ph}
                            value={settings[key]?.[mk] ?? ''}
                            onChange={e => setSettings({ ...settings, [key]: { ...(settings[key] || {}), [mk]: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 } })}
                            style={{ width: '100%', padding: '4px 6px', background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, borderRadius: 3 }}
                          />
                        );
                        return (
                          <React.Fragment key={mk}>
                            <span style={{ fontSize: 11, color: '#343330' }}>{fmtMo(mk)}</span>
                            {inp('opexByMonth', String(defaultOpex))}
                            {inp('dealerRevenueByMonth', 'snapshot')}
                            {inp('dealerOrdersByMonth', 'snapshot')}
                            {inp('offPlatformRevenueByMonth', '0')}
                            {inp('offPlatformOrdersByMonth', '0')}
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
              <div style={{ ...S.card, marginBottom: 20, color: '#77746f', fontSize: 12 }}>
                Load Meta + Shopify data above to populate this view.
              </div>
            )}

            {dataReady && (
              <>
                {/* Calendar-year KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: `${summaryYear} YTD Gross Sales`, value: fmt$(ltm.revenue), sub: 'DTC total sales + dealer + off-platform' },
                    { label: `${summaryYear} YTD Net Revenue`, value: fmt$(ltm.netRevenue), sub: 'DTC net sales + dealer + off-platform' },
                    { label: `${summaryYear} DTC Gross Sales`, value: fmt$(ltm.dtcRevenue), sub: fmtPct(ltm.dtcRevenue / Math.max(ltm.revenue, 1)) + ' of gross' },
                    { label: `${summaryYear} DTC Net Sales`, value: fmt$(ltm.dtcNetRevenue), sub: fmtPct(ltm.dtcNetRevenue / Math.max(ltm.netRevenue, 1)) + ' of net' },
                    { label: `${summaryYear} Dealer Revenue`, value: fmt$(ltm.dealerRevenue), sub: fmtPct(ltm.dealerRevenue / Math.max(ltm.revenue, 1)) + ' of total' },
                    { label: `${summaryYear} YTD Ad Spend`,  value: fmt$(ltm.adSpend), sub: fmt$(ltm.metaSpend) + ' Meta · ' + fmt$(ltm.googleSpend) + ' Google' },
                    { label: `${summaryYear} YTD CM3`,       value: fmt$(ltm.cm3), color: ltm.cm3 >= 0 ? '#256b35' : '#b42318', sub: fmtPct(ltmCmMargin) + ' margin' },
                    {
                      label: `Est. ${summaryYear} YTD Net Profit`,
                      value: fmt$(ltm.netProfit),
                      color: ltm.netProfit >= 0 ? '#256b35' : '#b42318',
                      sub: 'actual/MTD CM3 - OpEx',
                      bridge: [
                        { label: 'Prior', value: priorNetProfit },
                        { label: fmtMo(currentMonthKey).replace(` '${summaryYear.slice(2)}`, ''), value: currentNetProfit },
                        { label: 'YTD', value: ltm.netProfit },
                      ],
                    },
                    { label: `${summaryYear} OpEx Cov.`,     value: ltmOpexCoverage == null ? '—' : fmtPct(ltmOpexCoverage), color: ltmOpexCoverage >= 1 ? '#256b35' : '#9a6a0a', sub: fmt$(opex) + ' / mo opex' },
                    { label: `${summaryYear} New Custs`,     value: ltm.newCustomers.toLocaleString(), sub: `${totalCustomers.toLocaleString()} total unique` },
                    { label: 'Avg NCAC',        value: ltmNcac == null ? '—' : '$' + ltmNcac.toFixed(0) },
                    { label: 'Blended CPA',     value: ltmCpa == null ? '—' : '$' + ltmCpa.toFixed(0), sub: 'ad spend ÷ all orders' },
                    { label: 'MER',             value: ltmMer == null ? '—' : ltmMer.toFixed(2) + 'x', color: (ltmMer || 0) >= 2 ? '#256b35' : (ltmMer || 0) >= 1 ? '#9a6a0a' : '#b42318', sub: 'revenue ÷ ad spend' },
                    { label: 'aMER',            value: ltmAmer == null ? '—' : ltmAmer.toFixed(2) + 'x', color: (ltmAmer || 0) >= 1 ? '#256b35' : (ltmAmer || 0) >= 0.5 ? '#9a6a0a' : '#b42318', sub: 'known new rev ÷ ad spend' },
                    { label: 'Meta ROAS',       value: ltmMetaRoas   == null ? '—' : ltmMetaRoas.toFixed(2)   + 'x', color: (ltmMetaRoas   || 0) >= 2 ? '#256b35' : (ltmMetaRoas   || 0) >= 1 ? '#9a6a0a' : '#b42318', sub: 'reported (pixel)' },
                    { label: 'Google ROAS',     value: ltmGoogleRoas == null ? '—' : ltmGoogleRoas.toFixed(2) + 'x', color: (ltmGoogleRoas || 0) >= 2 ? '#256b35' : (ltmGoogleRoas || 0) >= 1 ? '#9a6a0a' : '#b42318', sub: 'reported (pixel)' },
                    { label: 'Mktg % Rev',      value: ltm.revenue > 0 ? fmtPct(ltm.adSpend / ltm.revenue) : '—', color: ltm.revenue > 0 && (ltm.adSpend / ltm.revenue) <= 0.30 ? '#256b35' : ltm.revenue > 0 && (ltm.adSpend / ltm.revenue) <= 0.50 ? '#9a6a0a' : '#b42318', sub: 'ad spend ÷ revenue' },
                    { label: 'Repeat Rate',     value: fmtPct(ltmRepeatRate) },
                  ].map(({ label, value, sub, color, bridge }) => (
                    <div key={label} style={S.card}>
                      <span style={S.label}>{label}</span>
                      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#171717', lineHeight: 1 }}>{value}</div>
                      {sub && <div style={{ fontSize: 9, color: '#88857f', marginTop: 6, letterSpacing: 1 }}>{sub}</div>}
                      {bridge && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10, paddingTop: 8, borderTop: '1px solid #dedbd3' }}>
                          {bridge.map(item => (
                            <div key={item.label}>
                              <div style={{ fontSize: 8, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>{item.label}</div>
                              <div style={{ fontSize: 11, color: item.value >= 0 ? '#256b35' : '#b42318', fontWeight: 700 }}>{fmt$(item.value)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Current-month pace */}
                {pace && (
                  <div style={{ ...S.card, marginBottom: 20, borderColor: '#d84a17' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                      <span style={S.label}>{fmtMo(currentMonthKey)} Pace — Day {dayOfMonth} of {daysInCurrentMonth}</span>
                      <span style={{ fontSize: 9, color: '#88857f', letterSpacing: 1 }}>(MTD × {paceFactor.toFixed(2)})</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                      {[
                        { label: 'Projected Revenue', value: fmt$(pace.revenue), sub: fmt$(currentRow.revenue) + ' MTD' },
                        { label: 'Projected Ad Spend', value: fmt$(pace.adSpend), sub: fmt$(currentRow.adSpend) + ' MTD' },
                        { label: 'Projected CM3', value: fmt$(pace.cm3), color: pace.cm3 >= 0 ? '#256b35' : '#b42318', sub: fmt$(currentRow.cm3) + ' MTD' },
                        { label: 'Projected Net Profit', value: fmt$(pace.netProfit), color: pace.netProfit >= 0 ? '#256b35' : '#b42318', sub: 'after ' + fmt$(pace.opex) + ' OpEx' },
                        { label: 'OpEx Coverage', value: pace.opexCoverage == null ? '—' : fmtPct(pace.opexCoverage), color: (pace.opexCoverage || 0) >= 1 ? '#256b35' : (pace.opexCoverage || 0) >= 0.5 ? '#9a6a0a' : '#b42318', sub: 'vs ' + fmt$(pace.opex) },
                        { label: 'Projected New', value: pace.newCustomers.toLocaleString(), sub: currentRow.newCustomers + ' MTD' },
                        { label: 'NCAC (run rate)', value: pace.ncac == null ? '—' : '$' + pace.ncac.toFixed(0), sub: currentRow.newCustomers ? '' : 'no new yet' },
                        { label: 'MER (MTD)', value: currentRow.blendedRoas == null ? '—' : currentRow.blendedRoas.toFixed(2) + 'x', color: (currentRow.blendedRoas || 0) >= 2 ? '#256b35' : (currentRow.blendedRoas || 0) >= 1 ? '#9a6a0a' : '#b42318' },
                        { label: 'Google ROAS (MTD)', value: currentRow.googleRoasReported == null ? '—' : currentRow.googleRoasReported.toFixed(2) + 'x', color: (currentRow.googleRoasReported || 0) >= 2 ? '#256b35' : (currentRow.googleRoasReported || 0) >= 1 ? '#9a6a0a' : '#b42318', sub: 'reported (pixel)' },
                        { label: 'Blended CPA (MTD)', value: currentRow.orders > 0 ? '$' + (currentRow.adSpend / currentRow.orders).toFixed(0) : '—', sub: currentRow.orders + ' orders' },
                        { label: 'Mktg % Rev (MTD)', value: currentRow.revenue > 0 ? fmtPct(currentRow.adSpend / currentRow.revenue) : '—', color: currentRow.revenue > 0 && (currentRow.adSpend / currentRow.revenue) <= 0.30 ? '#256b35' : currentRow.revenue > 0 && (currentRow.adSpend / currentRow.revenue) <= 0.50 ? '#9a6a0a' : '#b42318' },
                      ].map(({ label, value, sub, color }) => (
                        <div key={label}>
                          <span style={S.label}>{label}</span>
                          <div style={{ fontSize: 18, fontWeight: 700, color: color || '#171717', lineHeight: 1 }}>{value}</div>
                          {sub && <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{sub}</div>}
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
                          <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                          <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                              <div title={`New: ${r.newCustomers}`} style={{ width: `${newPct}%`, background: '#d84a17', height: '100%' }} />
                              <div title={`Returning: ${r.returningCustomers}`} style={{ width: `${100 - newPct}%`, background: '#2ea98f', height: '100%' }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: '#171717', width: 32, textAlign: 'right', fontWeight: 700 }}>{tot || '—'}</span>
                          <div style={{ display: 'flex', gap: 6, width: 96, justifyContent: 'flex-end', fontSize: 9 }}>
                            {r.newCustomers > 0 && <span style={{ color: '#d84a17', letterSpacing: 1 }}>{r.newCustomers}N</span>}
                            {r.returningCustomers > 0 && <span style={{ color: '#2ea98f', letterSpacing: 1 }}>{r.returningCustomers}R</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#d84a17' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>New</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#2ea98f' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>Returning</span></div>
                  </div>
                </div>

                {view === 'growth' && (
                <div style={{ ...S.card, marginBottom: 20 }}>
                  {(() => {
                    const maxSpend = Math.max(...rows.map(r => r.adSpend), 1);
                    const mixMetaPct = ltm.adSpend > 0 ? ltm.metaSpend / ltm.adSpend : 0;
                    const mixGooglePct = ltm.adSpend > 0 ? ltm.googleSpend / ltm.adSpend : 0;
                    // Per-channel purchases (Meta) / conversions (Google) — pulled from snapshots.
                    const metaPurchasesByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, Number(r.meta.purchases || 0)]));
                    const googleConvByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.google).map(r => [r.month, Number(r.google.conversions || 0)]));
                    const ltmMetaPurchases = rollupRows.reduce((a, r) => a + (metaPurchasesByMonth[r.month] || 0), 0);
                    const ltmGoogleConv = rollupRows.reduce((a, r) => a + (googleConvByMonth[r.month] || 0), 0);
                    const ltmMetaCpa = ltmMetaPurchases > 0 ? ltm.metaSpend / ltmMetaPurchases : null;
                    const ltmGoogleCpa = ltmGoogleConv > 0 ? ltm.googleSpend / ltmGoogleConv : null;
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                          <span style={S.label}>Media Mix — Meta vs Google</span>
                          <span style={{ fontSize: 10, color: '#77746f', letterSpacing: 1 }}>
                            {summaryYear} YTD: <span style={{ color: '#1877f2', fontWeight: 700 }}>{fmtPct(mixMetaPct)} Meta</span>
                            {' · '}
                            <span style={{ color: '#fbbc05', fontWeight: 700 }}>{fmtPct(mixGooglePct)} Google</span>
                            {' · '}
                            <span style={{ color: '#343330' }}>{fmt$(ltm.adSpend)} total</span>
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #dedbd3' }}>
                          <div>
                            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#1877f2', marginBottom: 4, fontWeight: 600 }}>Meta CPA</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmMetaCpa == null ? '—' : '$' + ltmMetaCpa.toFixed(0)}</div>
                            <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltmMetaPurchases.toLocaleString()} purchases</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#fbbc05', marginBottom: 4, fontWeight: 600 }}>Google CPA</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmGoogleCpa == null ? '—' : '$' + ltmGoogleCpa.toFixed(0)}</div>
                            <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltmGoogleConv.toLocaleString(undefined, { maximumFractionDigits: 1 })} conversions</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4, fontWeight: 600 }}>Blended CPA</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{ltmCpa == null ? '—' : '$' + ltmCpa.toFixed(0)}</div>
                            <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>{ltm.orders.toLocaleString()} orders (Shopify)</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4, fontWeight: 600 }}>Channel CPA Δ</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: (ltmGoogleCpa != null && ltmMetaCpa != null) ? (ltmGoogleCpa < ltmMetaCpa ? '#256b35' : '#b42318') : '#171717', lineHeight: 1 }}>
                              {(ltmGoogleCpa != null && ltmMetaCpa != null) ? (ltmGoogleCpa < ltmMetaCpa ? 'Google ' : 'Meta ') + 'wins' : '—'}
                            </div>
                            <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>
                              {(ltmGoogleCpa != null && ltmMetaCpa != null) ? '$' + Math.abs(ltmGoogleCpa - ltmMetaCpa).toFixed(0) + ' difference' : 'need both channels'}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                          {rows.map(r => {
                            const barPct = (r.adSpend / maxSpend) * 100;
                            const metaPct = r.adSpend > 0 ? (r.metaSpend / r.adSpend) * 100 : 0;
                            return (
                              <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                                <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ display: 'flex', height: '100%', width: `${barPct}%`, transition: 'width 0.4s' }}>
                                    <div title={`Meta: ${fmt$(r.metaSpend)}`} style={{ width: `${metaPct}%`, background: '#1877f2', height: '100%' }} />
                                    <div title={`Google: ${fmt$(r.googleSpend)}`} style={{ width: `${100 - metaPct}%`, background: '#fbbc05', height: '100%' }} />
                                  </div>
                                </div>
                                <span style={{ fontSize: 11, color: '#171717', width: 70, textAlign: 'right', fontWeight: 700 }}>{fmt$(r.adSpend)}</span>
                                <div style={{ display: 'flex', gap: 6, width: 140, justifyContent: 'flex-end', fontSize: 9 }}>
                                  {r.metaSpend > 0 && <span style={{ color: '#1877f2', letterSpacing: 1 }}>{fmt$(r.metaSpend)}M</span>}
                                  {r.googleSpend > 0 && <span style={{ color: '#fbbc05', letterSpacing: 1 }}>{fmt$(r.googleSpend)}G</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#1877f2' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>Meta</span></div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#fbbc05' }} /><span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>Google</span></div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                )}

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
                          <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}{r.isCurrent ? '*' : ''}</span>
                          <div style={{ flex: 1, height: 14, background: '#f4f1ea', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                            {/* 100% line */}
                            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#256b35', opacity: 0.5 }} />
                            <div style={{
                              position: 'absolute', top: 0, bottom: 0,
                              ...(positive ? { left: '50%', width: `${barW}%` } : { right: '50%', width: `${barW}%` }),
                              background: isFull ? '#256b35' : positive ? '#9a6a0a' : '#b42318',
                            }} />
                          </div>
                          <span style={{ fontSize: 11, color: cov == null ? '#88857f' : isFull ? '#256b35' : positive ? '#9a6a0a' : '#b42318', width: 60, textAlign: 'right', fontWeight: 700 }}>
                            {cov == null ? '—' : (cov * 100).toFixed(0) + '%'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
                    Green line = 100% (CM3 fully covers OpEx). * = current month (MTD, not annualized).
                  </div>
                </div>

                {/* NCAC + CM3 side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <div style={S.card}>
                    <span style={S.label}>NCAC by Month (Ad spend ÷ new customers)</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {rows.map(r => {
                        const barPct = r.ncac != null ? (r.ncac / maxNcac) * 100 : 0;
                        return (
                          <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                            <div style={{ flex: 1, height: 14, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${barPct}%`, background: '#9a6a0a', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 10, color: r.ncac != null ? '#171717' : '#88857f', width: 56, textAlign: 'right', fontWeight: r.ncac != null ? 700 : 400 }}>
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
                            <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}</span>
                            <div style={{ flex: 1, height: 14, background: '#f4f1ea', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#dedbd3' }} />
                              <div style={{
                                position: 'absolute', top: 0, bottom: 0,
                                ...(pos ? { left: '50%', width: `${barPct}%` } : { right: '50%', width: `${barPct}%` }),
                                background: pos ? '#256b35' : '#b42318',
                              }} />
                            </div>
                            <span style={{ fontSize: 10, color: pos ? '#256b35' : '#b42318', width: 72, textAlign: 'right', fontWeight: 700 }}>
                              {fmt$(r.cm3)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

	                {/* Estimated / projected net profit by month */}
	                <div style={{ ...S.card, marginBottom: 20 }}>
	                  <span style={S.label}>Estimated Net Profit After OpEx by Month</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {rows.map(r => {
                      const value = r.projectedNetProfit;
                      const pos = value >= 0;
                      const barPct = (Math.abs(value) / netProfitAbsMax) * 50;
                      return (
                        <div key={r.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>{fmtMo(r.month)}{r.isCurrent ? '*' : ''}</span>
                          <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#dedbd3' }} />
                            <div style={{
                              position: 'absolute', top: 0, bottom: 0,
                              ...(pos ? { left: '50%', width: `${barPct}%` } : { right: '50%', width: `${barPct}%` }),
                              background: pos ? '#256b35' : '#b42318',
                            }} />
                          </div>
                          <span style={{ fontSize: 10, color: pos ? '#256b35' : '#b42318', width: 76, textAlign: 'right', fontWeight: 700 }}>
                            {fmt$(value)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
	                    Closed months use actual/MTD net profit. * = current month projected to month-end using today&apos;s MTD pace.
	                  </div>
                </div>

                {/* Detailed monthly P&L table */}
                <div style={{ ...S.card, marginBottom: 20 }}>
                  <span style={S.label}>Monthly P&L (CM3 build)</span>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, minWidth: 1160 }}>
                      <thead>
                        <tr>
                          {['Month', 'DTC', 'Dealer', 'Other', 'Total', 'Orders', 'New', 'Ret', 'Meta', 'Google', 'NCAC', '1st Pay', 'COGS', 'Fees', 'Ship', 'Pick', 'CM3', 'CM%', 'OpEx', 'OpEx Cov', 'Net Profit', 'ROAS'].map(h => (
                            <th key={h} style={{ fontSize: 8, letterSpacing: 1, color: '#88857f', textAlign: h === 'Month' ? 'left' : 'right', padding: '4px 6px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          const margin = r.netRevenue > 0 ? r.cm3 / r.netRevenue : 0;
                          return (
                            <tr key={r.month} style={{ borderTop: '1px solid #dedbd3' }}>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#343330' }}>{fmtMo(r.month)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#171717', textAlign: 'right' }}>{fmt$(r.dtcRevenue)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#9a6a0a', textAlign: 'right' }}>{r.dealerRevenue ? fmt$(r.dealerRevenue) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#77746f', textAlign: 'right' }}>{r.offPlatformRevenue ? fmt$(r.offPlatformRevenue) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#171717', textAlign: 'right', fontWeight: 600 }}>{fmt$(r.revenue)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.orders < (r.newCustomers + r.returningCustomers) ? '#b42318' : '#343330', textAlign: 'right' }} title={r.orders < (r.newCustomers + r.returningCustomers) ? `Orders (${r.orders}) < customers (${r.newCustomers + r.returningCustomers}) — data inconsistency` : ''}>{r.orders || '—'}{r.orders < (r.newCustomers + r.returningCustomers) ? '⚠' : ''}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#d84a17', textAlign: 'right', fontWeight: 600 }}>{r.newCustomers || '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#2ea98f', textAlign: 'right', fontWeight: 600 }}>{r.returningCustomers || '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>{fmt$(r.metaSpend)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.googleSpend > 0 ? '#343330' : '#88857f', textAlign: 'right' }}>{r.googleSpend > 0 ? fmt$(r.googleSpend) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#9a6a0a', textAlign: 'right', fontWeight: 600 }}>{r.ncac != null ? '$' + r.ncac.toFixed(0) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.firstOrderPayback == null ? '#88857f' : r.firstOrderPayback >= 1 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 600 }}>{r.firstOrderPayback == null ? '—' : (r.firstOrderPayback * 100).toFixed(0) + '%'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#77746f', textAlign: 'right' }}>{fmt$(r.cogs)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#77746f', textAlign: 'right' }}>{fmt$(r.paymentFees)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#77746f', textAlign: 'right' }}>{fmt$(r.shipCost)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: '#77746f', textAlign: 'right' }}>{fmt$(r.fulfill)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.cm3 >= 0 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 700 }}>{fmt$(r.cm3)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: margin >= 0 ? '#256b35' : '#b42318', textAlign: 'right' }}>{r.netRevenue > 0 ? fmtPct(margin) : '—'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: opexByMonth[r.month] != null ? '#343330' : '#88857f', textAlign: 'right' }}>{fmt$(r.opex)}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.opexCoverage == null ? '#88857f' : r.opexCoverage >= 1 ? '#256b35' : r.opexCoverage >= 0 ? '#9a6a0a' : '#b42318', textAlign: 'right', fontWeight: 600 }}>{r.opexCoverage == null ? '—' : (r.opexCoverage * 100).toFixed(0) + '%'}</td>
                              <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.netProfit >= 0 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 700 }}>{fmt$(r.netProfit)}</td>
                              <td style={{ padding: '6px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>{r.blendedRoas != null ? r.blendedRoas.toFixed(2) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #dedbd3' }}>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 9, letterSpacing: 1, color: '#88857f', textTransform: 'uppercase', fontWeight: 700 }}>{summaryYear} YTD</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#171717', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.dtcRevenue)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#9a6a0a', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.dealerRevenue)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#77746f', textAlign: 'right', fontWeight: 700 }}>{ltm.offPlatformRevenue ? fmt$(ltm.offPlatformRevenue) : '—'}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#171717', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.revenue)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>{ltm.orders.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#d84a17', textAlign: 'right', fontWeight: 700 }}>{ltm.newCustomers.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#2ea98f', textAlign: 'right', fontWeight: 700 }}>{ltm.returningCustomers.toLocaleString()}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#343330', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.metaSpend)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltm.googleSpend > 0 ? '#343330' : '#88857f', textAlign: 'right', fontWeight: 700 }}>{ltm.googleSpend > 0 ? fmt$(ltm.googleSpend) : '—'}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#9a6a0a', textAlign: 'right', fontWeight: 700 }}>{ltmNcac == null ? '—' : '$' + ltmNcac.toFixed(0)}</td>
                          <td colSpan={5} />
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltm.cm3 >= 0 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.cm3)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltmCmMargin >= 0 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 700 }}>{fmtPct(ltmCmMargin)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: '#343330', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.opex)}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltmOpexCoverage == null ? '#88857f' : ltmOpexCoverage >= 1 ? '#256b35' : '#9a6a0a', textAlign: 'right', fontWeight: 700 }}>{ltmOpexCoverage == null ? '—' : (ltmOpexCoverage * 100).toFixed(0) + '%'}</td>
                          <td style={{ padding: '8px 6px 4px 0', fontSize: 11, color: ltm.netProfit >= 0 ? '#256b35' : '#b42318', textAlign: 'right', fontWeight: 700 }}>{fmt$(ltm.netProfit)}</td>
                          <td style={{ padding: '8px 0 4px', fontSize: 11, color: '#343330', textAlign: 'right', fontWeight: 700 }}>{ltmRoas == null ? '—' : ltmRoas.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
                    CM3 = Net Revenue − COGS − Payment Fees − Shipping − Pick/Pack − (Meta + Google) Spend. Estimated net profit = CM3 − OpEx. COGS uses Shopify per-unit cost when set, GM% assumption otherwise. Dealer COGS uses the wholesale margin assumption. NCAC = (Meta + Google) spend ÷ new lifetime customers. OpEx column = monthly P&L override or default. Bold OpEx = override set; dim = default.
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
            <div style={{ fontSize: 9, color: '#88857f', marginBottom: 8, letterSpacing: 1 }}>
              From the URL: docs.google.com/spreadsheets/d/<strong style={{ color: '#9a6a0a' }}>SHEET_ID</strong>/edit
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={settings?.forecastSheetId || ''}
                onChange={e => setSettings({ ...settings, forecastSheetId: e.target.value.trim() })}
                placeholder="1uzteHW4sWB6Q49Rt7pOFzmIMD_s0Dxec0lQwgTfFHRI"
                style={{ flex: 1, padding: '8px 10px', background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, borderRadius: 4 }}
              />
              <input
                type="text"
                value={settings?.forecastSheetName || 'P&L Monthly'}
                onChange={e => setSettings({ ...settings, forecastSheetName: e.target.value })}
                placeholder="P&L Monthly"
                style={{ width: 160, padding: '8px 10px', background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, borderRadius: 4 }}
              />
              <button onClick={() => saveSettings(settings)} disabled={savingSettings} style={S.btn}>
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
              Make sure the forecast sheet is shared (Viewer) with <code style={{ color: '#9a6a0a' }}>howl-drive-uploader@howl-creative-studio.iam.gserviceaccount.com</code>. After saving, click Refresh Forecast.
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
              <div style={{ ...S.card, color: '#77746f', fontSize: 12 }}>
                <div style={{ fontSize: 13, color: '#171717', marginBottom: 10 }}>No forecast loaded yet.</div>
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Paste the Sheet ID above and Save.</li>
                  <li>Make sure the sheet is shared (Viewer) with the service account.</li>
                  <li>Click <strong>Pull Forecast</strong> in the header.</li>
                </ol>
                {forecastUpdatedAt && (
                  <div style={{ marginTop: 14, fontSize: 9, color: '#88857f', letterSpacing: 1 }}>
                    Last cached: {forecastUpdatedAt.toLocaleString()}
                  </div>
                )}
              </div>
            </>
          );
        }

        // Build pacing rows: filter forecast months to start month forward, intersect with snapshots+live actuals.
        const startMonth = settings?.cfoStartMonth || '2026-01';
        const liveSpendByMonth = Object.fromEntries((data?.monthlyInsights || []).map(m => [m.month, m]));
        const livePrimaryMonths = shopifyData?._stores
          ? (shopifyData._stores?.primary?.months || [])
          : (shopifyData?.months || []);
        const liveDealerMonths = shopifyData?._stores?.dealer?.months || [];
        const liveShopByMonth = Object.fromEntries(livePrimaryMonths.map(m => [m.month, m]));
        const liveDealerByMonth = Object.fromEntries(liveDealerMonths.map(m => [m.month, m]));
        const snapShopByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify).map(r => [r.month, r.shopify]));
        const snapMetaByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.meta).map(r => [r.month, r.meta]));
        const dealerByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.shopify_dealer).map(r => [r.month, r.shopify_dealer]));
        const sumShop = (a, b) => {
          if (!a && !b) return null;
          a = a || {}; b = b || {};
          const out = {};
          for (const k of ['orders','shipping','sessions','newCustomers','returningCustomers','newRevenue','returningRevenue','cogs','costedRevenue','uncostedRevenue']) out[k] = (a[k] || 0) + (b[k] || 0);
          out.netSales = sumNetRevenue(a, b);
          out.grossSales = sumGrossRevenue(a, b);
          out.shopifyNetSales = out.netSales;
          out.cvr = out.sessions > 0 ? (out.orders / out.sessions) * 100 : 0;
          return out;
        };
        const allShopMonths = new Set([
          ...Object.keys(snapShopByMonth), ...Object.keys(liveShopByMonth),
          ...Object.keys(dealerByMonth), ...Object.keys(liveDealerByMonth),
        ]);
        const shopByMonth = {};
        const primaryByMonth = {};
        const dealerSourceByMonth = {};
        for (const mk of allShopMonths) {
          const primary = liveShopByMonth[mk] || snapShopByMonth[mk] || null;
          const dealer = liveDealerByMonth[mk] || dealerByMonth[mk] || null;
          primaryByMonth[mk] = primary;
          dealerSourceByMonth[mk] = dealer;
          shopByMonth[mk] = sumShop(primary, dealer);
        }
        const metaByMonth = { ...snapMetaByMonth, ...liveSpendByMonth };
        // Google spend from live Ads API (via monthly_metrics.google snapshot).
        const snapGoogleByMonth = Object.fromEntries((historySnapshots || []).filter(r => r.google).map(r => [r.month, r.google]));
        const googleByMonth = Object.fromEntries(
          Object.entries(snapGoogleByMonth).map(([k, v]) => [k, Number(v?.spend || 0)])
        );
        const opexByMonth = settings?.opexByMonth || {};
        const dealerRevenueByMonth = settings?.dealerRevenueByMonth || {};
        const dealerOrdersByMonth = settings?.dealerOrdersByMonth || {};
        const offPlatformRevenueByMonth = settings?.offPlatformRevenueByMonth || {};
        const offPlatformOrdersByMonth = settings?.offPlatformOrdersByMonth || {};
        const defaultOpex = assumptionNumber(settings?.monthlyOpex, 0);
        const s = settings || {};
        const grossMarginPct = assumptionNumber(s?.grossMarginPct, 60);
        const dealerGrossMarginPct = wholesaleGrossMarginPct(grossMarginPct, assumptionNumber(s?.dealerWholesaleRetailPct, 70));
        const paymentFeePct = assumptionNumber(s?.paymentFeePct, 2.9);
        const paymentFeeFixed = assumptionNumber(s?.paymentFeeFixed, 0.30);
        const shippingCostPerOrder = assumptionNumber(s?.shippingCostPerOrder, 8);
        const fulfillmentCostPerOrder = assumptionNumber(s?.fulfillmentCostPerOrder, 3);

        // Filter forecast to start month forward; current calendar year only.
        const nowD = new Date();
        const thisYear = String(nowD.getFullYear());
        const currentMonthKey = `${thisYear}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
        const dayOfMonth = nowD.getDate();
        const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();

        const forecastMonths = (forecast.months || []).filter(m => m.month.startsWith(thisYear));

        const annualRows = forecastMonths.map(f => {
          const sh = shopByMonth[f.month] || {};
          const dtc = primaryByMonth[f.month] || {};
          const dealer = dealerSourceByMonth[f.month] || {};
          const meta = metaByMonth[f.month] || {};
          const isCurrent = f.month === currentMonthKey;
          const isPast = f.month < currentMonthKey;

          const hasDealerRevenueOverride = Object.prototype.hasOwnProperty.call(dealerRevenueByMonth, f.month)
            && dealerRevenueByMonth[f.month] !== '';
          const hasDealerOrdersOverride = Object.prototype.hasOwnProperty.call(dealerOrdersByMonth, f.month)
            && dealerOrdersByMonth[f.month] !== '';
          const dealerRevenue = hasDealerRevenueOverride
            ? Number(dealerRevenueByMonth[f.month] || 0)
            : netRevenueFor(dealer);
          const dealerOrders = hasDealerOrdersOverride
            ? Number(dealerOrdersByMonth[f.month] || 0)
            : Number(dealer.orders || 0);
          const offPlatformRevenue = Number(offPlatformRevenueByMonth[f.month] || 0);
          const offPlatformOrders = Number(offPlatformOrdersByMonth[f.month] || 0);
          const actRevenue = grossRevenueFor(dtc) + dealerRevenue + offPlatformRevenue;
          const actNetRevenue = netRevenueFor(dtc) + dealerRevenue + offPlatformRevenue;
          const orders = Number(dtc.orders || 0) + dealerOrders + offPlatformOrders;
          const dealerCogsSource = hasDealerRevenueOverride ? {} : dealer;
          const actCogs = estimatedCogsFor(dtc, netRevenueFor(dtc), grossMarginPct)
            + estimatedCogsFor(dealerCogsSource, dealerRevenue, dealerGrossMarginPct)
            + offPlatformRevenue * (1 - (grossMarginPct / 100));
          const actMetaSpend = meta.spend || 0;
          const actGoogleSpend = Number(googleByMonth[f.month] || 0);
          const actCac = actMetaSpend + actGoogleSpend;
          const actOpex = opexByMonth[f.month] != null && opexByMonth[f.month] !== ''
            ? Number(opexByMonth[f.month]) : defaultOpex;
          const actFees = actNetRevenue * (paymentFeePct / 100) + orders * paymentFeeFixed;
          const actShip = orders * shippingCostPerOrder;
          const actPick = orders * fulfillmentCostPerOrder;
          const actCm3 = actNetRevenue - actCogs - actFees - actShip - actPick - actCac;

          // Project current-month actual to full month.
          const paceFactor = isCurrent ? daysInMonth / Math.max(dayOfMonth, 1) : 1;
          const projRevenue = isCurrent ? actRevenue * paceFactor : actRevenue;
          const projCac = isCurrent ? actCac * paceFactor : actCac;
          const projCm3 = isCurrent ? actCm3 * paceFactor : actCm3;

          // Targets pace against gross sales/topline revenue for the CFO view.
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
        const rows = annualRows.filter(r => r.month >= startMonth);

        // YTD totals (sum of past months actual + current MTD actual). Targets = sum of all forecast months in range.
        const ytdActual = annualRows.filter(r => r.isPast || r.isCurrent).reduce((a, r) => ({
          revenue: a.revenue + r.actRevenue,
          cac:     a.cac + r.actCac,
          opex:    a.opex + r.actOpex,
          cm3:     a.cm3 + r.actCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const ytdTargetSoFar = annualRows.filter(r => r.isPast || r.isCurrent).reduce((a, r) => ({
          revenue: a.revenue + r.tgtRevenue,
          cac:     a.cac + r.tgtCac,
          opex:    a.opex + r.tgtOpex,
          cm3:     a.cm3 + r.tgtCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        // Year-end projection: sum of past actuals + current MTD projected + future targets
        const eoyProjected = annualRows.reduce((a, r) => ({
          revenue: a.revenue + (r.isPast ? r.actRevenue : r.isCurrent ? r.projRevenue : r.tgtRevenue),
          cac:     a.cac + (r.isPast ? r.actCac : r.isCurrent ? r.projCac : r.tgtCac),
          opex:    a.opex + (r.isPast ? r.actOpex : r.isCurrent ? r.actOpex : r.tgtOpex), // future opex still uses target
          cm3:     a.cm3 + (r.isPast ? r.actCm3 : r.isCurrent ? r.projCm3 : r.tgtCm3),
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const eoyTarget = annualRows.reduce((a, r) => ({
          revenue: a.revenue + r.tgtRevenue,
          cac:     a.cac + r.tgtCac,
          opex:    a.opex + r.tgtOpex,
          cm3:     a.cm3 + r.tgtCm3,
        }), { revenue: 0, cac: 0, opex: 0, cm3: 0 });

        const fmt$ = (n) => n == null || isNaN(n) ? '—' : '$' + Math.round(n).toLocaleString();
        const fmtPct = (n) => n == null || isNaN(n) ? '—' : (n * 100).toFixed(1) + '%';
        const fmtCompact$ = (n) => n == null || isNaN(n) ? '—' : '$' + (n / 1000000).toFixed(1) + 'M';
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
          if (target == null || target === 0) return '#77746f';
          const ratio = actual / target;
          if (goodWhen === 'higher')  return ratio >= 1 ? '#256b35' : ratio >= 0.85 ? '#9a6a0a' : '#b42318';
          if (goodWhen === 'lower')   return ratio <= 1 ? '#256b35' : ratio <= 1.15 ? '#9a6a0a' : '#b42318';
          return Math.abs(ratio - 1) < 0.15 ? '#256b35' : '#9a6a0a'; // tracking: ±15% of target
        };
        const annualTargetPaces = [
          {
            label: 'Base Plan',
            source: '$13M workbook curve',
            pace: getAnnualRevenuePace(
              ytdActual.revenue,
              settings?.annualRevenueTargetBase || 13000000,
              nowD,
              settings?.annualRevenueCurveBase,
            ),
          },
          {
            label: 'Stretch Plan',
            source: '$15M workbook curve',
            pace: getAnnualRevenuePace(
              ytdActual.revenue,
              settings?.annualRevenueTargetStretch || 15000000,
              nowD,
              settings?.annualRevenueCurveStretch,
            ),
          },
        ];

        return (
          <>
            {forecastUpdatedAt && (
              <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1, marginBottom: 14 }}>
                Forecast last pulled {forecastUpdatedAt.toLocaleString()} · Sheet: {forecast.sheetName} · {(forecast.months || []).length} months parsed
              </div>
            )}

            {/* Annual revenue target pacing */}
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ ...S.label, marginBottom: 0 }}>{thisYear} Annual Revenue Pace — through {nowD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    ['annualRevenueTargetBase', 'Base target'],
                    ['annualRevenueTargetStretch', 'Stretch target'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: 'block' }}>
                      <span style={{ fontSize: 8, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
                        <span style={{ padding: '7px 0 7px 9px', background: '#f4f1ea', border: '1px solid #dedbd3', borderRight: 0, color: '#77746f', fontSize: 10, borderRadius: '4px 0 0 4px' }}>$</span>
                        <input
                          type="number"
                          min="0"
                          step="100000"
                          value={settings?.[key] || ''}
                          onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })}
                          style={{ width: 112, padding: '7px 8px 7px 4px', background: '#f4f1ea', border: '1px solid #dedbd3', borderLeft: 0, color: '#171717', fontFamily: 'inherit', fontSize: 10, borderRadius: '0 4px 4px 0' }}
                        />
                      </div>
                    </label>
                  ))}
                  <button onClick={() => saveSettings(settings)} disabled={savingSettings} style={{ ...S.ghostBtn, padding: '8px 12px' }}>
                    {savingSettings ? 'Saving…' : 'Save Targets'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 12 }}>
                {annualTargetPaces.map(({ label, pace, source }) => {
                  if (!pace) return null;
                  const ahead = pace.daysDelta >= 0;
                  const paceColor = pace.percentToPace >= 1 ? '#256b35' : pace.percentToPace >= 0.9 ? '#9a6a0a' : '#b42318';
                  return (
                    <div key={label} style={{ border: '1px solid #dedbd3', borderRadius: 6, padding: '14px 16px', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                        <div>
                          <div style={{ ...S.label, marginBottom: 5 }}>{label}</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{fmtCompact$(pace.annualTarget)}</div>
                          {source && <div style={{ fontSize: 8, color: '#88857f', marginTop: 5, letterSpacing: 1, textTransform: 'uppercase' }}>{source}</div>}
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 700, color: paceColor }}>{(pace.percentToPace * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 16 }}>
                        <div>
                          <div style={{ fontSize: 8, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase' }}>Actual YTD</div>
                          <div style={{ fontSize: 14, color: '#171717', fontWeight: 700, marginTop: 3 }}>{fmt$(pace.actualRevenue)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: '#88857f', letterSpacing: 1, textTransform: 'uppercase' }}>Expected Today</div>
                          <div style={{ fontSize: 14, color: '#343330', fontWeight: 700, marginTop: 3 }}>{fmt$(pace.expectedRevenue)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #dedbd3', fontSize: 14, fontWeight: 700, color: ahead ? '#256b35' : '#b42318' }}>
                        {Math.abs(pace.daysDelta).toFixed(1)} days {ahead ? 'ahead of pace' : 'behind pace'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 9, color: '#88857f', marginTop: 10, letterSpacing: 1 }}>
                Both plans follow their supplied workbook's monthly Net Revenue curve, scaled to the saved annual target.
              </div>
            </div>

            {/* YTD Pacing strip */}
            <div style={{ ...S.card, marginBottom: 16 }}>
              <span style={S.label}>YTD Pacing — {thisYear} (through {fmtMo(currentMonthKey)})</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 12 }}>
                {KPI_DEFS.map(({ key, label, goodWhen }) => {
                  const a = ytdActual[key], t = ytdTargetSoFar[key];
                  const ratio = pctOf(a, t);
                  const color = colorFor(a, t, goodWhen);
                  return (
                    <div key={key} style={{ borderLeft: '2px solid #dedbd3', paddingLeft: 14 }}>
                      <div style={{ ...S.label, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{fmt$(a)}</div>
                      <div style={{ fontSize: 10, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>vs {fmt$(t)} target</div>
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
                    <div key={key} style={{ borderLeft: '2px solid #dedbd3', paddingLeft: 14 }}>
                      <div style={{ ...S.label, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#171717', lineHeight: 1 }}>{fmt$(proj)}</div>
                      <div style={{ fontSize: 10, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>vs {fmt$(tgt)} plan</div>
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
                        <th key={i} style={{ fontSize: 8, letterSpacing: 1, color: '#88857f', textAlign: i === 0 || i === 1 ? 'left' : 'right', padding: '4px 6px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const status = r.isPast ? 'actual' : r.isCurrent ? 'pace' : 'plan';
                      const statusColor = r.isPast ? '#256b35' : r.isCurrent ? '#d84a17' : '#88857f';
                      const revRow = r.isPast ? r.actRevenue : r.isCurrent ? r.projRevenue : r.tgtRevenue;
                      const cacRow = r.isPast ? r.actCac : r.isCurrent ? r.projCac : r.tgtCac;
                      const cm3Row = r.isPast ? r.actCm3 : r.isCurrent ? r.projCm3 : r.tgtCm3;
                      const dRev = r.tgtRevenue > 0 ? (revRow / r.tgtRevenue) - 1 : null;
                      const dCac = r.tgtCac > 0 ? (cacRow / r.tgtCac) - 1 : null;
                      const dCm3 = r.tgtCm3 > 0 ? (cm3Row / r.tgtCm3) - 1 : (r.tgtCm3 < 0 ? null : null);
                      const cell = (txt, color) => <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: color || '#343330', textAlign: 'right' }}>{txt}</td>;
                      const deltaCell = (d, goodWhen) => {
                        if (d == null) return cell('—', '#88857f');
                        const sign = d > 0 ? '+' : '';
                        const good = goodWhen === 'lower' ? d <= 0 : d >= 0;
                        return cell(`${sign}${(d * 100).toFixed(0)}%`, good ? '#256b35' : '#b42318');
                      };
                      return (
                        <tr key={r.month} style={{ borderTop: '1px solid #dedbd3' }}>
                          <td style={{ padding: '6px 6px 6px 0', fontSize: 11, color: r.isCurrent ? '#d84a17' : '#343330', fontWeight: r.isCurrent ? 700 : 400 }}>{fmtMo(r.month)}</td>
                          <td style={{ padding: '6px 6px 6px 0', fontSize: 9, color: statusColor, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>{status}</td>
                          {cell(fmt$(revRow), '#171717')} {cell(fmt$(r.tgtRevenue))}{deltaCell(dRev, 'higher')}
                          {cell(fmt$(cacRow))} {cell(fmt$(r.tgtCac))}{deltaCell(dCac, 'lower')}
                          {cell(fmt$(cm3Row), cm3Row >= 0 ? '#256b35' : '#b42318')} {cell(fmt$(r.tgtCm3))}{deltaCell(dCm3, 'higher')}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 9, color: '#88857f', marginTop: 10, letterSpacing: 1 }}>
                STATUS — actual: closed month, pace: current month projected to month-end, plan: forecast value used. CAC delta uses "lower is better"; revenue & CM3 use "higher is better". Forecast revenue line = DTC Revenue (closest comp to Shopify net sales).
              </div>
            </div>
          </>
        );
      })()}

      {view === 'meta' && !data && !loading && (
        <div style={{ color: '#88857f', fontSize: 12, padding: '40px 0' }}>
          Click "Load Meta" above to pull your ad shipping data from Meta.
        </div>
      )}

      {view === 'meta' && data && (
        <>
          {/* Live daily budget */}
          <div style={{ ...S.card, marginBottom: 20, borderColor: totalDailyBudget > 0 ? '#d84a17' : '#dedbd3' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
              <div>
                <span style={S.label}>Live Daily Budget</span>
                <div style={{ fontSize: 36, fontWeight: 700, color: '#171717', lineHeight: 1 }}>
                  ${totalDailyBudget.toFixed(0)}<span style={{ fontSize: 16, color: '#77746f', fontWeight: 400 }}>/day</span>
                </div>
                <div style={{ fontSize: 10, color: '#77746f', marginTop: 8, letterSpacing: 1 }}>
                  {activeAdsets.length} active ad set{activeAdsets.length !== 1 ? 's' : ''}
                  {totalDailyBudget > 0 && <> — <span style={{ color: '#171717' }}>${(totalDailyBudget * 7).toFixed(0)}/wk</span> — <span style={{ color: '#171717' }}>${(totalDailyBudget * 30).toFixed(0)}/mo</span></>}
                </div>
                {totalLifetimeBudget > 0 && (
                  <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, letterSpacing: 1 }}>
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
                          <span style={{ fontSize: 9, color: '#343330', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {campaignName} <span style={{ color: '#88857f' }}>({cb.adsets.length})</span>
                            {strategyLabel && <span style={{ color: '#9a6a0a', marginLeft: 4 }}>{strategyLabel}</span>}
                          </span>
                          <span style={{ fontSize: 9, color: '#171717', fontWeight: 600 }}>
                            {dailyForCampaign > 0 ? `$${dailyForCampaign.toFixed(0)}/day` : cb.campaignLifetimeBudget > 0 ? `$${cb.campaignLifetimeBudget.toFixed(0)} LT` : '—'}
                          </span>
                        </div>
                        <div style={{ height: 3, background: '#f4f1ea', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: '#d84a17', borderRadius: 2 }} />
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
            const FORMAT_COLORS = { video: '#d84a17', static: '#e8722a', review: '#9a6a0a', other: '#77746f' };
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
                          <span style={{ fontSize: 12, color: '#343330', fontWeight: 600 }}>{label}</span>
                          <span style={{ fontSize: 20, fontWeight: 700, color: '#171717' }}>
                            {count} <span style={{ fontSize: 11, color: '#88857f', fontWeight: 400 }}>({pct}%)</span>
                          </span>
                        </div>
                        <div style={{ height: 10, background: '#f4f1ea', borderRadius: 5, overflow: 'hidden' }}>
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
                        <span style={{ fontSize: 11, color: '#77746f' }}>{count} <span style={{ color: '#88857f' }}>({pct}%)</span></span>
                      </div>
                      <div style={{ height: 4, background: '#dedbd3', borderRadius: 2 }}>
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
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#171717' }}>{value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#88857f', fontSize: 11, marginTop: 8 }}>No spend data available for this period.</div>
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
                    <span style={{ fontSize: 10, color: '#77746f', width: 48, flexShrink: 0, textAlign: 'right' }}>
                      {formatMonthLabel(mKey)}
                    </span>
                    <div style={{ flex: 1, height: 20, background: '#f4f1ea', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
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
                    <span style={{ fontSize: 11, color: m.total > 0 ? '#171717' : '#88857f', width: 28, textAlign: 'right', fontWeight: m.total > 0 ? 700 : 400 }}>
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
                  <span style={{ fontSize: 9, color: '#77746f', letterSpacing: 1 }}>{TYPE_LABELS[type]}</span>
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
                    <th key={h} style={{ fontSize: 8, letterSpacing: 2, color: '#88857f', textAlign: 'left', padding: '4px 8px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map(ad => {
                  const type = parseAdType(ad);
                  return (
                    <tr key={ad.id} style={{ borderTop: '1px solid #dedbd3' }}>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#343330', maxWidth: 320 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{ad.name}</span>
                      </td>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 9, letterSpacing: 1 }}>
                        <span style={{ color: TYPE_COLORS[type], textTransform: 'uppercase' }}>{TYPE_LABELS[type]}</span>
                      </td>
                      <td style={{ padding: '8px 8px 8px 0', fontSize: 9 }}>
                        <span style={{ color: ad.status === 'ACTIVE' ? '#256b35' : ad.status === 'PAUSED' ? '#77746f' : '#b42318', letterSpacing: 1, textTransform: 'uppercase' }}>
                          {ad.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 0', fontSize: 10, color: '#77746f', whiteSpace: 'nowrap' }}>
                        {new Date(ad.created_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ads.length > 10 && (
              <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
                Showing 10 most recent of {ads.length} total ads
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Shopify Analytics Section ─────────────────────────────────────── */}
      {view === 'shopify' && shopifyUpdated && (
        <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1, marginBottom: 16 }}>
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

      {view === 'shopify' && !shopifyData && !shopifyLoading && !(historySnapshots || []).some(r => r.shopify || r.shopify_dealer) && (
        <div style={{ color: '#88857f', fontSize: 12, padding: '40px 0' }}>
          Click "Load Shopify" above to pull store analytics from Shopify.
        </div>
      )}

      {view === 'shopify' && (shopifyData || (historySnapshots || []).some(r => r.shopify || r.shopify_dealer)) && (() => {
        const snapshotPrimary = Object.fromEntries((historySnapshots || []).filter(r => r.shopify).map(r => [r.month, r.shopify]));
        const snapshotDealer = Object.fromEntries((historySnapshots || []).filter(r => r.shopify_dealer).map(r => [r.month, r.shopify_dealer]));
        const combineSnapshotShop = (a, b) => {
          if (!a && !b) return null;
          a = a || {}; b = b || {};
          const out = {};
          for (const k of ['orders', 'shipping', 'sessions', 'newCustomers', 'returningCustomers', 'newRevenue', 'returningRevenue']) {
            out[k] = Number(a[k] || 0) + Number(b[k] || 0);
          }
          out.netSales = sumNetRevenue(a, b);
          out.grossSales = sumGrossRevenue(a, b);
          out.cvr = out.sessions > 0 ? (out.orders / out.sessions) * 100 : 0;
          out.aov = out.orders > 0 ? out.netSales / out.orders : 0;
          return out;
        };
        const snapshotMonths = Array.from(new Set([...Object.keys(snapshotPrimary), ...Object.keys(snapshotDealer)]))
          .sort()
          .map(month => {
            const combined = combineSnapshotShop(snapshotPrimary[month], snapshotDealer[month]);
            return combined ? { month, ...combined } : null;
          })
          .filter(m => m && (m.netSales > 0 || m.orders > 0 || m.sessions > 0));
        const months = shopifyData ? (shopifyData.months || []) : snapshotMonths;
        const topProducts = shopifyData?.topProducts || [];
        const usingSnapshots = !shopifyData;

        // Compute averages and insights
        const fullMonths = months.filter(m => m.orders > 0);
        const totalRevenue = months.reduce((s, m) => s + m.netSales, 0);
        const totalOrders = months.reduce((s, m) => s + m.orders, 0);
        const totalSessions = months.reduce((s, m) => s + m.sessions, 0);
        const avgCvr = totalSessions > 0 ? (totalOrders / totalSessions) * 100 : 0;

        // Best / worst months
        const bestCvrMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.cvr > b.cvr ? a : b) : null;
        const worstCvrMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.cvr < b.cvr ? a : b) : null;
        const bestRevMonth = fullMonths.length > 0 ? fullMonths.reduce((a, b) => a.netSales > b.netSales ? a : b) : null;

        // Current month pace
        const now = new Date();
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const currentMonthData = months.find(m => m.month === currentMonthKey) || null;
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
            {usingSnapshots && (
              <div style={{ ...S.err, marginBottom: 16, color: '#9a6a0a', borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)' }}>
                Showing snapshotted Shopify history. Click Load Shopify to refresh live data and product mix.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Best CVR Month', value: bestCvrMonth ? `${bestCvrMonth.cvr.toFixed(2)}%` : '—', sub: bestCvrMonth ? fmtMonth(bestCvrMonth.month) : '' },
                { label: 'Worst CVR Month', value: worstCvrMonth ? `${worstCvrMonth.cvr.toFixed(2)}%` : '—', sub: worstCvrMonth ? fmtMonth(worstCvrMonth.month) : '' },
                { label: 'Best Revenue Month', value: bestRevMonth ? `$${Math.round(bestRevMonth.netSales).toLocaleString()}` : '—', sub: bestRevMonth ? fmtMonth(bestRevMonth.month) : '' },
                { label: 'This Month Pace', value: currentMonthData ? `$${Math.round(projectedRevenue).toLocaleString()}` : '—', sub: currentMonthData ? `$${Math.round(currentMonthData.netSales).toLocaleString()} so far` : 'No current month snapshot' },
                { label: 'MoM Trend', value: momTrend !== null ? `${momTrend >= 0 ? '+' : ''}${momTrend.toFixed(1)}%` : '—', sub: momTrend !== null ? (momTrend >= 0 ? 'Revenue up' : 'Revenue down') : '', color: momTrend !== null ? (momTrend >= 0 ? '#256b35' : '#b42318') : '#171717' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} style={S.card}>
                  <span style={S.label}>{label}</span>
                  <div style={{ fontSize: 22, fontWeight: 700, color: color || '#171717', lineHeight: 1 }}>{value}</div>
                  {sub && <div style={{ fontSize: 9, color: '#88857f', marginTop: 6, letterSpacing: 1 }}>{sub}</div>}
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
                      <th key={h} style={{ fontSize: 8, letterSpacing: 2, color: '#88857f', textAlign: h === 'Month' ? 'left' : 'right', padding: '4px 8px 8px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map(m => {
                    const isCurrentMonth = currentMonthData && m.month === currentMonthData.month && months.indexOf(m) === months.length - 1;
                    const cvrColor = m.cvr > avgCvr ? '#256b35' : m.cvr > 0 ? '#b42318' : '#88857f';
                    return (
                      <tr key={m.month} style={{ borderTop: '1px solid #dedbd3', background: isCurrentMonth ? 'rgba(220,68,10,0.08)' : 'transparent' }}>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: isCurrentMonth ? '#d84a17' : '#343330', fontWeight: isCurrentMonth ? 700 : 400 }}>
                          {fmtMonth(m.month)} {isCurrentMonth && <span style={{ fontSize: 8, color: '#d84a17', letterSpacing: 1 }}>(CURRENT)</span>}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#171717', textAlign: 'right', fontWeight: 600 }}>
                          ${Math.round(m.netSales).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>
                          {m.orders.toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>
                          {m.sessions.toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 8px 8px 0', fontSize: 11, color: cvrColor, textAlign: 'right', fontWeight: 600 }}>
                          {m.cvr > 0 ? m.cvr.toFixed(2) + '%' : '—'}
                        </td>
                        <td style={{ padding: '8px 0', fontSize: 11, color: '#343330', textAlign: 'right' }}>
                          {m.aov > 0 ? '$' + m.aov.toFixed(0) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, letterSpacing: 1 }}>
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
                        <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>
                          {fmtMonth(m.month)}
                        </span>
                        <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: '#d84a17', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 10, color: m.cvr > 0 ? '#171717' : '#88857f', width: 40, textAlign: 'right', fontWeight: m.cvr > 0 ? 700 : 400 }}>
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
                        <span style={{ fontSize: 9, color: '#77746f', width: 44, flexShrink: 0, textAlign: 'right' }}>
                          {fmtMonth(m.month)}
                        </span>
                        <div style={{ flex: 1, height: 16, background: '#f4f1ea', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: '#2ea98f', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 10, color: m.netSales > 0 ? '#171717' : '#88857f', width: 52, textAlign: 'right', fontWeight: m.netSales > 0 ? 700 : 400 }}>
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
                          <span style={{ fontSize: 11, color: '#343330', fontWeight: 600, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: '#171717', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            ${Math.round(p.totalRevenue).toLocaleString()} <span style={{ fontSize: 9, color: '#88857f', fontWeight: 400 }}>({p.totalOrders} orders)</span>
                          </span>
                        </div>
                        <div style={{ height: 8, background: '#f4f1ea', borderRadius: 4, overflow: 'hidden' }}>
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


function ManualTranscriptPaste({ groupKey, name, analyzing, onSubmit }) {
  const [text, setText] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadErr, setUploadErr] = React.useState("");
  const fileRef = React.useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) {
      setUploadErr(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Whisper max is 25MB. Compress or trim first.`);
      return;
    }
    setUploadErr("");
    setUploading(true);
    try {
      const r = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });
      const data = await r.json();
      if (data.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message || "Transcription failed"));
      const t = (data.text || "").trim();
      if (!t) throw new Error("Whisper returned an empty transcript.");
      setText(t);
      onSubmit(t);
    } catch (err) {
      setUploadErr(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || analyzing}
          style={{
            padding: "7px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700,
            background: uploading || analyzing ? "rgba(220,68,10,0.2)" : "#d84a17",
            border: "1px solid #d84a17", color: uploading || analyzing ? "rgba(255,255,255,0.5)" : "#fff",
            fontFamily: "inherit", borderRadius: 3,
            cursor: uploading || analyzing ? "not-allowed" : "pointer",
          }}
        >
          {uploading ? "Transcribing..." : "Upload video file"}
        </button>
        <span style={{ fontSize: 10, color: "#77746f" }}>
          .mp4 / .mov, up to 25MB. Whisper transcribes, then re-analyzes.
        </span>
      </div>
      <input ref={fileRef} type="file" accept="video/*,audio/*" onChange={onFile} style={{ display: "none" }} />
      {uploadErr && <div style={{ fontSize: 11, color: "#b42318", marginBottom: 8 }}>{uploadErr}</div>}

      <div style={{ fontSize: 9, letterSpacing: 1.5, color: "#88857f", textTransform: "uppercase", margin: "10px 0 4px" }}>
        Or paste script manually
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the spoken script of this video..."
        rows={4}
        style={{
          width: "100%", padding: "8px 10px",
          background: "#f4f1ea", border: "1px solid #dedbd3",
          color: "#171717", fontFamily: "inherit", fontSize: 11.5, lineHeight: 1.5,
          borderRadius: 3, resize: "vertical", boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => text.trim() && onSubmit(text.trim())}
          disabled={!text.trim() || analyzing || uploading}
          style={{
            padding: "6px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700,
            background: text.trim() && !analyzing && !uploading ? "rgba(220,68,10,0.15)" : "rgba(220,68,10,0.06)",
            border: "1px solid #d84a17", color: text.trim() && !analyzing && !uploading ? "#d84a17" : "rgba(220,68,10,0.5)",
            fontFamily: "inherit", borderRadius: 3,
            cursor: text.trim() && !analyzing && !uploading ? "pointer" : "not-allowed",
          }}
        >
          {analyzing ? "Re-analyzing..." : "Re-analyze with pasted script"}
        </button>
      </div>
    </div>
  );
}
