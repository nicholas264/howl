// LauncherTool — unified ad launcher.
//
// Merges the previous "UGC Inbox" (Drive-pulled raw assets) and "Publish"
// (in-app generated assets from the cart) into one queue with shared
// settings. Source-aware launch dispatcher routes Drive items through
// /api/drive/ugc and Cart items through /api/meta.
//
// Preserved from each tool:
// - Pair detection (1:1 + 9:16) with badge.
// - Folder-aware creator extraction.
// - Launch progress timeline with NDJSON streaming for Drive launches.
// - Page picker, Instagram account picker (avatar dropdowns).
// - Drive thumbnail proxy under COEP.
// - Per-launch instagram_user_id on the creative.
// - Campaign + adset selection / creation.
// - Headline + primary text inputs with saved-variant Copy Library.
// - Hide-launched and delete actions for Drive items.
//
// Creative Test (bulk parallel launches with cost caps) lives temporarily in
// the legacy Publish tool until a follow-up folds it in.
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PRODUCTS } from '../data';
import CopyLibrary, { getCopyWarnings, useCopyLibrary } from './CopyLibrary';
import LaunchTimeline from './LaunchTimeline';
import { ls, lsSet } from '../utils/localStorage';
import {
  DriveThumb, PagePicker, InstagramAccountPicker,
} from './launcher/shared';

const LS_CONFIG = 'howl_launcher_config';
const LS_SELECTED = 'howl_launcher_selected_items';
const LS_META = 'howl_launcher_item_meta_v1';
const DEFAULT_URL_PARAMS = 'tw_source={{site_source_name}}&tw_adid={{ad.id}}';

const DEFAULT_LAUNCHER_CONFIG = {
  pageId: import.meta.env.VITE_META_PAGE_ID || '',
  instagramUserId: import.meta.env.VITE_META_INSTAGRAM_USER_ID || '',
  defaultCreator: '',
  defaultProduct: PRODUCTS[0]?.id || '',
  defaultPixelId: import.meta.env.VITE_META_PIXEL_ID || '3577794072540304',
  defaultObjective: 'OUTCOME_SALES',
  defaultUrlParams: DEFAULT_URL_PARAMS,
  namingMode: 'batch_adsets',
  adsetNameTemplate: 'HOWL | CT | {creator} | {asset} | {product} | {date}',
  adNameTemplate: 'HOWL | AD | {creator} | {asset} | {product} | {date}',
};

const DRIVE_STEPS = [
  { key: 'drive_download', label: 'Download' },
  { key: 'meta_upload',    label: 'Upload' },
  { key: 'meta_thumbnail', label: 'Thumbnail' },
  { key: 'meta_creative',  label: 'Creative' },
  { key: 'meta_ad',        label: 'Ad' },
  { key: 'drive_move',     label: 'File' },
  { key: 'db_log',         label: 'Log' },
];

const CART_STEPS = [
  { key: 'meta_upload',   label: 'Upload' },
  { key: 'meta_creative', label: 'Creative' },
  { key: 'meta_ad',       label: 'Ad' },
];

const OBJECTIVES = [
  { value: 'OUTCOME_TRAFFIC',   label: 'Traffic' },
  { value: 'OUTCOME_SALES',     label: 'Sales (requires Pixel ID)' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_LEADS',     label: 'Leads' },
];

const SOURCE_ATTRIBUTIONS = [
  { value: 'external_creator', label: 'Creator UGC', requiresCreator: true, hint: 'Use for paid/inbound creator footage that should feed creator performance.' },
  { value: 'internal_employee', label: 'Internal employee', requiresLabel: true, hint: 'Use for HOWL team footage without an external creator record.' },
  { value: 'founder', label: 'Founder', requiresLabel: true, hint: 'Use for founder-led creative or founder voiceover.' },
  { value: 'tool_generated', label: 'Made in tool', hint: 'Use for static, callout, review, or other in-app generated ads.' },
];

const PRODUCT_COPY_OPTIONS = {
  r1: [
    {
      label: 'Portable proof',
      headline: 'Fire That Fits Anywhere',
      primaryText: 'R1 folds to shoebox size, throws huge flame, and runs all night on one tank.',
    },
    {
      label: 'Lightweight shock',
      headline: '11 Pounds. Real Campfire.',
      primaryText: 'Tiny enough to live in your rig. Big enough to make the stop worth it.',
    },
    {
      label: 'Warm weather',
      headline: 'Your 40 Degree Fire',
      primaryText: 'Built for fast setup, long burn time, and firelight wherever the road quits.',
    },
  ],
  r3: [
    {
      label: 'Middle fire',
      headline: 'The Missing Middle Fire',
      primaryText: 'More radiant warmth than R1, more packable than R4, built for three-season camps.',
    },
    {
      label: 'Shoulder season',
      headline: 'Own Shoulder Season',
      primaryText: 'R3 brings BarCoal heat and A-Flame light when the nights start getting rude.',
    },
    {
      label: 'Packable radiant',
      headline: 'Radiant Heat. Still Packable.',
      primaryText: 'The three-season HOWL for overlanders, river camps, and cold mornings outside.',
    },
  ],
  r4mkii: [
    {
      label: 'Cold proof',
      headline: 'Never Camp Cold Again',
      primaryText: 'R4 MKii throws real radiant heat for winter nights, wind, rain, and high-altitude camps.',
    },
    {
      label: 'Heat shock',
      headline: '1,300 Degrees From Propane',
      primaryText: 'BarCoal radiant heaters crank out the kind of warmth ordinary propane pits cannot touch.',
    },
    {
      label: 'Four season',
      headline: 'Your Zero Degree Fire',
      primaryText: 'Built for ski lots, hunting camps, whiteout weather, and crews who stay out late.',
    },
  ],
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildAdName({ creator, productId }) {
  const product = PRODUCTS.find(p => p.id === productId)?.name || productId || 'product';
  const c = (creator || 'creator').trim().replace(/\s+/g, '-');
  return `HOWL | UGC | ${c} | ${product} | ${todayISO()}`;
}

function assetLabel(item = {}) {
  const name = item.source === 'drive'
    ? (item.kind === 'pair' ? (item.folderName || item.name) : item.name)
    : (item.name || item.title || 'Creative');
  return String(name || 'Creative')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/__LAUNCHED__.*$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNamePart(value, fallback = 'NA') {
  const cleaned = String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function applyNameTemplate(template, { creator, product, asset, date, source, index }) {
  return String(template || '')
    .replaceAll('{creator}', cleanNamePart(creator, 'Creator'))
    .replaceAll('{product}', cleanNamePart(product, 'Product'))
    .replaceAll('{asset}', cleanNamePart(asset, 'Asset'))
    .replaceAll('{date}', cleanNamePart(date, todayISO()))
    .replaceAll('{source}', cleanNamePart(source, 'Source'))
    .replaceAll('{index}', String(index || 1).padStart(2, '0'))
    .replace(/\s+\|/g, ' |')
    .replace(/\|\s+/g, '| ')
    .replace(/\s+/g, ' ')
    .trim();
}

function destUrlFor(productId) {
  return PRODUCTS.find(p => p.id === productId)?.url || '';
}

const LEGACY_PRODUCT_URLS = {
  r1: new Set([
    'https://howlcampfires.com/products/r1',
    'https://www.howlcampfires.com/products/r1',
  ]),
  r3: new Set([
    'https://howlcampfires.com/products/r3',
    'https://www.howlcampfires.com/products/r3',
  ]),
  r4mkii: new Set([
    'https://howlcampfires.com/products/r4-mkii',
    'https://www.howlcampfires.com/products/r4-mkii',
  ]),
};

function normalizedDestUrlFor(productId, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return destUrlFor(productId);
  if (LEGACY_PRODUCT_URLS[productId]?.has(trimmed)) return destUrlFor(productId);
  return trimmed;
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function productForDestination(value) {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  return PRODUCTS.find(product => product.url.replace(/\/$/, '') === normalized) || null;
}

function friendlyDriveError(value) {
  const message = String(value || 'Drive could not load.');
  if (/service account|impersonation|getAccessToken|iam\.serviceAccounts/i.test(message)) {
    return 'Google Drive access needs attention. The service account cannot create an access token; restore its Token Creator permission in Google Cloud.';
  }
  return message;
}

function productCopyOptions(productId) {
  return PRODUCT_COPY_OPTIONS[productId] || [];
}

function launcherCopyOptions(productId, variants = []) {
  const seen = new Set();
  const options = [
    ...productCopyOptions(productId).map(option => ({ ...option, source: 'Product' })),
    ...variants
      .filter(option => (!option?.productIds?.length || option.productIds.includes(productId))
        && (option?.headline || option?.primaryText))
      .map(option => ({
        label: option.label || 'Saved copy',
        headline: option.headline || '',
        primaryText: option.primaryText || '',
        source: 'Library',
      })),
  ];
  return options.filter(option => {
    const key = `${option.headline.trim()}__${option.primaryText.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultProductCopy(productId) {
  return productCopyOptions(productId)[0] || { headline: '', primaryText: '' };
}

function isBuiltInProductCopy(headline = '', primaryText = '') {
  const h = String(headline || '').trim();
  const b = String(primaryText || '').trim();
  return Object.values(PRODUCT_COPY_OPTIONS).flat().some(option =>
    option.headline === h && option.primaryText === b
  );
}

function shouldAutoReplaceCopy(meta = {}) {
  return (!meta.headline?.trim() && !meta.primaryText?.trim())
    || isBuiltInProductCopy(meta.headline, meta.primaryText);
}

function cleanUrlParams(value) {
  return String(value || '').trim().replace(/^[?&]+/, '');
}

function normalizeCreatorName(name = '') {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizedWords(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function creatorHandles(creator = {}) {
  const direct = Array.isArray(creator.handles) ? creator.handles : [];
  const socials = Array.isArray(creator.social_accounts)
    ? creator.social_accounts.map(account => account?.handle)
    : [];
  return [...direct, ...socials].filter(Boolean);
}

function creatorMatchIndex(creators = []) {
  const entries = [];
  const frequency = new Map();
  creators.forEach(creator => {
    const fullName = normalizedWords(creator.name);
    const firstName = fullName.split(' ')[0];
    const aliases = [
      fullName && { value: fullName, kind: fullName.includes(' ') ? 'full_name' : 'name' },
      firstName?.length >= 4 && fullName.includes(' ') && { value: firstName, kind: 'first_name' },
      ...creatorHandles(creator).map(handle => ({ value: normalizedWords(String(handle).replace(/^@/, '')), kind: 'handle' })),
    ].filter(alias => alias?.value?.length >= 4);
    aliases.forEach(alias => frequency.set(alias.value, (frequency.get(alias.value) || 0) + 1));
    entries.push({ creator, aliases });
  });
  return entries.map(entry => ({
    ...entry,
    aliases: entry.aliases.filter(alias => frequency.get(alias.value) === 1),
  }));
}

function suggestedCreatorFromAsset(name, index) {
  const haystack = ` ${normalizedWords(name)} `;
  const matches = [];
  index.forEach(({ creator, aliases }) => {
    aliases.forEach(alias => {
      if (!haystack.includes(` ${alias.value} `)) return;
      const score = alias.kind === 'full_name' || alias.kind === 'name' ? 100 : alias.kind === 'handle' ? 90 : 75;
      matches.push({ creator, alias, score });
    });
  });
  matches.sort((a, b) => b.score - a.score || a.creator.name.localeCompare(b.creator.name));
  if (!matches.length || (matches[1] && matches[1].score === matches[0].score && matches[1].creator.id !== matches[0].creator.id)) return null;
  const best = matches[0];
  return {
    creatorId: Number(best.creator.id),
    creatorName: best.creator.name,
    sourceType: 'external_creator',
    sourceLabel: best.creator.name,
    confidence: best.score >= 90 ? 'high' : 'review',
    reason: best.alias.kind === 'handle'
      ? `Matched @${best.alias.value} in asset name`
      : `Matched ${best.alias.kind === 'first_name' ? 'first name' : 'creator name'} in asset name`,
  };
}

function sourceConfig(value) {
  return SOURCE_ATTRIBUTIONS.find(item => item.value === value) || SOURCE_ATTRIBUTIONS[0];
}

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1240 },
  h1: { fontSize: 22, marginBottom: 4 },
  sub: { color: '#77746f', fontSize: 13, marginTop: 0, marginBottom: 16 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f', marginBottom: 6, display: 'block' },
  input: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  select: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', width: '100%' },
  card: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', padding: 14, display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr) auto', gap: 16, alignItems: 'center', marginBottom: 12 },
  thumbBox: { width: 140, height: 140, borderRadius: 4, background: '#f4f1ea', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#88857f', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden' },
  fileMeta: { fontSize: 10, color: '#77746f', marginBottom: 4 },
  fileName: { fontSize: 12, fontWeight: 600, color: '#171717', wordBreak: 'break-all' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 },
  btn: (disabled) => ({
    padding: '9px 18px', background: disabled ? '#dedbd3' : '#d84a17', border: 'none',
    color: disabled ? '#88857f' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  ghost: { padding: '8px 14px', background: 'none', border: '1px solid #dedbd3', color: '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  badge: (color) => ({
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700,
    color, padding: '2px 6px', borderRadius: 3,
    border: `1px solid ${color}`, background: `${color}1a`,
  }),
  linkedHint: (linked) => ({
    marginTop: 5,
    fontSize: 9,
    lineHeight: 1.35,
    color: linked ? '#256b35' : '#b42318',
  }),
  err: { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#d84a17', fontSize: 10, borderRadius: 4 },
  settings: { background: '#fff', border: '1px solid #dedbd3', borderRadius: 6, padding: 16, marginBottom: 18 },
  divider: { borderTop: '1px solid #dedbd3', margin: '20px 0' },
};

function driveItemIncludesAnyId(item, ids) {
  if (item.kind === 'pair') return ids.includes(item.feed?.id) || ids.includes(item.story?.id);
  return ids.includes(item.id);
}

function driveSingleAspect(item = {}) {
  if (item.aspectLabel) return item.aspectLabel;
  const n = `${item.folderPath || ''} ${item.name || ''}`.toLowerCase();
  if (/(9\s*[-_:x]\s*16|916|story|stories|reel|vertical)/.test(n)) return '9:16';
  if (/(4\s*[-_:x]\s*5|45|portrait|feed)/.test(n)) return '4:5';
  if (/(1\s*[-_:x]\s*1|11|square)/.test(n)) return '1:1';
  if (/(16\s*[-_:x]\s*9|169|landscape)/.test(n)) return '16:9';
  const video = item.videoMediaMetadata || {};
  const image = item.imageMediaMetadata || {};
  const width = parseInt(video.width || image.width || 0, 10);
  const height = parseInt(video.height || image.height || 0, 10);
  if (!(width > 0 && height > 0)) return '';
  const ratio = width / height;
  if (ratio < 0.68) return '9:16';
  if (ratio < 0.92) return '4:5';
  if (ratio < 1.12) return '1:1';
  return '16:9';
}

function orderDrivePair(first, second) {
  const firstAspect = driveSingleAspect(first);
  const secondAspect = driveSingleAspect(second);
  if (firstAspect === '9:16' && secondAspect !== '9:16') return { feed: second, story: first };
  if (secondAspect === '9:16' && firstAspect !== '9:16') return { feed: first, story: second };
  return { feed: first, story: second };
}

export default function LauncherTool({ cart = [], onAddToCart, onUpdateCartItem, onRemoveCartItem }) {
  const [creators, setCreators] = useState([]);
  const [creatorsError, setCreatorsError] = useState('');
  const [deliverablesByCreator, setDeliverablesByCreator] = useState({});
  useEffect(() => {
    fetch('/api/creators')
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`Creators failed (${response.status})`)))
      .then(data => {
        setCreators(data.creators || []);
        setCreatorsError('');
      })
      .catch(err => setCreatorsError(err.message || 'Creators could not load'));
  }, []);
  const loadCreatorDeliverables = useCallback(async (creatorId) => {
    if (!creatorId || deliverablesByCreator[creatorId]) return;
    try {
      const response = await fetch(`/api/creator-workflow?creator_id=${creatorId}`);
      if (!response.ok) return;
      const data = await response.json();
      setDeliverablesByCreator(prev => ({
        ...prev,
        [creatorId]: (data.deliverables || []).filter(item => !['launched', 'cancelled'].includes(item.status)),
      }));
    } catch { /* optional helper only */ }
  }, [deliverablesByCreator]);
  // ── shared settings ────────────────────────────────────────────────────
  const [config, setConfig] = useState(() => ({ ...DEFAULT_LAUNCHER_CONFIG, ...ls(LS_CONFIG, {}) }));
  // Backfill defaults for users whose localStorage config predates these fields.
  useEffect(() => {
    const patch = {};
    for (const [key, value] of Object.entries(DEFAULT_LAUNCHER_CONFIG)) {
      if (config[key] === undefined || config[key] === null || config[key] === '') patch[key] = value;
    }
    if (Object.keys(patch).length) updateConfig(patch);
  }, []);
  const updateConfig = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    lsSet(LS_CONFIG, next);
  };
  const resetNamingDefaults = () => updateConfig({
    namingMode: DEFAULT_LAUNCHER_CONFIG.namingMode,
    adsetNameTemplate: DEFAULT_LAUNCHER_CONFIG.adsetNameTemplate,
    adNameTemplate: DEFAULT_LAUNCHER_CONFIG.adNameTemplate,
  });

  // ── campaign / adset selection ─────────────────────────────────────────
  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(() => ls('howl_launcher_campaign', ''));
  const [selectedAdsetId, setSelectedAdsetId] = useState(() => ls('howl_launcher_adset', ''));
  const [newCampaign, setNewCampaign] = useState({ name: '', objective: 'OUTCOME_SALES', pixelId: '' });
  const [newAdset, setNewAdset] = useState({ name: '', budget: '50' });
  const [newAdsetNameEdited, setNewAdsetNameEdited] = useState(false);
  const [batchAdsetBudget, setBatchAdsetBudget] = useState(() => ls('howl_launcher_batch_budget', '50'));
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [creatingAdset, setCreatingAdset] = useState(false);
  const [batchLaunching, setBatchLaunching] = useState(false);

  useEffect(() => { lsSet('howl_launcher_campaign', selectedCampaignId); }, [selectedCampaignId]);
  useEffect(() => { lsSet('howl_launcher_adset', selectedAdsetId); }, [selectedAdsetId]);
  useEffect(() => { lsSet('howl_launcher_batch_budget', batchAdsetBudget); }, [batchAdsetBudget]);

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_campaigns' }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      setCampaigns(d.data || []);
      setCampaignsLoaded(true);
    } catch (err) {
      console.error('list_campaigns failed', err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const loadAdsets = async (campaignId) => {
    if (!campaignId || campaignId === '__new__') { setAdsets([]); return; }
    setLoadingAdsets(true);
    try {
      const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_adsets', campaign_id: campaignId }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      setAdsets(d.data || []);
    } catch (err) {
      console.error('list_adsets failed', err);
    } finally {
      setLoadingAdsets(false);
    }
  };

  useEffect(() => { if (selectedCampaignId && selectedCampaignId !== '__new__') loadAdsets(selectedCampaignId); }, [selectedCampaignId]);

  const createCampaign = async () => {
    if (!newCampaign.name.trim()) return alert('Campaign name required.');
    const pixelId = (newCampaign.pixelId || config.defaultPixelId || '').trim();
    if (newCampaign.objective === 'OUTCOME_SALES' && !pixelId) {
      return alert('Pixel ID required for OUTCOME_SALES campaigns. Set Default Pixel ID in launcher settings.');
    }
    setCreatingCampaign(true);
    try {
      const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_campaign', name: newCampaign.name.trim(), objective: newCampaign.objective, pixel_id: pixelId }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      await loadCampaigns();
      setSelectedCampaignId(d.id);
      setNewCampaign({ name: '', objective: config.defaultObjective || 'OUTCOME_SALES', pixelId: '' });
    } catch (err) {
      alert('Create campaign failed: ' + err.message);
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Resolve the selected campaign's objective so ad sets inherit the right
  // optimization (OUTCOME_SALES → OFFSITE_CONVERSIONS+PURCHASE, etc).
  // Falls back to config.defaultObjective when the campaign list hasn't loaded
  // or the campaign isn't found (e.g. it was just created in this session).
  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);
  const effectiveObjective = selectedCampaign?.objective || config.defaultObjective || 'OUTCOME_SALES';

  const createAdsetRequest = async ({ name, budget, select = false }) => {
    if (!selectedCampaignId || selectedCampaignId === '__new__') throw new Error('Pick a campaign first.');
    if (!name.trim()) throw new Error('Ad set name required.');
    const budgetDollars = parseFloat(budget);
    if (!(budgetDollars > 0)) throw new Error('Daily budget must be greater than 0.');
    const pixelId = (config.defaultPixelId || '').trim();
    if (effectiveObjective === 'OUTCOME_SALES' && !pixelId) {
      throw new Error('Pixel ID required for sales ad sets. Set Default Pixel ID in launcher settings.');
    }
    const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: 'create_adset',
      campaign_id: selectedCampaignId,
      name: name.trim(),
      daily_budget_dollars: budgetDollars,
      objective: effectiveObjective,
      pixel_id: pixelId,
    }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || d.error);
    if (select) {
      setSelectedAdsetId(d.id);
    }
    return d.id;
  };

  const createAdset = async () => {
    setCreatingAdset(true);
    try {
      await createAdsetRequest({ name: newAdset.name, budget: newAdset.budget, select: true });
      await loadAdsets(selectedCampaignId);
      setNewAdset({ name: '', budget: '50' });
    } catch (err) {
      alert('Create ad set failed: ' + err.message);
    } finally {
      setCreatingAdset(false);
    }
  };

  // ── drive items (pulled from /api/drive/ugc) ────────────────────────────
  const [driveItems, setDriveItems] = useState([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [driveError, setDriveError] = useState('');
  const refreshDrive = useCallback(async () => {
    setLoadingDrive(true);
    setDriveError('');
    try {
      const r = await fetch('/api/drive/ugc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setDriveItems(d.items || (d.files || []).map(f => ({ kind: 'single', ...f })));
    } catch (err) {
      setDriveError(friendlyDriveError(err.message));
    } finally {
      setLoadingDrive(false);
    }
  }, []);
  useEffect(() => { refreshDrive(); }, [refreshDrive]);

  // ── per-item editable metadata (creator, product, angle, headline, primaryText, status) ──
  // Single state map keyed by unified item id (drive ids are file ids; cart ids prefixed).
  const [meta, setMeta] = useState(() => ls(LS_META, {}));
  useEffect(() => { lsSet(LS_META, meta); }, [meta]);
  const updateMeta = (id, patch) => setMeta(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const updateProduct = (id, productId) => {
    const productCopy = defaultProductCopy(productId);
    setMeta(prev => {
      const current = prev[id] || {};
      return {
        ...prev,
        [id]: {
          ...current,
          productId,
          destUrl: destUrlFor(productId),
          ...(shouldAutoReplaceCopy(current) ? {
            headline: productCopy.headline,
            primaryText: productCopy.primaryText,
          } : {}),
        },
      };
    });
  };
  const findCreatorByName = useCallback((name) => {
    const needle = normalizeCreatorName(name);
    if (!needle) return null;
    return creators.find(item => normalizeCreatorName(item.name) === needle) || null;
  }, [creators]);
  const matchIndex = useMemo(() => creatorMatchIndex(creators), [creators]);
  const autoMatchCreator = useCallback((assetName) => suggestedCreatorFromAsset(assetName, matchIndex), [matchIndex]);
  const updateCreator = (id, name) => {
    const creator = findCreatorByName(name);
    if (creator?.id) loadCreatorDeliverables(creator.id);
    updateMeta(id, {
      creator: name,
      creatorId: creator?.id || null,
      deliverableId: creator?.id ? null : undefined,
      sourceType: 'external_creator',
      sourceLabel: creator?.name || name,
      creatorMatch: creator ? {
        confidence: 'manual',
        reason: 'Selected from creator database',
      } : null,
    });
  };
  const createCreatorFromLauncher = async (id) => {
    const name = (meta[id]?.creator || '').trim();
    if (!name) return;
    setCreatingCreatorFor(id);
    try {
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          source: 'launcher',
          stage: 'sourced',
          status: 'prospect',
          notes: 'Created from the ad launcher to preserve launch attribution.',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Creator create failed (${response.status})`);
      const creator = data.creator;
      setCreators(prev => [creator, ...prev.filter(item => Number(item.id) !== Number(creator.id))]);
      updateMeta(id, {
        creator: creator.name,
        creatorId: creator.id,
        deliverableId: null,
        sourceType: 'external_creator',
        sourceLabel: creator.name,
        creatorMatch: {
          confidence: 'manual',
          reason: 'Created from launcher',
        },
      });
      loadCreatorDeliverables(creator.id);
      setOpenCreatorPickerId(null);
    } catch (err) {
      setItemStatus(id, 'error', err.message || 'Could not create creator');
    } finally {
      setCreatingCreatorFor('');
    }
  };
  const creatorOptionsFor = useCallback((value) => {
    const needle = normalizedWords(value);
    const scored = creators.map(creator => {
      const name = normalizedWords(creator.name);
      const handles = creatorHandles(creator).map(handle => normalizedWords(String(handle).replace(/^@/, '')));
      const exact = needle && (name === needle || handles.some(handle => handle === needle));
      const starts = needle && (name.startsWith(needle) || handles.some(handle => handle.startsWith(needle)));
      const contains = needle && (name.includes(needle) || handles.some(handle => handle.includes(needle)));
      return { creator, score: exact ? 3 : starts ? 2 : contains ? 1 : needle ? 0 : 1 };
    }).filter(item => item.score > 0);
    scored.sort((a, b) => b.score - a.score || a.creator.name.localeCompare(b.creator.name));
    return scored.slice(0, 8).map(item => item.creator);
  }, [creators]);

  // Seed defaults for new drive files using folder-aware creator extraction.
  useEffect(() => {
    setMeta(prev => {
      const next = { ...prev };
      for (const f of driveItems) {
        const id = `drive:${f.id}`;
        if (!next[id]) {
          const topFolder = f.kind === 'pair' ? f.folderName : (f.folderPath || '').split(' / ')[0];
          const filePrefix = (f.name || '').split(/[_\-\s]/)[0] || '';
          const assetName = f.kind === 'pair'
            ? `${f.folderName || ''} ${f.feed?.name || ''} ${f.story?.name || ''}`.trim()
            : `${f.folderPath || ''} ${f.name || ''}`.trim();
          const suggestion = autoMatchCreator(assetName);
          const creatorName = suggestion?.creatorName || topFolder || filePrefix || config.defaultCreator;
          const creator = suggestion ? { id: suggestion.creatorId, name: suggestion.creatorName } : findCreatorByName(creatorName);
          const productCopy = defaultProductCopy(config.defaultProduct);
          next[id] = {
            creator: creator?.name || creatorName,
            creatorId: creator?.id || null,
            sourceType: 'external_creator',
            sourceLabel: creator?.name || creatorName,
            creatorMatch: suggestion,
            productId: config.defaultProduct,
            destUrl: destUrlFor(config.defaultProduct),
            urlParams: config.defaultUrlParams || DEFAULT_URL_PARAMS,
            headline: productCopy.headline,
            primaryText: productCopy.primaryText,
          };
        } else if (next[id].creator && !next[id].creatorId) {
          const assetName = f.kind === 'pair'
            ? `${f.folderName || ''} ${f.feed?.name || ''} ${f.story?.name || ''}`.trim()
            : `${f.folderPath || ''} ${f.name || ''}`.trim();
          const suggestion = autoMatchCreator(assetName);
          const creator = suggestion ? { id: suggestion.creatorId, name: suggestion.creatorName } : findCreatorByName(next[id].creator);
          if (creator) next[id] = {
            ...next[id],
            creator: creator.name,
            creatorId: creator.id,
            sourceType: 'external_creator',
            sourceLabel: creator.name,
            creatorMatch: suggestion || next[id].creatorMatch || { confidence: 'exact', reason: 'Matched saved creator name' },
          };
        }
      }
      // seed cart defaults from item.hook / item.body if user hasn't edited
      for (const c of cart) {
        const id = `cart:${c.id}`;
        if (!next[id]) {
          const suggestion = c.creatorId ? null : autoMatchCreator(`${c.creator || ''} ${c.name || ''} ${c.title || ''} ${c.sourceLabel || ''}`.trim());
          const productCopy = defaultProductCopy(config.defaultProduct);
          next[id] = {
            creator: c.creator || suggestion?.creatorName || config.defaultCreator || 'Static Builder',
            creatorId: c.creatorId || suggestion?.creatorId || null,
            sourceType: c.creatorId || suggestion ? 'external_creator' : (c.sourceType || 'tool_generated'),
            sourceLabel: c.sourceLabel || c.creator || suggestion?.creatorName || 'In-app builder',
            creatorMatch: suggestion,
            briefId: c.briefId || null,
            deliverableId: c.deliverableId || null,
            productId: config.defaultProduct,
            destUrl: c.destUrl || destUrlFor(config.defaultProduct),
            urlParams: c.urlParams || config.defaultUrlParams || DEFAULT_URL_PARAMS,
            headline: c.hook || productCopy.headline,
            primaryText: c.body || productCopy.primaryText,
          };
        }
      }
      for (const id of Object.keys(next)) {
        if (next[id].headline?.trim() || next[id].primaryText?.trim()) continue;
        const productId = next[id].productId || config.defaultProduct;
        const productCopy = defaultProductCopy(productId);
        next[id] = {
          ...next[id],
          productId,
          headline: productCopy.headline,
          primaryText: productCopy.primaryText,
        };
      }
      return next;
    });
  }, [driveItems, cart, config.defaultCreator, config.defaultProduct, findCreatorByName, autoMatchCreator]);

  // ── unified queue ─────────────────────────────────────────────────────
  const queue = useMemo(() => {
    const driveRows = driveItems.map(f => ({ unifiedId: `drive:${f.id}`, source: 'drive', ...f }));
    const cartRows = cart.filter(c => c.metaStatus !== 'pushed').map(c => ({ unifiedId: `cart:${c.id}`, source: 'cart', ...c }));
    return [...driveRows, ...cartRows];
  }, [driveItems, cart]);

  const [selectedItems, setSelectedItems] = useState(() => new Set(ls(LS_SELECTED, [])));
  const [focusedItemId, setFocusedItemId] = useState(null);
  useEffect(() => {
    const available = new Set(queue.map(item => item.unifiedId));
    setSelectedItems(prev => {
      const next = new Set([...prev].filter(id => available.has(id)));
      lsSet(LS_SELECTED, [...next]);
      return next;
    });
  }, [queue]);
  const toggleSelected = (id) => {
    setFocusedItemId(id);
    if (selectedAdsetId === '__new__') setNewAdsetNameEdited(false);
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      lsSet(LS_SELECTED, [...next]);
      return next;
    });
  };
  const selectedQueue = useMemo(() => queue.filter(item => selectedItems.has(item.unifiedId)), [queue, selectedItems]);

  // ── per-item launch status / streaming timeline ───────────────────────
  const [statuses, setStatuses] = useState({}); // unifiedId -> { status, message, steps, currentStep }
  const [globalError, setGlobalError] = useState('');
  const setStep = (id, stepKey, status, detail = '') => {
    setStatuses(prev => {
      const cur = prev[id] || {};
      const steps = { ...(cur.steps || {}), [stepKey]: { status, detail } };
      return { ...prev, [id]: { ...cur, steps, currentStep: status === 'running' ? stepKey : cur.currentStep } };
    });
  };
  const setItemStatus = (id, status, message = '') => {
    setStatuses(prev => ({ ...prev, [id]: { ...(prev[id] || {}), status, message } }));
  };

  // ── Drive launch (streams NDJSON from /api/drive/ugc) ─────────────────
  const nameContext = (item, index = 1) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    const product = PRODUCTS.find(p => p.id === m.productId)?.name || m.productId || 'Product';
    return {
      creator: m.creator || m.sourceLabel || (item.source === 'cart' ? 'Static Builder' : 'Creator'),
      product,
      asset: assetLabel(item),
      date: todayISO(),
      source: item.source === 'drive' ? 'Drive' : 'Cart',
      index,
    };
  };

  const buildNamesForItem = (item, index = 1) => {
    const ctx = nameContext(item, index);
    return {
      adsetName: applyNameTemplate(config.adsetNameTemplate || DEFAULT_LAUNCHER_CONFIG.adsetNameTemplate, ctx),
      adName: applyNameTemplate(config.adNameTemplate || DEFAULT_LAUNCHER_CONFIG.adNameTemplate, ctx) || buildAdName({ creator: ctx.creator, productId: meta[item.unifiedId]?.productId }),
    };
  };
  const focusedItem = useMemo(() => queue.find(item => item.unifiedId === focusedItemId) || selectedQueue[0] || null, [queue, focusedItemId, selectedQueue]);
  const focusedAdsetName = focusedItem ? buildNamesForItem(focusedItem).adsetName : '';
  const destUrlForMeta = (m = {}) => normalizedDestUrlFor(m.productId, m.destUrl);
  const urlParamsForMeta = (m = {}) => cleanUrlParams(m.urlParams ?? config.defaultUrlParams ?? DEFAULT_URL_PARAMS);
  const clearLaunchedItem = (item) => {
    const id = item.unifiedId;
    if (item.source === 'drive') {
      const ids = item.kind === 'pair' ? [item.feed?.id, item.story?.id].filter(Boolean) : [item.id];
      setDriveItems(prev => prev.filter(d => !driveItemIncludesAnyId(d, ids)));
    }
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.delete(id);
      lsSet(LS_SELECTED, [...next]);
      return next;
    });
    setFocusedItemId(current => current === id ? null : current);
    setMeta(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  useEffect(() => {
    if (selectedAdsetId !== '__new__' || newAdsetNameEdited || !focusedAdsetName) return;
    setNewAdset(prev => prev.name === focusedAdsetName ? prev : { ...prev, name: focusedAdsetName });
  }, [selectedAdsetId, newAdsetNameEdited, focusedAdsetName]);

  const launchDriveItem = async (item, options = {}) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    const attribution = sourceConfig(m.sourceType || 'external_creator');
    const adsetId = options.adsetId || selectedAdsetId;
    if (!adsetId || adsetId === '__new__') return setGlobalError('Pick an ad set first.');
    const productUrl = destUrlForMeta(m);
    if (!productUrl) return setItemStatus(id, 'error', 'Add an ad URL before launching');
    if (attribution.requiresCreator && !m.creatorId) return setItemStatus(id, 'error', 'Choose an exact creator record before launching creator UGC');
    if (attribution.requiresLabel && !(m.sourceLabel || m.creator)?.trim()) return setItemStatus(id, 'error', 'Add the internal/founder name before launching');
    if (!m.headline?.trim() && !m.primaryText?.trim()) return setItemStatus(id, 'error', 'Headline or primary text required');

    setItemStatus(id, 'pushing', '');
    setStatuses(prev => ({ ...prev, [id]: { status: 'pushing', steps: {}, currentStep: null } }));

    const adName = options.adName || buildNamesForItem(item, options.index || 1).adName;
    const body = {
      action: 'launch_meta_ad',
      adsetId,
      pageId: config.pageId.trim(),
      instagramUserId: (config.instagramUserId || '').trim(),
      destUrl: productUrl,
      urlParams: urlParamsForMeta(m),
      adName,
      headline: m.headline?.trim() || '',
      primaryText: m.primaryText?.trim() || '',
      creator: (m.creator || m.sourceLabel || attribution.label).trim(),
      creatorId: attribution.requiresCreator ? (m.creatorId || null) : null,
      sourceType: m.sourceType || 'external_creator',
      sourceLabel: (m.sourceLabel || m.creator || attribution.label).trim(),
      productId: m.productId || '',
      campaignId: selectedCampaignId,
    };
    if (item.kind === 'pair') body.pair = { feedFileId: item.feed.id, storyFileId: item.story.id };
    else body.fileId = item.id;

    try {
      const r = await fetch('/api/drive/ugc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.body) throw new Error('No response stream');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let final = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.done) { final = evt; continue; }
          if (evt.step) {
            // Pair launches emit step_feed and step_story; collapse to base step + detail.
            const baseMatch = evt.step.match(/^(drive_download|meta_upload|meta_thumbnail)_(feed|story)$/);
            const baseStep = baseMatch ? baseMatch[1] : evt.step;
            const role = baseMatch ? ` (${baseMatch[2]})` : '';
            const detail = (evt.detail ? `${evt.detail}${role}` : role.trim()) || '';
            const status = evt.status === 'start' ? 'running' : evt.status === 'done' ? 'done' : evt.status === 'error' ? 'error' : evt.status;
            setStep(id, baseStep, status, detail);
          }
        }
      }
      if (final?.error) {
        setItemStatus(id, 'error', final.error);
        return null;
      } else if (final?.adId) {
        setItemStatus(id, 'success', `Ad ${final.adId}`);
        clearLaunchedItem(item);
        return final.adId;
      }
    } catch (err) {
      setItemStatus(id, 'error', err.message);
      return null;
    }
  };

  // ── Cart launch (3 calls to /api/meta) ────────────────────────────────
  const launchCartItem = async (item, options = {}) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    const attribution = sourceConfig(m.sourceType || (m.creatorId ? 'external_creator' : 'tool_generated'));
    const adsetId = options.adsetId || selectedAdsetId;
    if (!adsetId || adsetId === '__new__') return setGlobalError('Pick an ad set first.');
    if (!config.pageId.trim()) return setGlobalError('Pick a Facebook Page.');
    const productUrl = destUrlForMeta(m);
    if (!productUrl) return setItemStatus(id, 'error', 'Add an ad URL before launching');
    if (!m.headline?.trim()) return setItemStatus(id, 'error', 'Headline required');
    if (attribution.requiresCreator && !m.creatorId) return setItemStatus(id, 'error', 'Choose an exact creator record before launching creator UGC');
    if (attribution.requiresLabel && !(m.sourceLabel || m.creator)?.trim()) return setItemStatus(id, 'error', 'Add the internal/founder name before launching');

    setStatuses(prev => ({ ...prev, [id]: { status: 'pushing', steps: {}, currentStep: null } }));
    const adName = options.adName || buildNamesForItem(item, options.index || 1).adName;
    const mimeType = item.type === 'video' ? 'video/mp4' : 'image';
    const hasFeedImage = !!(item.squareUrl || item.url);
    const isPairedImage = hasFeedImage && !!item.storyUrl && item.type !== 'video';

    try {
      // Paired callout image — upload both, create one creative with asset_feed_spec.
      if (isPairedImage) {
        setStep(id, 'meta_upload', 'running');
        const [feedUp, storyUp] = await Promise.all([
          fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload_image', imageBase64: item.squareUrl || item.url }) }).then(r => r.json()),
          fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload_image', imageBase64: item.storyUrl }) }).then(r => r.json()),
        ]);
        if (feedUp.error) throw new Error(`Feed image upload: ${feedUp.error}`);
        if (storyUp.error) throw new Error(`Story image upload: ${storyUp.error}`);
        setStep(id, 'meta_upload', 'done');

        setStep(id, 'meta_creative', 'running');
        const pr = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'create_paired_image_ad',
          feedImageHash: feedUp.hash,
          storyImageHash: storyUp.hash,
          adName,
          headline: m.headline,
          primaryText: m.primaryText || m.headline,
          destUrl: productUrl,
          urlParams: urlParamsForMeta(m),
          adsetId,
          pageId: config.pageId,
          instagramUserId: (config.instagramUserId || '').trim() || undefined,
          creator: m.creator || 'Static Builder',
          creatorId: attribution.requiresCreator ? (m.creatorId || null) : null,
          sourceType: attribution.value,
          sourceLabel: m.sourceLabel || m.creator || attribution.label,
          briefId: m.briefId || item.briefId || null,
          deliverableId: m.deliverableId || item.deliverableId || null,
          sourceVideoUrl: item.sourceVideoUrl || null,
        }) });
        const pd = await pr.json();
        if (pd.error) { setStep(id, 'meta_creative', 'error', pd.error); throw new Error(pd.error); }
        setStep(id, 'meta_creative', 'done');
        setStep(id, 'meta_ad', 'done', pd.adId);
        setItemStatus(id, 'success', `Ad ${pd.adId}`);
        onUpdateCartItem?.(item.id, { metaStatus: 'pushed', metaPushedAt: Date.now() });
        clearLaunchedItem(item);
        return pd.adId;
      }

      // 1. Upload asset
      setStep(id, 'meta_upload', 'running');
      const creativeBody = {
        action: 'create_creative',
        adName,
        headline: m.headline,
        primaryText: m.primaryText || m.headline,
        destUrl: productUrl,
        urlParams: urlParamsForMeta(m),
        pageId: config.pageId,
        instagramUserId: (config.instagramUserId || '').trim() || undefined,
      };
      if (item.type === 'video') {
        const remoteVideo = /^https:\/\//i.test(item.videoUrl || '');
        const ur = await fetch('/api/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remoteVideo
            ? { action: 'upload_video_url', videoUrl: item.videoUrl, name: item.name }
            : { action: 'upload_video', videoBase64: item.videoUrl, name: item.name }),
        });
        const ud = await ur.json();
        if (ud.error) throw new Error(`Video upload: ${ud.error}`);
        creativeBody.videoId = ud.videoId;
      } else {
        const imgData = item.squareUrl || item.url;
        const ur = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload_image', imageBase64: imgData }) });
        const ud = await ur.json();
        if (ud.error) throw new Error(`Image upload: ${ud.error}`);
        creativeBody.imageHash = ud.hash;
      }
      setStep(id, 'meta_upload', 'done');

      // 2. Create creative
      setStep(id, 'meta_creative', 'running');
      const cr = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creativeBody) });
      const cd = await cr.json();
      if (cd.error) { setStep(id, 'meta_creative', 'error', cd.error); throw new Error(cd.error); }
      setStep(id, 'meta_creative', 'done');

      // 3. Create ad
      setStep(id, 'meta_ad', 'running');
      const ar = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_ad_from_creative',
          creativeId: cd.creativeId,
          adName,
          adsetId,
          headline: m.headline,
          primaryText: m.primaryText || m.headline,
          destUrl: productUrl,
          urlParams: urlParamsForMeta(m),
          mimeType,
          creator: m.creator || 'Static Builder',
          creatorId: attribution.requiresCreator ? (m.creatorId || null) : null,
          sourceType: attribution.value,
          sourceLabel: m.sourceLabel || m.creator || attribution.label,
          briefId: m.briefId || item.briefId || null,
          deliverableId: m.deliverableId || item.deliverableId || null,
          sourceVideoUrl: item.sourceVideoUrl || null,
        }),
      });
      const ad = await ar.json();
      if (ad.error) { setStep(id, 'meta_ad', 'error', ad.error); throw new Error(ad.error); }
      setStep(id, 'meta_ad', 'done', ad.adId);
      setItemStatus(id, 'success', `Ad ${ad.adId}`);
      onUpdateCartItem?.(item.id, { metaStatus: 'pushed', metaPushedAt: Date.now() });
      clearLaunchedItem(item);
      return ad.adId;
    } catch (err) {
      setItemStatus(id, 'error', err.message);
      return null;
    }
  };

  const launch = (item, options = {}) => item.source === 'drive' ? launchDriveItem(item, options) : launchCartItem(item, options);

  const launchIssuesForItem = (item) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    const issues = [];
    const attribution = sourceConfig(m.sourceType || (item.source === 'drive' ? 'external_creator' : (m.creatorId ? 'external_creator' : 'tool_generated')));
    const destination = destUrlForMeta(m);
    const destinationProduct = productForDestination(destination);

    if ((statuses[id] || {}).status === 'pushing') issues.push('Launch is already in progress.');
    if (!config.pageId.trim()) issues.push('Pick a Facebook Page.');
    if (!selectedCampaignId || selectedCampaignId === '__new__') issues.push('Pick a campaign.');
    if ((config.namingMode || 'batch_adsets') === 'existing_adset' && (!selectedAdsetId || selectedAdsetId === '__new__')) {
      issues.push('Pick an ad set.');
    }
    if ((config.namingMode || 'batch_adsets') !== 'existing_adset' && !(Number(batchAdsetBudget) > 0)) {
      issues.push('Enter a valid ad set budget.');
    }
    if (!m.productId) issues.push('Pick a product.');
    if (!destination) issues.push('Add an ad URL.');
    else if (!validHttpUrl(destination)) issues.push('Enter a valid http or https ad URL.');
    else if (destinationProduct && destinationProduct.id !== m.productId) {
      issues.push(`The ad URL belongs to ${destinationProduct.name}, not ${PRODUCTS.find(product => product.id === m.productId)?.name || 'the selected product'}.`);
    }
    if (item.source === 'drive' && !m.headline?.trim() && !m.primaryText?.trim()) issues.push('Add a headline or primary text.');
    if (item.source !== 'drive' && !m.headline?.trim()) issues.push('Add a headline.');
    if (attribution.requiresCreator && !m.creatorId) issues.push('Choose an exact creator record.');
    if (attribution.requiresLabel && !(m.sourceLabel || m.creator)?.trim()) issues.push('Add the person responsible for this creative.');
    return issues;
  };

  const launchWarningsForItem = (item) => {
    const m = meta[item.unifiedId] || {};
    const warnings = getCopyWarnings({
      headline: m.headline || '',
      primaryText: m.primaryText || '',
      productIds: m.productId ? [m.productId] : [],
    });
    if (!m.primaryText?.trim()) warnings.push('Primary text is blank and will fall back to the headline.');
    const canonicalUrl = destUrlFor(m.productId);
    const destination = destUrlForMeta(m);
    if (destination && canonicalUrl && destination.replace(/\/$/, '') !== canonicalUrl.replace(/\/$/, '')) {
      warnings.push('This creative uses a custom destination URL.');
    }
    return warnings;
  };

  const launchWithAdsetForItem = async (item, index = 1) => {
    if (!selectedCampaignId || selectedCampaignId === '__new__') throw new Error('Pick a campaign first.');
    if (!config.pageId.trim()) throw new Error('Pick a Facebook Page.');
    const names = buildNamesForItem(item, index);
    const oneAdsetPerItem = config.namingMode !== 'existing_adset';
    let adsetId = selectedAdsetId;
    if (oneAdsetPerItem) {
      setItemStatus(item.unifiedId, 'pushing', `Creating ad set: ${names.adsetName}`);
      adsetId = await createAdsetRequest({ name: names.adsetName, budget: batchAdsetBudget, select: false });
    } else if (!adsetId || adsetId === '__new__') {
      throw new Error('Pick an ad set or switch launch structure to one ad set per creative.');
    }
    return launch(item, { adsetId, adName: names.adName, index });
  };

  const launchOne = async (item) => {
    setGlobalError('');
    const issues = launchIssuesForItem(item);
    if (issues.length) return setGlobalError(issues[0]);
    setBatchLaunching(true);
    try {
      await launchWithAdsetForItem(item, 1);
      if (config.namingMode !== 'existing_adset') await loadAdsets(selectedCampaignId);
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setBatchLaunching(false);
    }
  };

  const canLaunchItem = (item) => {
    return launchIssuesForItem(item).length === 0;
  };
  const selectedLaunchReadyCount = selectedQueue.filter(canLaunchItem).length;

  const launchSelected = async (requestedItems = null) => {
    setGlobalError('');
    const items = (requestedItems || selectedQueue).filter(canLaunchItem);
    if (!items.length) return setGlobalError('Select at least one launch-ready item.');
    if (!selectedCampaignId || selectedCampaignId === '__new__') return setGlobalError('Pick a campaign first.');
    if (!config.pageId.trim()) return setGlobalError('Pick a Facebook Page.');
    const oneAdsetPerItem = config.namingMode !== 'existing_adset';
    if (!oneAdsetPerItem && (!selectedAdsetId || selectedAdsetId === '__new__')) return setGlobalError('Pick an ad set or switch batch mode to one ad set per creative.');
    setBatchLaunching(true);
    try {
      for (let i = 0; i < items.length; i++) {
        await launchWithAdsetForItem(items[i], i + 1);
      }
      if (oneAdsetPerItem) await loadAdsets(selectedCampaignId);
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setBatchLaunching(false);
    }
  };

  // ── drive-only actions: hide from inbox, open in Drive ────────────────
  const [pairingSourceId, setPairingSourceId] = useState(null);
  const pairingSource = useMemo(() => driveItems.find(item => item.kind === 'single' && item.id === pairingSourceId) || null, [driveItems, pairingSourceId]);

  const associateDrivePair = async (source, target) => {
    if (!source || !target || source.id === target.id) {
      setPairingSourceId(null);
      return;
    }
    const { feed, story } = orderDrivePair(source, target);
    try {
      const response = await fetch('/api/drive/ugc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'associate_pair',
          feedFileId: feed.id,
          storyFileId: story.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Pair failed (${response.status})`);
      setPairingSourceId(null);
      await refreshDrive();
    } catch (err) {
      setGlobalError(err.message || 'Could not pair assets');
    }
  };

  const unpairDriveItem = async (item) => {
    if (item.source !== 'drive' || item.kind !== 'pair') return;
    try {
      const response = await fetch('/api/drive/ugc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unpair',
          feedFileId: item.feed?.id,
          storyFileId: item.story?.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Unpair failed (${response.status})`);
      await refreshDrive();
    } catch (err) {
      setGlobalError(err.message || 'Could not unpair assets');
    }
  };

  const hideDriveFile = async (fileId) => {
    if (!confirm('Hide this file from the inbox? (file stays in Drive)')) return;
    try {
      await fetch('/api/drive/ugc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', fileId }) });
      setDriveItems(prev => prev.filter(d => d.id !== fileId));
    } catch (err) { console.error(err); }
  };

  // Mark an already-launched (outside this tool) Drive file as launched:
  // renames with __LAUNCHED__{adId} and moves to Launched/ folder, then drops from inbox.
  const markDriveLaunched = async (item) => {
    const adId = prompt('Meta ad ID (or leave blank to use "MANUAL"):', 'MANUAL');
    if (adId === null) return;
    const ids = item.kind === 'pair' ? [item.feed.id, item.story.id] : [item.id];
    const id = item.unifiedId;
    const m = meta[id] || {};
    const names = buildNamesForItem(item);
    const productUrl = destUrlForMeta(m);
    const attribution = sourceConfig(m.sourceType || 'external_creator');
    try {
      for (let i = 0; i < ids.length; i++) {
        const fileId = ids[i];
        const r = await fetch('/api/drive/ugc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mark_launched',
            fileId,
            adId: adId || 'MANUAL',
            logLaunch: i === 0,
            placementRole: item.kind === 'pair' ? (i === 0 ? 'feed' : 'story') : 'single',
            adName: names.adName,
            adsetId: selectedAdsetId && selectedAdsetId !== '__new__' ? selectedAdsetId : null,
            campaignId: selectedCampaignId && selectedCampaignId !== '__new__' ? selectedCampaignId : null,
            driveFileName: item.kind === 'pair' ? `${item.feed.name} + ${item.story.name}` : item.name,
            creator: (m.creator || m.sourceLabel || attribution.label || '').trim(),
            creatorId: attribution.requiresCreator ? (m.creatorId || null) : null,
            sourceType: m.sourceType || 'external_creator',
            sourceLabel: (m.sourceLabel || m.creator || attribution.label || '').trim(),
            briefId: m.briefId || item.briefId || null,
            deliverableId: m.deliverableId || item.deliverableId || null,
            productId: m.productId || '',
            angleId: m.angleId || item.angleId || null,
            headline: m.headline || '',
            primaryText: m.primaryText || '',
            destUrl: productUrl || '',
            urlParams: urlParamsForMeta(m),
          }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `mark_launched failed (${r.status})`);
        }
      }
      setDriveItems(prev => prev.filter(d => !driveItemIncludesAnyId(d, ids)));
      setSelectedItems(prev => {
        const next = new Set(prev);
        next.delete(id);
        lsSet(LS_SELECTED, [...next]);
        return next;
      });
    } catch (err) {
      alert(`Mark launched failed: ${err.message}`);
    }
  };

  // ── library (saved variants) ──────────────────────────────────────────
  const library = useCopyLibrary();
  const [openCreatorPickerId, setOpenCreatorPickerId] = useState(null);
  const [creatingCreatorFor, setCreatingCreatorFor] = useState('');
  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkCopyIndex, setBulkCopyIndex] = useState('');
  const [preflightIds, setPreflightIds] = useState([]);
  const selectedProductIds = [...new Set(selectedQueue.map(item => meta[item.unifiedId]?.productId).filter(Boolean))];
  const effectiveBulkProductId = bulkProductId || (selectedProductIds.length === 1 ? selectedProductIds[0] : '');
  const bulkCopyOptions = effectiveBulkProductId ? launcherCopyOptions(effectiveBulkProductId, library.variants) : [];
  const preflightItems = preflightIds.map(id => queue.find(item => item.unifiedId === id)).filter(Boolean);

  useEffect(() => {
    if (!preflightIds.length) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setPreflightIds([]);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [preflightIds.length]);

  const applyProductToSelected = () => {
    if (!bulkProductId || !selectedQueue.length) return;
    const productCopy = defaultProductCopy(bulkProductId);
    setMeta(prev => {
      const next = { ...prev };
      selectedQueue.forEach(item => {
        const current = next[item.unifiedId] || {};
        next[item.unifiedId] = {
          ...current,
          productId: bulkProductId,
          destUrl: destUrlFor(bulkProductId),
          ...(shouldAutoReplaceCopy(current) ? {
            headline: productCopy.headline,
            primaryText: productCopy.primaryText,
          } : {}),
        };
      });
      return next;
    });
    setBulkCopyIndex('');
  };

  const applyCopyToSelected = () => {
    const option = bulkCopyOptions[Number(bulkCopyIndex)];
    if (!option || !selectedQueue.length) return;
    setMeta(prev => {
      const next = { ...prev };
      selectedQueue.forEach(item => {
        next[item.unifiedId] = {
          ...next[item.unifiedId],
          headline: option.headline,
          primaryText: option.primaryText,
        };
      });
      return next;
    });
  };

  const requestPreflight = (items) => {
    const ready = items.filter(canLaunchItem);
    if (!ready.length) {
      const firstIssue = items[0] ? launchIssuesForItem(items[0])[0] : 'Select at least one launch-ready creative.';
      setGlobalError(firstIssue || 'Select at least one launch-ready creative.');
      return;
    }
    setGlobalError('');
    setPreflightIds(ready.map(item => item.unifiedId));
  };

  const confirmPreflight = async () => {
    const items = [...preflightItems];
    setPreflightIds([]);
    if (items.length === 1) await launchOne(items[0]);
    else await launchSelected(items);
  };

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="launcher-tool" style={S.wrap}>
      <h1 style={S.h1}>Launcher</h1>
      <p style={S.sub}>Drive UGC and in-app generated creatives in one place. Settings apply to every launch.</p>

      {/* SETTINGS PANEL */}
      <div style={S.settings}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={S.label}>Facebook Page</label>
            <PagePicker value={config.pageId} onChange={(id) => updateConfig({ pageId: id })} />
          </div>
          <div>
            <label style={S.label}>Instagram Account</label>
            <InstagramAccountPicker value={config.instagramUserId} onChange={(id) => updateConfig({ instagramUserId: id })} />
          </div>
          <div>
            <label style={S.label}>Default Creator</label>
            <input style={S.input} value={config.defaultCreator} onChange={e => updateConfig({ defaultCreator: e.target.value })} placeholder="e.g. Austin" />
          </div>
          <div>
            <label style={S.label}>Default Product</label>
            <select style={S.select} value={config.defaultProduct} onChange={e => updateConfig({ defaultProduct: e.target.value })}>
              {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Default Pixel ID</label>
            <input style={S.input} value={config.defaultPixelId} onChange={e => updateConfig({ defaultPixelId: e.target.value })} placeholder="Meta pixel ID for sales optimization" />
          </div>
          <div>
            <label style={S.label}>Default Objective</label>
            <select style={S.select} value={config.defaultObjective} onChange={e => updateConfig({ defaultObjective: e.target.value })}>
              {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Default URL parameters</label>
            <input
              style={S.input}
              value={config.defaultUrlParams || ''}
              onChange={e => updateConfig({ defaultUrlParams: cleanUrlParams(e.target.value) })}
              placeholder={DEFAULT_URL_PARAMS}
            />
          </div>
        </div>

        <div style={{ ...S.divider, margin: '16px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={S.label}>Campaign</label>
            {!campaignsLoaded ? (
              <button onClick={loadCampaigns} disabled={loadingCampaigns} style={S.ghost}>
                {loadingCampaigns ? 'Loading…' : 'Load campaigns'}
              </button>
            ) : (
              <select style={S.select} value={selectedCampaignId} onChange={e => { setSelectedCampaignId(e.target.value); setSelectedAdsetId(''); }}>
                <option value="">— Pick a campaign —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">+ New campaign</option>
              </select>
            )}
          </div>
          <div>
            <label style={S.label}>Ad set</label>
            <select style={S.select} value={selectedAdsetId} onChange={e => setSelectedAdsetId(e.target.value)} disabled={!selectedCampaignId || selectedCampaignId === '__new__'}>
              <option value="">{loadingAdsets ? 'Loading…' : '— Pick an ad set —'}</option>
              {adsets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="__new__">+ New ad set</option>
            </select>
          </div>
        </div>

        <div style={{ ...S.divider, margin: '16px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={S.label}>Launch structure</label>
            <select style={S.select} value={config.namingMode || 'batch_adsets'} onChange={e => updateConfig({ namingMode: e.target.value })}>
              <option value="batch_adsets">One new ad set per creative</option>
              <option value="existing_adset">Use selected ad set</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Ad set name template</label>
            <input style={S.input} value={config.adsetNameTemplate || ''} onChange={e => updateConfig({ adsetNameTemplate: e.target.value })} />
          </div>
          <div>
            <label style={S.label}>Ad name template</label>
            <input style={S.input} value={config.adNameTemplate || ''} onChange={e => updateConfig({ adNameTemplate: e.target.value })} />
          </div>
          <div>
            <label style={S.label}>Budget/ad set</label>
            <input style={S.input} type="number" min="1" step="1" value={batchAdsetBudget} onChange={e => setBatchAdsetBudget(e.target.value)} disabled={(config.namingMode || 'batch_adsets') === 'existing_adset'} />
          </div>
        </div>
        <div style={{ marginTop: 8, color: '#88857f', fontSize: 10 }}>
          Tokens: {'{creator}'}, {'{asset}'}, {'{product}'}, {'{date}'}, {'{source}'}, {'{index}'}.
          <button type="button" onClick={resetNamingDefaults} style={{ marginLeft: 10, padding: 0, border: 0, background: 'transparent', color: '#d84a17', font: 'inherit', cursor: 'pointer' }}>
            Reset naming defaults
          </button>
        </div>

        {selectedCampaignId === '__new__' && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed #dedbd3', borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={S.label}>Campaign name</label>
                <input style={S.input} placeholder="e.g. HOWL | UGC | Sales" value={newCampaign.name} onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Objective</label>
                <select style={S.select} value={newCampaign.objective} onChange={e => setNewCampaign({ ...newCampaign, objective: e.target.value })}>
                  {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Pixel ID</label>
                <input style={S.input} placeholder={config.defaultPixelId ? `default: ${config.defaultPixelId}` : 'Pixel ID (sales)'} value={newCampaign.pixelId} onChange={e => setNewCampaign({ ...newCampaign, pixelId: e.target.value })} />
              </div>
              <button onClick={createCampaign} disabled={creatingCampaign} style={S.btn(creatingCampaign)}>
                {creatingCampaign ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {selectedAdsetId === '__new__' && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed #dedbd3', borderRadius: 6 }}>
            <div style={{ marginBottom: 8, fontSize: 10, color: '#77746f' }}>
              Inherits objective <strong style={{ color: '#171717' }}>{effectiveObjective}</strong>
              {effectiveObjective === 'OUTCOME_SALES' && config.defaultPixelId && (
                <> · pixel <strong style={{ color: '#171717' }}>{config.defaultPixelId}</strong> · optimizing for <strong style={{ color: '#171717' }}>PURCHASE</strong></>
              )}
            </div>
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10, color: focusedItem ? '#171717' : '#88857f' }}>
              {focusedItem ? `Naming from selected creative: ${focusedAdsetName}` : 'Select a creative below to prefill the ad set name.'}
              <button
                type="button"
                disabled={!focusedAdsetName}
                onClick={() => {
                  if (!focusedAdsetName) return;
                  setNewAdset(prev => ({ ...prev, name: focusedAdsetName }));
                  setNewAdsetNameEdited(false);
                }}
                style={{ ...S.ghost, padding: '5px 9px', fontSize: 9 }}
              >
                Use selected
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={S.label}>Ad set name</label>
                <input style={S.input} placeholder={focusedAdsetName || 'Select a creative below'} value={newAdset.name} onChange={e => { setNewAdsetNameEdited(true); setNewAdset({ ...newAdset, name: e.target.value }); }} />
              </div>
              <div>
                <label style={S.label}>Daily budget ($)</label>
                <input style={S.input} type="number" min="1" step="1" placeholder="50" value={newAdset.budget} onChange={e => setNewAdset({ ...newAdset, budget: e.target.value })} />
              </div>
              <button onClick={createAdset} disabled={creatingAdset} style={S.btn(creatingAdset)}>
                {creatingAdset ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      <CopyLibrary
        library={library}
        onUse={focusedItemId ? (v) => updateMeta(focusedItemId, { headline: v.headline || '', primaryText: v.primaryText || '' }) : null}
      />

      {/* QUEUE TOOLBAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0', flexWrap: 'wrap' }}>
        <button onClick={refreshDrive} disabled={loadingDrive} style={S.ghost}>
          {loadingDrive ? 'Refreshing…' : 'Refresh from Drive'}
        </button>
        <button onClick={() => {
          const next = new Set(queue.map(item => item.unifiedId));
          setSelectedItems(next);
          lsSet(LS_SELECTED, [...next]);
        }} style={S.ghost}>
          Select all
        </button>
        <button onClick={() => {
          setSelectedItems(new Set());
          lsSet(LS_SELECTED, []);
        }} style={S.ghost}>
          Clear
        </button>
        <button onClick={() => requestPreflight(selectedQueue)} disabled={batchLaunching || selectedLaunchReadyCount === 0} style={S.btn(batchLaunching || selectedLaunchReadyCount === 0)}>
          {batchLaunching ? 'Launching…' : `Launch ready (${selectedLaunchReadyCount})`}
        </button>
        <div style={{ fontSize: 11, color: '#77746f' }}>
          {queue.length} item{queue.length === 1 ? '' : 's'} ·
          <span style={{ color: '#d84a17', marginLeft: 4 }}>{driveItems.length} Drive</span> ·
          <span style={{ color: '#256b35', marginLeft: 4 }}>{cart.filter(c => c.metaStatus !== 'pushed').length} Cart</span> ·
          <span style={{ color: '#171717', marginLeft: 4 }}>{selectedQueue.length} selected</span>
        </div>
        {pairingSource && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#171717' }}>
            Pairing <strong>{assetLabel(pairingSource)}</strong>
            <button type="button" onClick={() => setPairingSourceId(null)} style={{ ...S.ghost, padding: '5px 9px', fontSize: 9 }}>Cancel</button>
          </div>
        )}
      </div>

      {selectedQueue.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'flex-end', padding: 12, marginBottom: 14, border: '1px solid #dedbd3', borderRadius: 6, background: '#faf9f6' }}>
          <div>
            <label style={S.label}>Product for {selectedQueue.length} selected</label>
            <select style={S.select} value={bulkProductId} onChange={e => { setBulkProductId(e.target.value); setBulkCopyIndex(''); }}>
              <option value="">Choose product</option>
              {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={applyProductToSelected} disabled={!bulkProductId} style={S.ghost}>Apply product</button>
          <div>
            <label style={S.label}>Copy for {effectiveBulkProductId ? PRODUCTS.find(product => product.id === effectiveBulkProductId)?.name : 'selected product'}</label>
            <select style={S.select} value={bulkCopyIndex} onChange={e => setBulkCopyIndex(e.target.value)} disabled={!bulkCopyOptions.length}>
              <option value="">Choose copy option</option>
              {bulkCopyOptions.map((option, index) => (
                <option key={`${option.source}:${option.label}:${index}`} value={index}>{option.source}: {option.label} - {option.headline}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={applyCopyToSelected} disabled={bulkCopyIndex === ''} style={S.ghost}>Apply copy</button>
        </div>
      )}

      {globalError && <div style={S.err}>{globalError}</div>}
      {driveError && <div style={S.err}>Drive: {driveError}</div>}

      {!loadingDrive && queue.length === 0 && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#88857f', fontSize: 13 }}>
          The launcher is empty. Drop assets in the Drive UGC inbox, or generate creatives that land in the cart.
        </div>
      )}

      {queue.map(item => {
        const id = item.unifiedId;
        const m = meta[id] || {};
        const status = statuses[id] || { status: 'pending' };
        const stepDef = item.source === 'drive' ? DRIVE_STEPS : CART_STEPS;
        const attribution = sourceConfig(m.sourceType || (item.source === 'drive' ? 'external_creator' : (m.creatorId ? 'external_creator' : 'tool_generated')));
        const isCreatorLinked = Boolean(m.creatorId);
        const creatorMatch = m.creatorMatch;
        const launchIssues = launchIssuesForItem(item);
        const launchDisabled = batchLaunching || !canLaunchItem(item);

        return (
          <div className="launcher-queue-card" key={id} style={{ ...S.card, borderColor: selectedItems.has(id) ? '#d84a17' : '#dedbd3', boxShadow: selectedItems.has(id) ? 'inset 3px 0 #d84a17' : 'none' }}>
            {/* THUMB COL */}
            <div className="launcher-queue-thumb">
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, color: '#77746f', fontSize: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedItems.has(id)} onChange={() => toggleSelected(id)} style={{ accentColor: '#d84a17' }} />
                Include
              </label>
              {item.source === 'drive' ? (
                item.kind === 'pair' ? (
                  <div style={{ position: 'relative', width: 140, height: 140 }}>
                    <DriveThumb fileId={item.feed.id} alt="feed" style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, objectFit: 'cover', borderRadius: 4, border: '2px solid #fff', zIndex: 1 }}
                      fallback={<div style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, borderRadius: 4, background: '#f4f1ea', border: '2px solid #fff', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#88857f', fontSize: 9 }}>{item.feedAspect || 'Feed'}</div>}
                    />
                    <DriveThumb fileId={item.story.id} alt="story" style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, objectFit: 'cover', borderRadius: 4, border: '2px solid #fff', zIndex: 2 }}
                      fallback={<div style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, borderRadius: 4, background: '#f4f1ea', border: '2px solid #fff', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#88857f', fontSize: 9 }}>{item.storyAspect || 'Story'}</div>}
                    />
                  </div>
                ) : (
                  <DriveThumb fileId={item.id} alt={item.name} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 4 }}
                    fallback={<div style={S.thumbBox}>{(item.mimeType || '').startsWith('video/') ? <><div style={{ fontSize: 24 }}>▶</div><div>Video</div></> : 'Image'}</div>}
                  />
                )
              ) : (item.squareUrl || item.url) && item.storyUrl && item.type !== 'video' ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <img src={item.squareUrl || item.url} alt={`${item.name} 4:5`} style={{ width: 84, height: 105, objectFit: 'cover', borderRadius: 4 }} />
                  <img src={item.storyUrl} alt={`${item.name} 9:16`} style={{ width: 52, height: 92, objectFit: 'cover', borderRadius: 4 }} />
                </div>
              ) : (
                <img src={item.squareUrl || item.url} alt={item.name} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 4 }} />
              )}
            </div>

            {/* META COL */}
            <div onClick={() => {
              setFocusedItemId(id);
              if (selectedAdsetId === '__new__') setNewAdsetNameEdited(false);
            }}>
              <div style={S.fileName}>
                {item.source === 'drive'
                  ? (item.kind === 'pair' ? (item.folderName || item.name) : item.name)
                  : (item.name || 'Untitled')}
                <span style={{ marginLeft: 8 }}>
                  {item.source === 'drive'
                    ? <span style={S.badge('#d84a17')}>Drive</span>
                    : <span style={S.badge('#256b35')}>Cart</span>}
                  {item.source === 'drive' && item.kind === 'pair' && (
                    <span style={{ marginLeft: 6, ...S.badge('#256b35') }}>{item.aspectLabel || 'Feed + Story'}</span>
                  )}
                  {item.source === 'drive' && item.kind === 'pair' && item.pairSource === 'manual' && (
                    <span style={{ marginLeft: 6, ...S.badge('#7357c7') }}>Manual</span>
                  )}
                  {item.source === 'drive' && item.kind === 'single' && driveSingleAspect(item) && (
                    <span style={{ marginLeft: 6, ...S.badge('#77746f') }}>{driveSingleAspect(item)}</span>
                  )}
                  {(item.squareUrl || item.url) && item.storyUrl && item.type !== 'video' && (
                    <span style={{ marginLeft: 6, ...S.badge('#256b35') }}>4:5 + 9:16</span>
                  )}
                </span>
              </div>
              {item.source === 'drive' && item.folderPath && (
                <div style={{ fontSize: 9, color: '#d84a17', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                  📁 {item.folderPath}
                </div>
              )}
              <div style={S.fileMeta}>
                {item.source === 'drive'
                  ? (item.kind === 'pair'
                      ? `${item.feed.mimeType} · ${item.feed.name} + ${item.story.name}`
                      : `${item.mimeType} · ${(parseInt(item.size || 0) / 1024 / 1024).toFixed(2)} MB`)
                  : (item.type || 'image')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div style={{ padding: '7px 8px', background: '#faf9f6', border: '1px solid #ebe8e1', borderRadius: 4, color: '#77746f', fontSize: 9, minWidth: 0 }}>
                  <strong style={{ display: 'block', color: '#171717', fontSize: 10, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{buildNamesForItem(item).adsetName}</strong>
                  Ad set preview
                </div>
                <div style={{ padding: '7px 8px', background: '#faf9f6', border: '1px solid #ebe8e1', borderRadius: 4, color: '#77746f', fontSize: 9, minWidth: 0 }}>
                  <strong style={{ display: 'block', color: '#171717', fontSize: 10, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{buildNamesForItem(item).adName}</strong>
                  Ad preview
                </div>
              </div>
              <div style={S.row}>
                <div>
                  <label style={S.label}>Source</label>
                  <select
                    style={S.select}
                    value={attribution.value}
                    onChange={e => {
                      const nextSource = sourceConfig(e.target.value);
                      updateMeta(id, {
                        sourceType: nextSource.value,
                        creatorId: nextSource.requiresCreator ? m.creatorId : null,
                        sourceLabel: nextSource.value === 'tool_generated' ? 'In-app builder' : (m.sourceLabel || m.creator || ''),
                      });
                    }}
                  >
                    {SOURCE_ATTRIBUTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, lineHeight: 1.35 }}>{attribution.hint}</div>
                </div>
                {attribution.requiresCreator ? (
                  <div style={{ position: 'relative' }}>
                    <label style={S.label}>Creator</label>
                    <input
                      style={{ ...S.input, paddingRight: 28 }}
                      value={m.creator || ''}
                      onFocus={() => setOpenCreatorPickerId(id)}
                      onBlur={() => setTimeout(() => setOpenCreatorPickerId(current => current === id ? null : current), 130)}
                      onChange={e => {
                        updateCreator(id, e.target.value);
                        setOpenCreatorPickerId(id);
                      }}
                      placeholder="Search creator"
                      autoComplete="off"
                    />
                    <span style={{ position: 'absolute', top: 29, right: 10, color: '#77746f', fontSize: 12, pointerEvents: 'none' }}>v</span>
                    {openCreatorPickerId === id && (() => {
                      const options = creatorOptionsFor(m.creator || '');
                      const typedName = (m.creator || '').trim();
                      const exactCreator = findCreatorByName(typedName);
                      const canCreate = typedName && !exactCreator;
                      return (
                        <div style={{
                          position: 'absolute',
                          zIndex: 30,
                          top: 58,
                          left: 0,
                          right: 0,
                          maxHeight: 286,
                          overflowY: 'auto',
                          background: '#fff',
                          border: '1px solid #d8d4ca',
                          borderRadius: 6,
                          boxShadow: '0 14px 35px rgba(45, 40, 30, .16)',
                          padding: 4,
                        }}>
                          {options.map(creator => {
                            const social = Array.isArray(creator.social_accounts)
                              ? creator.social_accounts.find(account => account?.handle)?.handle
                              : null;
                            return (
                              <button
                                type="button"
                                key={creator.id}
                                onMouseDown={e => {
                                  e.preventDefault();
                                  updateCreator(id, creator.name);
                                  setOpenCreatorPickerId(null);
                                }}
                                style={{
                                  width: '100%',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                  padding: '8px 9px',
                                  background: 'transparent',
                                  border: 0,
                                  borderRadius: 4,
                                  color: '#171717',
                                  fontFamily: 'inherit',
                                  fontSize: 11,
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creator.name}</span>
                                {social && <span style={{ flex: 'none', color: '#88857f', fontSize: 9 }}>{social}</span>}
                              </button>
                            );
                          })}
                          {!options.length && (
                            <div style={{ padding: '8px 9px', color: '#88857f', fontSize: 10 }}>
                              {creatorsError || 'No matching creator.'}
                            </div>
                          )}
                          {canCreate && (
                            <button
                              type="button"
                              disabled={creatingCreatorFor === id}
                              onMouseDown={e => {
                                e.preventDefault();
                                createCreatorFromLauncher(id);
                              }}
                              style={{
                                width: '100%',
                                marginTop: 4,
                                padding: '9px',
                                background: '#f4f1ea',
                                border: '1px solid #dedbd3',
                                borderRadius: 4,
                                color: '#d84a17',
                                fontFamily: 'inherit',
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 1.5,
                                textTransform: 'uppercase',
                                cursor: creatingCreatorFor === id ? 'wait' : 'pointer',
                              }}
                            >
                              {creatingCreatorFor === id ? 'Adding...' : `Add creator "${typedName}"`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {item.source === 'drive' && (
                      <div style={S.linkedHint(isCreatorLinked)}>
                        {isCreatorLinked
                          ? (creatorMatch?.reason ? `${creatorMatch.confidence === 'review' ? 'Review match' : 'Linked'}: ${creatorMatch.reason}.` : 'Linked to creator record.')
                          : 'Not linked. Pick the exact creator before launch.'}
                      </div>
                    )}
                    {item.source !== 'drive' && isCreatorLinked && creatorMatch?.reason && (
                      <div style={S.linkedHint(true)}>
                        {creatorMatch.confidence === 'review' ? 'Review match' : 'Linked'}: {creatorMatch.reason}.
                      </div>
                    )}
                    {isCreatorLinked && (
                      <div style={{ marginTop: 8 }}>
                        <label style={S.label}>Deliverable</label>
                        <select
                          style={S.select}
                          value={m.deliverableId || ''}
                          onFocus={() => loadCreatorDeliverables(m.creatorId)}
                          onChange={e => updateMeta(id, { deliverableId: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">No deliverable selected</option>
                          {(deliverablesByCreator[m.creatorId] || []).map(deliverable => (
                            <option key={deliverable.id} value={deliverable.id}>
                              {deliverable.title} · {deliverable.expected_asset_count || 1} asset{Number(deliverable.expected_asset_count || 1) === 1 ? '' : 's'}{deliverable.due_at ? ` · due ${String(deliverable.due_at).slice(0, 10)}` : ''}
                            </option>
                          ))}
                        </select>
                        <div style={{ fontSize: 9, color: '#88857f', marginTop: 4, lineHeight: 1.35 }}>
                          Links this launch back to the creator investment and expected asset.
                        </div>
                      </div>
                    )}
                  </div>
                ) : attribution.requiresLabel ? (
                  <div>
                    <label style={S.label}>Person tag</label>
                    <input style={S.input} value={m.sourceLabel || ''} onChange={e => updateMeta(id, { sourceLabel: e.target.value, creator: e.target.value })} placeholder={attribution.value === 'founder' ? 'Founder name' : 'Team member name'} />
                  </div>
                ) : null}
                <div>
                  <label style={S.label}>Product</label>
                  <select
                    style={S.select}
                    value={m.productId || ''}
                    onChange={e => updateProduct(id, e.target.value)}
                  >
                    {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="launcher-url-grid" style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'minmax(220px, 1.3fr) minmax(220px, 1fr)', gap: 8 }}>
                <div>
                  <label style={S.label}>Ad URL</label>
                  <input
                    style={S.input}
                    value={m.destUrl ?? destUrlFor(m.productId)}
                    onChange={e => updateMeta(id, { destUrl: e.target.value })}
                    placeholder="https://www.howlcampfires.com/products/..."
                  />
                </div>
                <div>
                  <label style={S.label}>URL parameters</label>
                  <input
                    style={S.input}
                    value={m.urlParams ?? config.defaultUrlParams ?? DEFAULT_URL_PARAMS}
                    onChange={e => updateMeta(id, { urlParams: cleanUrlParams(e.target.value) })}
                    placeholder={DEFAULT_URL_PARAMS}
                  />
                </div>
              </div>
              <div className="launcher-copy-grid" style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <div>
                  <label style={S.label}>Headline</label>
                  <input style={S.input} value={m.headline || ''} onChange={e => updateMeta(id, { headline: e.target.value })} placeholder="6 words max" />
                </div>
                <div>
                  <label style={S.label}>Primary Text</label>
                  <textarea style={{ ...S.input, fontFamily: 'inherit', resize: 'vertical', minHeight: 32 }} value={m.primaryText || ''} onChange={e => updateMeta(id, { primaryText: e.target.value })} placeholder="2-3 sentences" rows={2} />
                </div>
              </div>
              {launcherCopyOptions(m.productId, library.variants).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <label style={S.label}>Copy options</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                    {launcherCopyOptions(m.productId, library.variants).map(option => {
                      const active = option.headline === (m.headline || '').trim()
                        && option.primaryText === (m.primaryText || '').trim();
                      return (
                        <button
                          key={`${option.source}:${option.label}:${option.headline}:${option.primaryText}`}
                          type="button"
                          onClick={() => updateMeta(id, { headline: option.headline, primaryText: option.primaryText })}
                          style={{
                            padding: '9px 10px',
                            background: active ? 'rgba(220,68,10,0.08)' : '#faf9f6',
                            border: `1px solid ${active ? '#d84a17' : '#ebe8e1'}`,
                            borderRadius: 4,
                            color: '#171717',
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'block', color: active ? '#d84a17' : '#77746f', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 5 }}>
                            {option.source} · {option.label}
                          </span>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, lineHeight: 1.25, marginBottom: 4 }}>
                            {option.headline}
                          </span>
                          <span style={{ display: 'block', fontSize: 10, color: '#77746f', lineHeight: 1.35 }}>
                            {option.primaryText}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(status.status === 'pushing' || status.status === 'success' || status.status === 'error') && (
                <div style={{ marginTop: 12 }}>
                  <LaunchTimeline stepDefs={stepDef} steps={status.steps || {}} currentStep={status.currentStep} />
                  {status.message && (
                    <div style={{ marginTop: 6, fontSize: 10, color: status.status === 'error' ? '#b42318' : '#256b35' }}>
                      {status.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ACTION COL */}
            <div className="launcher-queue-actions" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <button
                onClick={() => requestPreflight([item])}
                disabled={launchDisabled}
                title={launchIssues[0] || ''}
                style={S.btn(launchDisabled)}
              >
                {status.status === 'pushing' ? 'Launching…' : status.status === 'success' ? 'Re-launch' : 'Launch'}
              </button>
              {launchIssues[0] && status.status !== 'pushing' && (
                <div style={{ maxWidth: 150, color: '#9f3212', fontSize: 9, lineHeight: 1.35, textAlign: 'right' }}>{launchIssues[0]}</div>
              )}
              {item.source === 'drive' && (
                <>
                  {item.webViewLink && (
                    <a href={item.webViewLink} target="_blank" rel="noreferrer" style={{ ...S.ghost, textDecoration: 'none' }}>Open in Drive</a>
                  )}
                  {item.kind === 'single' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (pairingSourceId && pairingSourceId !== item.id) associateDrivePair(pairingSource, item);
                        else setPairingSourceId(current => current === item.id ? null : item.id);
                      }}
                      style={{ ...S.ghost, color: pairingSourceId && pairingSourceId !== item.id ? '#256b35' : '#7357c7' }}
                    >
                      {pairingSourceId && pairingSourceId !== item.id ? 'Pair here' : pairingSourceId === item.id ? 'Cancel pair' : 'Pair'}
                    </button>
                  )}
                  {item.kind === 'pair' && (
                    <button type="button" onClick={() => unpairDriveItem(item)} style={{ ...S.ghost, color: '#7357c7' }}>Unpair</button>
                  )}
                  <button onClick={() => markDriveLaunched(item)} style={{ ...S.ghost, color: '#256b35' }}>Mark launched</button>
                  <button onClick={() => hideDriveFile(item.kind === 'pair' ? item.feed.id : item.id)} style={{ ...S.ghost, color: '#b42318' }}>Hide</button>
                </>
              )}
              {item.source === 'cart' && (
                <button onClick={() => onRemoveCartItem?.(item.id)} style={{ ...S.ghost, color: '#b42318' }}>Remove</button>
              )}
            </div>
          </div>
        );
      })}

      {preflightItems.length > 0 && (
        <div
          role="presentation"
          onClick={() => setPreflightIds([])}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(23,23,23,0.58)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="launcher-preflight-title"
            onClick={event => event.stopPropagation()}
            style={{ width: 'min(760px, 100%)', maxHeight: 'calc(100vh - 40px)', overflow: 'auto', background: '#fff', border: '1px solid #c9c5bc', borderRadius: 6, boxShadow: '0 18px 50px rgba(0,0,0,0.24)' }}
          >
            <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '18px 20px 14px', borderBottom: '1px solid #dedbd3', background: '#fff' }}>
              <div id="launcher-preflight-title" style={{ fontSize: 18, fontWeight: 700, color: '#171717' }}>Review {preflightItems.length} paused ad{preflightItems.length === 1 ? '' : 's'}</div>
              <div style={{ marginTop: 5, color: '#77746f', fontSize: 11, lineHeight: 1.45 }}>
                Campaign: <strong style={{ color: '#171717' }}>{campaigns.find(campaign => String(campaign.id) === String(selectedCampaignId))?.name || selectedCampaignId}</strong>
                {' | '}{(config.namingMode || 'batch_adsets') === 'existing_adset'
                  ? `Existing ad set: ${adsets.find(adset => String(adset.id) === String(selectedAdsetId))?.name || selectedAdsetId}`
                  : `One new ad set per creative at $${batchAdsetBudget}/day`}
              </div>
            </div>

            <div style={{ padding: 20 }}>
              {preflightItems.map((item, index) => {
                const m = meta[item.unifiedId] || {};
                const product = PRODUCTS.find(candidate => candidate.id === m.productId);
                const itemAttribution = sourceConfig(m.sourceType || (item.source === 'drive' ? 'external_creator' : 'tool_generated'));
                const warnings = launchWarningsForItem(item);
                return (
                  <div key={item.unifiedId} style={{ padding: '12px 0', borderBottom: index === preflightItems.length - 1 ? 0 : '1px solid #ebe8e1' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                      <strong style={{ color: '#171717', fontSize: 12 }}>{assetLabel(item)}</strong>
                      <span style={{ color: '#77746f', fontSize: 10 }}>{product?.name || 'No product'} | {itemAttribution.label}</span>
                    </div>
                    <div style={{ marginTop: 5, color: '#171717', fontSize: 11, lineHeight: 1.4 }}>{m.headline}</div>
                    <div style={{ marginTop: 3, color: '#77746f', fontSize: 10, lineHeight: 1.4, wordBreak: 'break-word' }}>{destUrlForMeta(m)}</div>
                    <div style={{ marginTop: 3, color: '#88857f', fontSize: 9 }}>{buildNamesForItem(item, index + 1).adName}</div>
                    {warnings.map(warning => <div key={warning} style={{ marginTop: 5, color: '#9f5b12', fontSize: 10 }}>{warning}</div>)}
                  </div>
                );
              })}
            </div>

            <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid #dedbd3', background: '#faf9f6' }}>
              <button type="button" onClick={() => setPreflightIds([])} style={S.ghost}>Keep editing</button>
              <button type="button" onClick={confirmPreflight} disabled={batchLaunching} style={S.btn(batchLaunching)}>
                Create {preflightItems.length} paused ad{preflightItems.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
