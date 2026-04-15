import React, { useState, useRef, useCallback } from 'react';
import { buildSystemPrompt } from '../prompts';

const LS_CONFIG = 'howl_meta_config';

const OBJECTIVES = [
  { value: 'OUTCOME_TRAFFIC',   label: 'Traffic' },
  { value: 'OUTCOME_SALES',     label: 'Sales (requires Pixel ID)' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_LEADS',     label: 'Leads' },
];

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1100 },
  section: { marginBottom: 32 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 10, display: 'block' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '9px 12px', borderRadius: 4, outline: 'none', width: '100%' },
  row: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  col: { display: 'flex', flexDirection: 'column', gap: 6 },
  btn: (disabled) => ({
    padding: '9px 18px', background: disabled ? '#2a3441' : '#DC440A', border: 'none',
    color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 4, whiteSpace: 'nowrap',
  }),
  ghostBtn: { padding: '9px 18px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  select: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '9px 12px', borderRadius: 4, cursor: 'pointer' },
  card: { border: '1px solid #2a3441', borderRadius: 6, padding: 16, background: '#161b22', display: 'flex', gap: 16, alignItems: 'flex-start' },
  statusDot: (s) => ({ width: 8, height: 8, borderRadius: '50%', background: s === 'success' ? '#3fb950' : s === 'error' ? '#f85149' : s === 'pushing' ? '#DC440A' : '#2a3441', flexShrink: 0, marginTop: 6 }),
  divider: { borderTop: '1px solid #2a3441', margin: '24px 0' },
  err: { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 10, borderRadius: 4, marginTop: 8 },
  success: { padding: '8px 12px', border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.1)', color: '#3fb950', fontSize: 10, borderRadius: 4, marginTop: 8 },
};

export default function MetaPublishTool({ cart = [], onAddToCart, onUpdateCartItem, onRemoveCartItem }) {
  const [config, setConfig] = useState(() => ls(LS_CONFIG, { pageId: '404789730317028', destUrl: '' }));
  const [publishMode, setPublishMode] = useState('manual'); // 'manual' | 'creative_test'

  const [campaigns, setCampaigns] = useState([]);
  const [adsets, setAdsets]       = useState([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdsets, setLoadingAdsets]       = useState(false);

  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedAdsetId, setSelectedAdsetId]       = useState('');

  const [newCampaign, setNewCampaign] = useState({ name: '', objective: 'OUTCOME_TRAFFIC', pixelId: '' });
  const [newAdset, setNewAdset]       = useState({ name: '', budget: '10' });
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [creatingAdset, setCreatingAdset]       = useState(false);

  const [statuses, setStatuses] = useState({});
  const [generatingCopy, setGeneratingCopy] = useState({});
  const [previewId, setPreviewId] = useState(null);
  const fileInputRef = useRef(null);

  // ── Creative Test state ─────────────────────────────────────────────────
  const [ctConfig, setCtConfig] = useState(() => ls('howl_ct_config', {
    testName: '',
    budgetPerCreative: '20',
    pixelId: '',
  }));
  const [ctSelected, setCtSelected] = useState(() => new Set());
  const [ctRunning, setCtRunning] = useState(false);
  const [ctProgress, setCtProgress] = useState('');
  const [ctResult, setCtResult] = useState(null);

  const updateCtConfig = (key, val) => {
    const next = { ...ctConfig, [key]: val };
    setCtConfig(next);
    lsSet('howl_ct_config', next);
  };

  const toggleCtItem = (id) => {
    setCtSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllCt = () => setCtSelected(new Set(cart.map(i => i.id)));
  const selectNoneCt = () => setCtSelected(new Set());

  const launchCreativeTest = useCallback(async () => {
    const items = cart.filter(i => ctSelected.has(i.id));
    if (items.length === 0) { alert('Select at least one creative.'); return; }
    if (!config.pageId.trim()) { alert('Enter your Facebook Page ID in Settings.'); return; }
    if (!config.destUrl.trim()) { alert('Enter a destination URL in Settings.'); return; }
    if (!ctConfig.pixelId.trim()) { alert('Enter your Pixel ID for purchase optimization.'); return; }

    setCtRunning(true);
    setCtResult(null);
    setCtProgress('Creating campaign...');

    try {
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const testName = ctConfig.testName.trim() || `[CT] HOWL — ${dateStr}`;

      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_creative_test',
          testName,
          dailyBudgetDollars: ctConfig.budgetPerCreative,
          pixelId: ctConfig.pixelId,
          pageId: config.pageId,
          destUrl: config.destUrl,
          items: items.map(i => ({
            name: i.name || 'Untitled',
            type: i.type || 'static',
            hook: i.hook || '',
            body: i.body || '',
            squareUrl: i.squareUrl || i.url || null,
            storyUrl: i.storyUrl || null,
            videoUrl: i.videoUrl || null,
            cards: i.cards || null,
          })),
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCtResult(d);
      setCtProgress('');
    } catch (err) {
      setCtResult({ error: err.message });
      setCtProgress('');
    } finally {
      setCtRunning(false);
    }
  }, [cart, ctSelected, config, ctConfig]);

  const updateConfig = (key, val) => {
    const next = { ...config, [key]: val };
    setConfig(next);
    lsSet(LS_CONFIG, next);
  };

  const updateQueueItem = (id, patch) => onUpdateCartItem?.(id, patch);
  const removeFromQueue = (id) => onRemoveCartItem?.(id);

  const setStatus = (id, status, message = '') => {
    setStatuses(prev => ({ ...prev, [id]: { status, message } }));
  };

  // ── Generate copy with Claude ─────────────────────────────────────────────
  const handleGenerateCopy = useCallback(async (item) => {
    setGeneratingCopy(prev => ({ ...prev, [item.id]: true }));
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 512,
          system: buildSystemPrompt(),
          messages: [{
            role: 'user',
            content: `Write Meta ad copy for this HOWL Campfires creative.\n\nCreative hook: "${item.hook || item.name}"\n\nReturn ONLY valid JSON, no markdown:\n{"headline":"max 6 words, punchy, outcome-focused","primaryText":"2-3 sentences of body copy for Meta primary text field, conversational, specific, no em dashes"}`,
          }],
        }),
      });
      const data = await r.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      updateQueueItem(item.id, {
        hook: parsed.headline || item.hook,
        body: parsed.primaryText || item.body,
      });
    } catch (err) {
      console.error('Copy gen failed:', err);
      alert('Copy generation failed. Try again.');
    } finally {
      setGeneratingCopy(prev => ({ ...prev, [item.id]: false }));
    }
  }, [updateQueueItem]);

  // ── Add images via file upload ────────────────────────────────────────────
  const handleFileAdd = (files) => {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        onAddToCart?.({
          id: Date.now() + Math.random(),
          url: e.target.result,
          name: file.name.replace(/\.[^.]+$/, ''),
          hook: '',
          body: '',
        });
      };
      reader.readAsDataURL(file);
    });
  };

  // ── Load campaigns ────────────────────────────────────────────────────────
  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_campaigns' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      setCampaigns(d.data || []);
      setCampaignsLoaded(true);
    } catch (err) {
      alert(`Failed to load campaigns: ${err.message}`);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  // ── Load ad sets when campaign changes ────────────────────────────────────
  const loadAdsets = async (campaignId) => {
    if (!campaignId || campaignId === '__new__') { setAdsets([]); return; }
    setLoadingAdsets(true);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_adsets', campaign_id: campaignId }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      setAdsets(d.data || []);
    } catch (err) {
      alert(`Failed to load ad sets: ${err.message}`);
    } finally {
      setLoadingAdsets(false);
    }
  };

  const handleCampaignChange = (id) => {
    setSelectedCampaignId(id);
    setSelectedAdsetId('');
    if (id && id !== '__new__') loadAdsets(id);
    else setAdsets([]);
  };

  // ── Create campaign ───────────────────────────────────────────────────────
  const handleCreateCampaign = async () => {
    if (!newCampaign.name.trim()) return;
    setCreatingCampaign(true);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_campaign',
          name: newCampaign.name.trim(),
          objective: newCampaign.objective,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      const created = { id: d.id, name: newCampaign.name.trim(), status: 'PAUSED', objective: newCampaign.objective };
      setCampaigns(prev => [created, ...prev]);
      setSelectedCampaignId(d.id);
      setNewCampaign(prev => ({ ...prev, name: '' }));
      setAdsets([]);
    } catch (err) {
      alert(`Failed to create campaign: ${err.message}`);
    } finally {
      setCreatingCampaign(false);
    }
  };

  // ── Create ad set ─────────────────────────────────────────────────────────
  const handleCreateAdset = async () => {
    if (!newAdset.name.trim() || !selectedCampaignId || selectedCampaignId === '__new__') return;
    setCreatingAdset(true);
    const campaign = campaigns.find(c => c.id === selectedCampaignId);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_adset',
          name: newAdset.name.trim(),
          campaign_id: selectedCampaignId,
          daily_budget_dollars: newAdset.budget,
          objective: campaign?.objective || 'OUTCOME_TRAFFIC',
          pixel_id: newCampaign.pixelId || undefined,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      const created = { id: d.id, name: newAdset.name.trim(), status: 'PAUSED' };
      setAdsets(prev => [created, ...prev]);
      setSelectedAdsetId(d.id);
      setNewAdset(prev => ({ ...prev, name: '' }));
    } catch (err) {
      alert(`Failed to create ad set: ${err.message}`);
    } finally {
      setCreatingAdset(false);
    }
  };

  // ── Push single ad ────────────────────────────────────────────────────────
  const pushAd = useCallback(async (item) => {
    const adsetId = selectedAdsetId;
    if (!adsetId || adsetId === '__new__') { alert('Select or create an ad set first.'); return; }
    if (!config.pageId.trim()) { alert('Enter your Facebook Page ID in Settings.'); return; }
    if (!config.destUrl.trim()) { alert('Enter a destination URL in Settings.'); return; }
    if (!item.hook.trim()) { alert('Enter a headline for this ad.'); return; }

    setStatus(item.id, 'pushing');
    try {
      let body;
      if (item.type === 'carousel' && item.cards) {
        body = {
          action: 'push_carousel',
          cards: item.cards.map(c => ({
            imageBase64: c.imageBase64 || c.squareUrl,
            headline: c.headline || '',
            body: c.body || '',
            destUrl: config.destUrl,
          })),
          adName: item.name || `HOWL Carousel ${new Date().toLocaleDateString()}`,
          headline: item.hook,
          primaryText: item.body || item.hook,
          destUrl: config.destUrl,
          pageId: config.pageId,
          adsetId,
        };
      } else {
        body = {
          action: 'push_ad',
          ...(item.type === 'video'
            ? { videoBase64: item.videoUrl }
            : { squareImageBase64: item.squareUrl || item.url || null, storyImageBase64: item.storyUrl || null }
          ),
          adName: item.name || `HOWL Ad ${new Date().toLocaleDateString()}`,
          headline: item.hook,
          primaryText: item.body || item.hook,
          destUrl: config.destUrl,
          pageId: config.pageId,
          adsetId,
        };
      }
      const r = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.error) throw new Error(`[${d.step}] ${d.error}`);
      setStatus(item.id, 'success', `Ad ID: ${d.adId}`);
    } catch (err) {
      setStatus(item.id, 'error', err.message);
    }
  }, [selectedAdsetId, config]);

  // ── Push all unpushed ads sequentially ───────────────────────────────────
  const [pushingAll, setPushingAll] = useState(false);
  const [pushAllProgress, setPushAllProgress] = useState('');

  const pushAll = useCallback(async () => {
    const unpushed = cart.filter(item => !statuses[item.id] || statuses[item.id].status !== 'success');
    if (unpushed.length === 0) return;
    setPushingAll(true);
    for (let i = 0; i < unpushed.length; i++) {
      setPushAllProgress(`${i + 1}/${unpushed.length}`);
      await pushAd(unpushed[i]);
    }
    setPushingAll(false);
    setPushAllProgress('');
  }, [cart, statuses, pushAd]);

  const activeAdsetId = selectedAdsetId && selectedAdsetId !== '__new__' ? selectedAdsetId : null;
  const activeCampaignId = selectedCampaignId && selectedCampaignId !== '__new__' ? selectedCampaignId : null;

  const ctSelectedCount = cart.filter(i => ctSelected.has(i.id)).length;
  const ctTotalDaily = ctSelectedCount * parseFloat(ctConfig.budgetPerCreative || '0');

  return (
    <div style={S.wrap}>

      {/* Settings */}
      <div style={S.section}>
        <span style={S.label}>Settings</span>
        <div style={{ ...S.row, marginBottom: 10 }}>
          <div style={{ ...S.col, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 10, color: '#8b949e' }}>Facebook Page ID</span>
            <input
              style={S.input}
              placeholder="e.g. 123456789012345"
              value={config.pageId}
              onChange={e => updateConfig('pageId', e.target.value)}
            />
          </div>
          <div style={{ ...S.col, flex: 2, minWidth: 280 }}>
            <span style={{ fontSize: 10, color: '#8b949e' }}>Destination URL</span>
            <input
              style={S.input}
              placeholder="https://howlcampfires.com/products/r4-mkii"
              value={config.destUrl}
              onChange={e => updateConfig('destUrl', e.target.value)}
            />
          </div>
        </div>
        <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
          Meta credentials (access token, ad account ID) are loaded from your .env file.
        </div>
      </div>

      <div style={S.divider} />

      {/* Mode toggle */}
      <div style={{ ...S.section, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPublishMode('manual')}
            style={{ padding: '8px 18px', border: `1px solid ${publishMode === 'manual' ? '#DC440A' : '#2a3441'}`, background: publishMode === 'manual' ? 'rgba(220,68,10,0.15)' : '#1c2330', color: publishMode === 'manual' ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4, fontWeight: 600 }}
          >
            Manual Publish
          </button>
          <button
            onClick={() => setPublishMode('creative_test')}
            style={{ padding: '8px 18px', border: `1px solid ${publishMode === 'creative_test' ? '#DC440A' : '#2a3441'}`, background: publishMode === 'creative_test' ? 'rgba(220,68,10,0.15)' : '#1c2330', color: publishMode === 'creative_test' ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4, fontWeight: 600 }}
          >
            Creative Test
          </button>
        </div>
      </div>

      {/* ── Creative Test Mode ──────────────────────────────────────────────── */}
      {publishMode === 'creative_test' && (
        <>
          <div style={S.section}>
            <span style={S.label}>Test Configuration</span>
            <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 14, letterSpacing: 1, lineHeight: 1.6 }}>
              Creates 1 ABO campaign with 1 ad set per creative. Equal daily budgets, same broad US audience.
              <br />Everything starts PAUSED — review in Ads Manager before going live.
            </div>
            <div style={{ ...S.row, marginBottom: 12 }}>
              <div style={{ ...S.col, flex: 2 }}>
                <span style={{ fontSize: 10, color: '#8b949e' }}>Test Name</span>
                <input style={S.input} placeholder={`[CT] HOWL — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`} value={ctConfig.testName} onChange={e => updateCtConfig('testName', e.target.value)} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <span style={{ fontSize: 10, color: '#8b949e' }}>Budget / Creative / Day ($)</span>
                <input style={S.input} type="number" min="5" placeholder="20" value={ctConfig.budgetPerCreative} onChange={e => updateCtConfig('budgetPerCreative', e.target.value)} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <span style={{ fontSize: 10, color: '#8b949e' }}>Pixel ID</span>
                <input style={S.input} placeholder="Pixel ID" value={ctConfig.pixelId} onChange={e => updateCtConfig('pixelId', e.target.value)} />
              </div>
            </div>
            {ctSelectedCount > 0 && (
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 12, letterSpacing: 1 }}>
                {ctSelectedCount} creative{ctSelectedCount !== 1 ? 's' : ''} selected — <span style={{ color: '#f0f4f8', fontWeight: 600 }}>${ctTotalDaily.toFixed(0)}/day</span> total spend
              </div>
            )}
          </div>

          <div style={S.divider} />

          <div style={S.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <span style={{ ...S.label, marginBottom: 0 }}>Select Creatives {cart.length > 0 && `(${cart.length} in cart)`}</span>
              <button onClick={selectAllCt} style={S.ghostBtn}>Select All</button>
              <button onClick={selectNoneCt} style={S.ghostBtn}>None</button>
            </div>

            {cart.length === 0 && (
              <div style={{ border: '2px dashed #2a3441', borderRadius: 6, padding: '32px', textAlign: 'center', color: '#6e7681', fontSize: 11 }}>
                Add creatives from Image Ads, Review Ads, or Video Ads first.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cart.map(item => {
                const isSelected = ctSelected.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleCtItem(item.id)}
                    style={{ ...S.card, cursor: 'pointer', border: `1px solid ${isSelected ? '#DC440A' : '#2a3441'}`, background: isSelected ? 'rgba(220,68,10,0.05)' : '#161b22' }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCtItem(item.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ marginTop: 4, flexShrink: 0, accentColor: '#DC440A' }}
                    />
                    {/* Thumbnail */}
                    <div style={{ flexShrink: 0 }}>
                      {item.type === 'video' ? (
                        <div style={{ width: 48, height: 48, background: '#1c2330', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #2a3441' }}>
                          <span style={{ fontSize: 16 }}>▶</span>
                          <span style={{ fontSize: 7, color: '#8b949e', letterSpacing: 1 }}>VIDEO</span>
                        </div>
                      ) : item.type === 'carousel' && item.cards ? (
                        <div style={{ display: 'flex', gap: 2 }}>
                          {item.cards.slice(0, 3).map((card, ci) => (
                            <img key={ci} src={card.squareUrl || card.imageBase64} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 3 }} />
                          ))}
                        </div>
                      ) : (
                        <img src={item.squareUrl || item.url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                      )}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#f0f4f8', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name || 'Untitled'}
                      </div>
                      <div style={{ fontSize: 9, color: '#8b949e', marginTop: 2 }}>
                        {item.type === 'carousel' ? `Carousel (${item.cards?.length} cards)` : item.type === 'video' ? 'Video' : item.storyUrl ? '1:1 + 9:16' : '1:1'}
                        {item.hook ? ` — ${item.hook.slice(0, 50)}` : ''}
                      </div>
                    </div>
                    {/* Per-creative budget */}
                    <div style={{ fontSize: 10, color: '#8b949e', flexShrink: 0 }}>
                      ${ctConfig.budgetPerCreative}/day
                    </div>
                  </div>
                );
              })}
            </div>

            {cart.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <button
                  onClick={launchCreativeTest}
                  disabled={ctRunning || ctSelectedCount === 0 || !ctConfig.pixelId.trim()}
                  style={{ ...S.btn(ctRunning || ctSelectedCount === 0 || !ctConfig.pixelId.trim()), width: '100%', padding: '14px 0', fontSize: 11 }}
                >
                  {ctRunning
                    ? ctProgress || 'Building test...'
                    : ctSelectedCount === 0
                    ? 'Select creatives to test'
                    : !ctConfig.pixelId.trim()
                    ? 'Enter Pixel ID above'
                    : `Launch Creative Test — ${ctSelectedCount} creative${ctSelectedCount !== 1 ? 's' : ''} — $${ctTotalDaily.toFixed(0)}/day`
                  }
                </button>

                {ctResult && !ctResult.error && (
                  <div style={{ ...S.success, marginTop: 12 }}>
                    Campaign created (PAUSED) — ID: {ctResult.campaignId}
                    <div style={{ marginTop: 8, fontSize: 9, lineHeight: 1.6 }}>
                      {ctResult.results?.map((r, i) => (
                        <div key={i} style={{ color: r.success ? '#3fb950' : '#f85149' }}>
                          {r.item}: {r.success ? `Ad ${r.adId}` : `Error: ${r.error}`}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 9, color: '#8b949e' }}>
                      Open Ads Manager to review and activate.
                    </div>
                  </div>
                )}
                {ctResult?.error && (
                  <div style={S.err}>{ctResult.error}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Manual Publish Mode ─────────────────────────────────────────────── */}
      {publishMode === 'manual' && (
        <>
      {/* Campaign Setup */}
      <div style={S.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <span style={{ ...S.label, marginBottom: 0 }}>Campaign & Ad Set</span>
          <button onClick={loadCampaigns} disabled={loadingCampaigns} style={S.ghostBtn}>
            {loadingCampaigns ? 'Loading…' : campaignsLoaded ? 'Reload Campaigns' : 'Load Campaigns'}
          </button>
        </div>

        {campaignsLoaded && (
          <>
            {/* Campaign select */}
            <div style={{ ...S.col, marginBottom: 14 }}>
              <span style={{ fontSize: 10, color: '#8b949e' }}>Campaign</span>
              <div style={S.row}>
                <select
                  style={{ ...S.select, flex: 1 }}
                  value={selectedCampaignId}
                  onChange={e => handleCampaignChange(e.target.value)}
                >
                  <option value="">— Select existing —</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                  ))}
                  <option value="__new__">+ Create new campaign</option>
                </select>
              </div>
            </div>

            {/* New campaign form */}
            {selectedCampaignId === '__new__' && (
              <div style={{ border: '1px solid #2a3441', borderRadius: 6, padding: 14, marginBottom: 14, background: '#0d1117' }}>
                <span style={{ ...S.label, marginBottom: 10 }}>New Campaign</span>
                <div style={{ ...S.row, marginBottom: 10 }}>
                  <div style={{ ...S.col, flex: 2 }}>
                    <span style={{ fontSize: 10, color: '#8b949e' }}>Name</span>
                    <input style={S.input} placeholder="HOWL — Spring 2026" value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div style={{ ...S.col, flex: 1 }}>
                    <span style={{ fontSize: 10, color: '#8b949e' }}>Objective</span>
                    <select style={S.select} value={newCampaign.objective} onChange={e => setNewCampaign(p => ({ ...p, objective: e.target.value }))}>
                      {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                {newCampaign.objective === 'OUTCOME_SALES' && (
                  <div style={{ ...S.col, marginBottom: 10 }}>
                    <span style={{ fontSize: 10, color: '#8b949e' }}>Pixel ID (required for Sales objective)</span>
                    <input style={S.input} placeholder="Pixel ID" value={newCampaign.pixelId} onChange={e => setNewCampaign(p => ({ ...p, pixelId: e.target.value }))} />
                  </div>
                )}
                <button
                  onClick={handleCreateCampaign}
                  disabled={creatingCampaign || !newCampaign.name.trim()}
                  style={S.btn(creatingCampaign || !newCampaign.name.trim())}
                >
                  {creatingCampaign ? 'Creating…' : 'Create Campaign'}
                </button>
              </div>
            )}

            {/* Ad set select */}
            {activeCampaignId && (
              <div style={{ ...S.col, marginBottom: 14 }}>
                <span style={{ fontSize: 10, color: '#8b949e' }}>Ad Set</span>
                <div style={S.row}>
                  <select
                    style={{ ...S.select, flex: 1 }}
                    value={selectedAdsetId}
                    onChange={e => setSelectedAdsetId(e.target.value)}
                    disabled={loadingAdsets}
                  >
                    <option value="">{loadingAdsets ? 'Loading…' : '— Select existing —'}</option>
                    {adsets.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
                    ))}
                    <option value="__new__">+ Create new ad set</option>
                  </select>
                </div>
              </div>
            )}

            {/* New ad set form */}
            {activeCampaignId && selectedAdsetId === '__new__' && (
              <div style={{ border: '1px solid #2a3441', borderRadius: 6, padding: 14, marginBottom: 14, background: '#0d1117' }}>
                <span style={{ ...S.label, marginBottom: 10 }}>New Ad Set</span>
                <div style={{ ...S.row, marginBottom: 10 }}>
                  <div style={{ ...S.col, flex: 2 }}>
                    <span style={{ fontSize: 10, color: '#8b949e' }}>Name</span>
                    <input style={S.input} placeholder="Broad — US — TOF" value={newAdset.name} onChange={e => setNewAdset(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div style={{ ...S.col, flex: 1 }}>
                    <span style={{ fontSize: 10, color: '#8b949e' }}>Daily Budget ($)</span>
                    <input style={S.input} type="number" min="1" placeholder="10" value={newAdset.budget} onChange={e => setNewAdset(p => ({ ...p, budget: e.target.value }))} />
                  </div>
                </div>
                <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 10, letterSpacing: 1 }}>
                  Targeting defaults to US, ages 18–65. Adjust in Ads Manager after creation.
                </div>
                <button
                  onClick={handleCreateAdset}
                  disabled={creatingAdset || !newAdset.name.trim()}
                  style={S.btn(creatingAdset || !newAdset.name.trim())}
                >
                  {creatingAdset ? 'Creating…' : 'Create Ad Set'}
                </button>
              </div>
            )}

            {/* Active selection summary */}
            {activeAdsetId && (
              <div style={{ fontSize: 10, color: '#3fb950', letterSpacing: 1 }}>
                Pushing to: {campaigns.find(c => c.id === activeCampaignId)?.name} → {adsets.find(a => a.id === activeAdsetId)?.name}
              </div>
            )}
          </>
        )}
      </div>

      <div style={S.divider} />

      {/* Publish Queue */}
      <div style={S.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <span style={{ ...S.label, marginBottom: 0 }}>Publish Queue {cart.length > 0 && `(${cart.length})`}</span>
          <button onClick={() => fileInputRef.current?.click()} style={S.ghostBtn}>+ Upload Images</button>
          {cart.length > 0 && (
            <button
              onClick={pushAll}
              disabled={pushingAll || !activeAdsetId}
              style={S.btn(pushingAll || !activeAdsetId)}
            >
              {pushingAll ? `Pushing ${pushAllProgress}…` : `Push All (${cart.filter(i => !statuses[i.id] || statuses[i.id].status !== 'success').length})`}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleFileAdd(e.target.files); e.target.value = ''; }}
          />
        </div>

        {cart.length === 0 && (
          <div
            style={{ border: '2px dashed #2a3441', borderRadius: 6, padding: '32px', textAlign: 'center', color: '#6e7681', fontSize: 11 }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFileAdd(e.dataTransfer.files); }}
          >
            Drop rendered ad images here, or click "+ Upload Images" above.
            <br />
            <span style={{ fontSize: 9, letterSpacing: 1, marginTop: 8, display: 'block' }}>
              Ads added from Image Ads or Review Ads appear here with both 1:1 and 9:16 formats paired automatically.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cart.map(item => {
            const st = statuses[item.id] || {};
            const isPushing = st.status === 'pushing';
            const isDone = st.status === 'success';
            return (
              <React.Fragment key={item.id}>
              <div style={{ ...S.card, opacity: isDone ? 0.6 : 1 }}>
                {/* Thumbnails */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {item.type === 'video' ? (
                    <div style={{ width: 64, height: 64, background: '#1c2330', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #2a3441' }}>
                      <span style={{ fontSize: 20 }}>▶</span>
                      <span style={{ fontSize: 7, color: '#8b949e', letterSpacing: 1, marginTop: 3 }}>VIDEO</span>
                    </div>
                  ) : item.type === 'carousel' && item.cards ? (
                    <div style={{ display: 'flex', gap: 3 }}>
                      {item.cards.slice(0, 4).map((card, ci) => (
                        <div key={ci} style={{ position: 'relative' }}>
                          <img src={card.squareUrl || card.imageBase64} alt="" style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
                          {ci === 0 && (
                            <span style={{ position: 'absolute', bottom: 2, left: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 6, padding: '1px 3px', borderRadius: 2, letterSpacing: 1 }}>
                              {item.cards.length} CARDS
                            </span>
                          )}
                        </div>
                      ))}
                      {item.cards.length > 4 && (
                        <div style={{ width: 42, height: 42, background: '#1c2330', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #2a3441' }}>
                          <span style={{ fontSize: 9, color: '#8b949e' }}>+{item.cards.length - 4}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {(item.squareUrl || item.url) && (
                        <div style={{ position: 'relative' }}>
                          <img src={item.squareUrl || item.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                          <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 7, padding: '1px 4px', borderRadius: 2, letterSpacing: 1 }}>1:1</span>
                        </div>
                      )}
                      {item.storyUrl && (
                        <div style={{ position: 'relative' }}>
                          <img src={item.storyUrl} alt="" style={{ width: 36, height: 64, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                          <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 7, padding: '1px 4px', borderRadius: 2, letterSpacing: 1 }}>9:16</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Inputs */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={S.row}>
                    <div style={{ ...S.col, flex: 1 }}>
                      <span style={{ fontSize: 9, color: '#8b949e' }}>Ad Name</span>
                      <input style={{ ...S.input, fontSize: 10 }} value={item.name} onChange={e => updateQueueItem(item.id, { name: e.target.value })} placeholder="Ad name" />
                    </div>
                  </div>
                  <div style={{ ...S.row, alignItems: 'flex-start' }}>
                    <div style={{ ...S.col, flex: 1 }}>
                      <span style={{ fontSize: 9, color: '#8b949e' }}>Headline</span>
                      <textarea style={{ ...S.input, fontSize: 10, resize: 'vertical', minHeight: 56, lineHeight: 1.5 }} value={item.hook} onChange={e => updateQueueItem(item.id, { hook: e.target.value })} placeholder="6-word hook" />
                    </div>
                    <div style={{ ...S.col, flex: 2 }}>
                      <span style={{ fontSize: 9, color: '#8b949e' }}>Primary Text</span>
                      <textarea style={{ ...S.input, fontSize: 10, resize: 'vertical', minHeight: 80, lineHeight: 1.5 }} value={item.body} onChange={e => updateQueueItem(item.id, { body: e.target.value })} placeholder="Body copy (defaults to headline if empty)" />
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => handleGenerateCopy(item)}
                      disabled={generatingCopy[item.id]}
                      style={{ padding: '6px 12px', background: 'none', border: '1px solid #2a3441', color: generatingCopy[item.id] ? '#6e7681' : '#8b949e', fontFamily: 'inherit', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', cursor: generatingCopy[item.id] ? 'not-allowed' : 'pointer', borderRadius: 3 }}
                    >
                      {generatingCopy[item.id] ? 'Generating…' : 'Generate Copy'}
                    </button>
                  </div>
                  {st.status === 'error' && <div style={S.err}>{st.message}</div>}
                  {st.status === 'success' && <div style={S.success}>Pushed — {st.message} (PAUSED in Ads Manager)</div>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, alignItems: 'flex-end' }}>
                  <div style={S.statusDot(st.status)} title={st.status || 'idle'} />
                  <button
                    onClick={() => pushAd(item)}
                    disabled={isPushing || isDone || !activeAdsetId}
                    style={S.btn(isPushing || isDone || !activeAdsetId)}
                  >
                    {isPushing ? 'Pushing…' : isDone ? 'Pushed' : 'Push to Meta'}
                  </button>
                  {item.type !== 'video' && (
                    <button onClick={() => setPreviewId(previewId === item.id ? null : item.id)} style={{ ...S.ghostBtn, fontSize: 9 }}>
                      {previewId === item.id ? 'Hide Preview' : 'Preview'}
                    </button>
                  )}
                  <button onClick={() => removeFromQueue(item.id)} style={{ ...S.ghostBtn, fontSize: 9 }}>Remove</button>
                </div>
              </div>

              {/* Facebook feed preview */}
              {previewId === item.id && (item.squareUrl || item.url) && (
                <div style={{ marginTop: 12, background: '#fff', borderRadius: 8, overflow: 'hidden', maxWidth: 480, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#DC440A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: '#fff', fontWeight: 900, fontSize: 16, fontFamily: 'system-ui' }}>H</span>
                    </div>
                    <div>
                      <div style={{ color: '#050505', fontWeight: 700, fontSize: 14, fontFamily: 'system-ui', lineHeight: 1.2 }}>HOWL Campfires</div>
                      <div style={{ color: '#65676B', fontSize: 12, fontFamily: 'system-ui' }}>Sponsored · 🌍</div>
                    </div>
                  </div>
                  {(item.body || item.hook) && (
                    <div style={{ padding: '0 16px 10px', color: '#050505', fontSize: 14, fontFamily: 'system-ui', lineHeight: 1.5 }}>
                      {(item.body || item.hook).slice(0, 200)}{(item.body || item.hook).length > 200 ? '…' : ''}
                    </div>
                  )}
                  <img src={item.squareUrl || item.url} alt="" style={{ width: '100%', display: 'block' }} />
                  <div style={{ background: '#F0F2F5', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#65676B', fontSize: 11, fontFamily: 'system-ui', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                        {config.destUrl ? new URL(config.destUrl).hostname.replace('www.', '') : 'howlcampfires.com'}
                      </div>
                      <div style={{ color: '#050505', fontSize: 14, fontWeight: 700, fontFamily: 'system-ui', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.hook || 'Headline'}
                      </div>
                    </div>
                    <div style={{ background: '#E4E6EB', border: 'none', padding: '8px 12px', borderRadius: 4, fontWeight: 700, fontSize: 13, fontFamily: 'system-ui', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Shop Now
                    </div>
                  </div>
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
