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
import CopyLibrary, { useCopyLibrary } from './CopyLibrary';
import LaunchTimeline from './LaunchTimeline';
import { ls, lsSet } from '../utils/localStorage';
import {
  DriveThumb, PagePicker, InstagramAccountPicker,
} from './launcher/shared';

const LS_CONFIG = 'howl_launcher_config';

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

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildAdName({ creator, productId }) {
  const product = PRODUCTS.find(p => p.id === productId)?.name || productId || 'product';
  const c = (creator || 'creator').trim().replace(/\s+/g, '-');
  return `HOWL | UGC | ${c} | ${product} | ${todayISO()}`;
}

function destUrlFor(productId) {
  return PRODUCTS.find(p => p.id === productId)?.url || '';
}

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1240 },
  h1: { fontSize: 22, marginBottom: 4 },
  sub: { color: '#8b949e', fontSize: 13, marginTop: 0, marginBottom: 16 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 6, display: 'block' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  select: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', width: '100%' },
  card: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', padding: 14, display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr) auto', gap: 16, alignItems: 'center', marginBottom: 12 },
  thumbBox: { width: 140, height: 140, borderRadius: 4, background: '#1c2330', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#6e7681', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, overflow: 'hidden' },
  fileMeta: { fontSize: 10, color: '#8b949e', marginBottom: 4 },
  fileName: { fontSize: 12, fontWeight: 600, color: '#f0f4f8', wordBreak: 'break-all' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 },
  btn: (disabled) => ({
    padding: '9px 18px', background: disabled ? '#2a3441' : '#DC440A', border: 'none',
    color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  ghost: { padding: '8px 14px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  badge: (color) => ({
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700,
    color, padding: '2px 6px', borderRadius: 3,
    border: `1px solid ${color}`, background: `${color}1a`,
  }),
  err: { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 10, borderRadius: 4 },
  settings: { background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: 16, marginBottom: 18 },
  divider: { borderTop: '1px solid #2a3441', margin: '20px 0' },
};

export default function LauncherTool({ cart = [], onAddToCart, onUpdateCartItem, onRemoveCartItem }) {
  // ── shared settings ────────────────────────────────────────────────────
  const [config, setConfig] = useState(() => ls(LS_CONFIG, {
    pageId: import.meta.env.VITE_META_PAGE_ID || '',
    instagramUserId: import.meta.env.VITE_META_INSTAGRAM_USER_ID || '',
    defaultCreator: '',
    defaultProduct: PRODUCTS[0]?.id || '',
  }));
  const updateConfig = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    lsSet(LS_CONFIG, next);
  };

  // ── campaign / adset selection ─────────────────────────────────────────
  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets] = useState([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(() => ls('howl_launcher_campaign', ''));
  const [selectedAdsetId, setSelectedAdsetId] = useState(() => ls('howl_launcher_adset', ''));
  const [newCampaign, setNewCampaign] = useState({ name: '', objective: 'OUTCOME_TRAFFIC', pixelId: '' });
  const [newAdset, setNewAdset] = useState({ name: '', budget: '10' });
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [creatingAdset, setCreatingAdset] = useState(false);

  useEffect(() => { lsSet('howl_launcher_campaign', selectedCampaignId); }, [selectedCampaignId]);
  useEffect(() => { lsSet('howl_launcher_adset', selectedAdsetId); }, [selectedAdsetId]);

  const loadCampaigns = async () => {
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
  };

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
    setCreatingCampaign(true);
    try {
      const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_campaign', name: newCampaign.name.trim(), objective: newCampaign.objective, pixel_id: newCampaign.pixelId }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      await loadCampaigns();
      setSelectedCampaignId(d.id);
      setNewCampaign({ name: '', objective: 'OUTCOME_TRAFFIC', pixelId: '' });
    } catch (err) {
      alert('Create campaign failed: ' + err.message);
    } finally {
      setCreatingCampaign(false);
    }
  };

  const createAdset = async () => {
    if (!selectedCampaignId || selectedCampaignId === '__new__') return alert('Pick a campaign first.');
    if (!newAdset.name.trim()) return alert('Ad set name required.');
    setCreatingAdset(true);
    try {
      const r = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_adset', campaign_id: selectedCampaignId, name: newAdset.name.trim(), daily_budget: Math.round(parseFloat(newAdset.budget) * 100) }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      await loadAdsets(selectedCampaignId);
      setSelectedAdsetId(d.id);
      setNewAdset({ name: '', budget: '10' });
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
      setDriveError(err.message);
    } finally {
      setLoadingDrive(false);
    }
  }, []);
  useEffect(() => { refreshDrive(); }, [refreshDrive]);

  // ── per-item editable metadata (creator, product, angle, headline, primaryText, status) ──
  // Single state map keyed by unified item id (drive ids are file ids; cart ids prefixed).
  const [meta, setMeta] = useState({});
  const updateMeta = (id, patch) => setMeta(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Seed defaults for new drive files using folder-aware creator extraction.
  useEffect(() => {
    setMeta(prev => {
      const next = { ...prev };
      for (const f of driveItems) {
        const id = `drive:${f.id}`;
        if (!next[id]) {
          const topFolder = f.kind === 'pair' ? f.folderName : (f.folderPath || '').split(' / ')[0];
          const filePrefix = (f.name || '').split(/[_\-\s]/)[0] || '';
          next[id] = {
            creator: topFolder || filePrefix || config.defaultCreator,
            productId: config.defaultProduct,
            headline: '',
            primaryText: '',
          };
        }
      }
      // seed cart defaults from item.hook / item.body if user hasn't edited
      for (const c of cart) {
        const id = `cart:${c.id}`;
        if (!next[id]) {
          next[id] = {
            creator: config.defaultCreator || 'Static Builder',
            productId: config.defaultProduct,
            headline: c.hook || '',
            primaryText: c.body || '',
          };
        }
      }
      return next;
    });
  }, [driveItems, cart, config.defaultCreator, config.defaultProduct]);

  // ── unified queue ─────────────────────────────────────────────────────
  const queue = useMemo(() => {
    const driveRows = driveItems.map(f => ({ unifiedId: `drive:${f.id}`, source: 'drive', ...f }));
    const cartRows = cart.filter(c => c.metaStatus !== 'pushed').map(c => ({ unifiedId: `cart:${c.id}`, source: 'cart', ...c }));
    return [...driveRows, ...cartRows];
  }, [driveItems, cart]);

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
  const launchDriveItem = async (item) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    if (!selectedAdsetId || selectedAdsetId === '__new__') return setGlobalError('Pick an ad set first.');
    const productUrl = destUrlFor(m.productId);
    if (!productUrl) return setItemStatus(id, 'error', 'Selected product has no URL set in data/products.js');
    if (!m.creator?.trim()) return setItemStatus(id, 'error', 'Creator required');
    if (!m.headline?.trim() && !m.primaryText?.trim()) return setItemStatus(id, 'error', 'Headline or primary text required');

    setItemStatus(id, 'pushing', '');
    setStatuses(prev => ({ ...prev, [id]: { status: 'pushing', steps: {}, currentStep: null } }));

    const adName = buildAdName({ creator: m.creator, productId: m.productId });
    const body = {
      action: 'launch_meta_ad',
      adsetId: selectedAdsetId,
      pageId: config.pageId.trim(),
      instagramUserId: (config.instagramUserId || '').trim(),
      destUrl: productUrl,
      adName,
      headline: m.headline?.trim() || '',
      primaryText: m.primaryText?.trim() || '',
      creator: m.creator.trim(),
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
      } else if (final?.adId) {
        setItemStatus(id, 'success', `Ad ${final.adId}`);
      }
    } catch (err) {
      setItemStatus(id, 'error', err.message);
    }
  };

  // ── Cart launch (3 calls to /api/meta) ────────────────────────────────
  const launchCartItem = async (item) => {
    const id = item.unifiedId;
    const m = meta[id] || {};
    if (!selectedAdsetId || selectedAdsetId === '__new__') return setGlobalError('Pick an ad set first.');
    if (!config.pageId.trim()) return setGlobalError('Pick a Facebook Page.');
    const productUrl = destUrlFor(m.productId);
    if (!productUrl) return setItemStatus(id, 'error', 'Selected product has no URL set in data/products.js');
    if (!m.headline?.trim()) return setItemStatus(id, 'error', 'Headline required');

    setStatuses(prev => ({ ...prev, [id]: { status: 'pushing', steps: {}, currentStep: null } }));
    const adName = buildAdName({ creator: m.creator || 'Static Builder', productId: m.productId });
    const mimeType = item.type === 'video' ? 'video/mp4' : 'image';
    const isPairedImage = item.paired && item.storyUrl && item.type !== 'video';

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
          adsetId: selectedAdsetId,
          pageId: config.pageId,
          instagramUserId: (config.instagramUserId || '').trim() || undefined,
          creator: m.creator || 'Static Builder',
        }) });
        const pd = await pr.json();
        if (pd.error) { setStep(id, 'meta_creative', 'error', pd.error); throw new Error(pd.error); }
        setStep(id, 'meta_creative', 'done');
        setStep(id, 'meta_ad', 'done', pd.adId);
        setItemStatus(id, 'success', `Ad ${pd.adId}`);
        onUpdateCartItem?.(item.id, { metaStatus: 'pushed', metaPushedAt: Date.now() });
        return;
      }

      // 1. Upload asset
      setStep(id, 'meta_upload', 'running');
      const creativeBody = {
        action: 'create_creative',
        adName,
        headline: m.headline,
        primaryText: m.primaryText || m.headline,
        destUrl: productUrl,
        pageId: config.pageId,
        instagramUserId: (config.instagramUserId || '').trim() || undefined,
      };
      if (item.type === 'video') {
        const ur = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload_video', videoBase64: item.videoUrl, name: item.name }) });
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
      const ar = await fetch('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_ad_from_creative', creativeId: cd.creativeId, adName, adsetId: selectedAdsetId, headline: m.headline, primaryText: m.primaryText || m.headline, destUrl: productUrl, mimeType, creator: m.creator || 'Static Builder' }) });
      const ad = await ar.json();
      if (ad.error) { setStep(id, 'meta_ad', 'error', ad.error); throw new Error(ad.error); }
      setStep(id, 'meta_ad', 'done', ad.adId);
      setItemStatus(id, 'success', `Ad ${ad.adId}`);
      onUpdateCartItem?.(item.id, { metaStatus: 'pushed', metaPushedAt: Date.now() });
    } catch (err) {
      setItemStatus(id, 'error', err.message);
    }
  };

  const launch = (item) => item.source === 'drive' ? launchDriveItem(item) : launchCartItem(item);

  // ── drive-only actions: hide from inbox, open in Drive ────────────────
  const hideDriveFile = async (fileId) => {
    if (!confirm('Hide this file from the inbox? (file stays in Drive)')) return;
    try {
      await fetch('/api/drive/ugc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', fileId }) });
      setDriveItems(prev => prev.filter(d => d.id !== fileId));
    } catch (err) { console.error(err); }
  };

  // ── library (saved variants) ──────────────────────────────────────────
  const library = useCopyLibrary();
  const [focusedItemId, setFocusedItemId] = useState(null);

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div style={S.wrap}>
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

        {selectedCampaignId === '__new__' && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed #2a3441', borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8 }}>
              <input style={S.input} placeholder="Campaign name" value={newCampaign.name} onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })} />
              <select style={S.select} value={newCampaign.objective} onChange={e => setNewCampaign({ ...newCampaign, objective: e.target.value })}>
                {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input style={S.input} placeholder="Pixel ID (sales)" value={newCampaign.pixelId} onChange={e => setNewCampaign({ ...newCampaign, pixelId: e.target.value })} />
              <button onClick={createCampaign} disabled={creatingCampaign} style={S.btn(creatingCampaign)}>
                {creatingCampaign ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {selectedAdsetId === '__new__' && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed #2a3441', borderRadius: 6 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr auto', gap: 8 }}>
              <input style={S.input} placeholder="Ad set name" value={newAdset.name} onChange={e => setNewAdset({ ...newAdset, name: e.target.value })} />
              <input style={S.input} placeholder="Daily $" value={newAdset.budget} onChange={e => setNewAdset({ ...newAdset, budget: e.target.value })} />
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0' }}>
        <button onClick={refreshDrive} disabled={loadingDrive} style={S.ghost}>
          {loadingDrive ? 'Refreshing…' : 'Refresh from Drive'}
        </button>
        <div style={{ fontSize: 11, color: '#8b949e' }}>
          {queue.length} item{queue.length === 1 ? '' : 's'} ·
          <span style={{ color: '#DC440A', marginLeft: 4 }}>{driveItems.length} Drive</span> ·
          <span style={{ color: '#3fb950', marginLeft: 4 }}>{cart.filter(c => c.metaStatus !== 'pushed').length} Cart</span>
        </div>
      </div>

      {globalError && <div style={S.err}>{globalError}</div>}
      {driveError && <div style={S.err}>Drive: {driveError}</div>}

      {!loadingDrive && queue.length === 0 && (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#6e7681', fontSize: 13 }}>
          The launcher is empty. Drop assets in the Drive UGC inbox, or generate creatives that land in the cart.
        </div>
      )}

      {queue.map(item => {
        const id = item.unifiedId;
        const m = meta[id] || {};
        const status = statuses[id] || { status: 'pending' };
        const stepDef = item.source === 'drive' ? DRIVE_STEPS : CART_STEPS;

        return (
          <div key={id} style={S.card}>
            {/* THUMB COL */}
            <div>
              {item.source === 'drive' ? (
                item.kind === 'pair' ? (
                  <div style={{ position: 'relative', width: 140, height: 140 }}>
                    <DriveThumb fileId={item.feed.id} alt="feed" style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, objectFit: 'cover', borderRadius: 4, border: '2px solid #161b22', zIndex: 1 }}
                      fallback={<div style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, borderRadius: 4, background: '#1c2330', border: '2px solid #161b22', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 9 }}>1:1</div>}
                    />
                    <DriveThumb fileId={item.story.id} alt="story" style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, objectFit: 'cover', borderRadius: 4, border: '2px solid #161b22', zIndex: 2 }}
                      fallback={<div style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, borderRadius: 4, background: '#1c2330', border: '2px solid #161b22', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', fontSize: 9 }}>9:16</div>}
                    />
                  </div>
                ) : (
                  <DriveThumb fileId={item.id} alt={item.name} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 4 }}
                    fallback={<div style={S.thumbBox}>{(item.mimeType || '').startsWith('video/') ? <><div style={{ fontSize: 24 }}>▶</div><div>Video</div></> : 'Image'}</div>}
                  />
                )
              ) : item.paired && item.storyUrl ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <img src={item.squareUrl || item.url} alt={`${item.name} 4:5`} style={{ width: 84, height: 105, objectFit: 'cover', borderRadius: 4 }} />
                  <img src={item.storyUrl} alt={`${item.name} 9:16`} style={{ width: 52, height: 92, objectFit: 'cover', borderRadius: 4 }} />
                </div>
              ) : (
                <img src={item.squareUrl || item.url} alt={item.name} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 4 }} />
              )}
            </div>

            {/* META COL */}
            <div onClick={() => setFocusedItemId(id)}>
              <div style={S.fileName}>
                {item.source === 'drive'
                  ? (item.kind === 'pair' ? (item.folderName || item.name) : item.name)
                  : (item.name || 'Untitled')}
                <span style={{ marginLeft: 8 }}>
                  {item.source === 'drive'
                    ? <span style={S.badge('#DC440A')}>Drive</span>
                    : <span style={S.badge('#3fb950')}>Cart</span>}
                  {item.source === 'drive' && item.kind === 'pair' && (
                    <span style={{ marginLeft: 6, ...S.badge('#3fb950') }}>1:1 + 9:16</span>
                  )}
                  {item.paired && item.storyUrl && (
                    <span style={{ marginLeft: 6, ...S.badge('#3fb950') }}>4:5 + 9:16</span>
                  )}
                </span>
              </div>
              {item.source === 'drive' && item.folderPath && (
                <div style={{ fontSize: 9, color: '#DC440A', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
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
              <div style={S.row}>
                <div>
                  <label style={S.label}>Creator</label>
                  <input style={S.input} value={m.creator || ''} onChange={e => updateMeta(id, { creator: e.target.value })} placeholder="name" />
                </div>
                <div>
                  <label style={S.label}>Product</label>
                  <select style={S.select} value={m.productId || ''} onChange={e => updateMeta(id, { productId: e.target.value })}>
                    {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {m.productId && (
                    <div style={{ fontSize: 9, color: '#6e7681', marginTop: 4, wordBreak: 'break-all' }}>
                      → {destUrlFor(m.productId) || '(no URL set)'}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <div>
                  <label style={S.label}>Headline</label>
                  <input style={S.input} value={m.headline || ''} onChange={e => updateMeta(id, { headline: e.target.value })} placeholder="6 words max" />
                </div>
                <div>
                  <label style={S.label}>Primary Text</label>
                  <textarea style={{ ...S.input, fontFamily: 'inherit', resize: 'vertical', minHeight: 32 }} value={m.primaryText || ''} onChange={e => updateMeta(id, { primaryText: e.target.value })} placeholder="2-3 sentences" rows={2} />
                </div>
              </div>

              {(status.status === 'pushing' || status.status === 'success' || status.status === 'error') && (
                <div style={{ marginTop: 12 }}>
                  <LaunchTimeline stepDefs={stepDef} steps={status.steps || {}} currentStep={status.currentStep} />
                  {status.message && (
                    <div style={{ marginTop: 6, fontSize: 10, color: status.status === 'error' ? '#f85149' : '#3fb950' }}>
                      {status.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ACTION COL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <button onClick={() => launch(item)} disabled={status.status === 'pushing'} style={S.btn(status.status === 'pushing')}>
                {status.status === 'pushing' ? 'Launching…' : status.status === 'success' ? 'Re-launch' : 'Launch'}
              </button>
              {item.source === 'drive' && (
                <>
                  {item.webViewLink && (
                    <a href={item.webViewLink} target="_blank" rel="noreferrer" style={{ ...S.ghost, textDecoration: 'none' }}>Open in Drive</a>
                  )}
                  <button onClick={() => hideDriveFile(item.kind === 'pair' ? item.feed.id : item.id)} style={{ ...S.ghost, color: '#f85149' }}>Hide</button>
                </>
              )}
              {item.source === 'cart' && (
                <button onClick={() => onRemoveCartItem?.(item.id)} style={{ ...S.ghost, color: '#f85149' }}>Remove</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
