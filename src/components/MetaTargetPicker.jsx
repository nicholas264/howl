import React, { useEffect, useState } from 'react';

const OBJECTIVES = [
  { value: 'OUTCOME_TRAFFIC',   label: 'Traffic' },
  { value: 'OUTCOME_SALES',     label: 'Sales' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_LEADS',     label: 'Leads' },
];

const S = {
  wrap: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', padding: 16 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 6, display: 'block' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  select: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', width: '100%' },
  btn: (disabled) => ({
    padding: '8px 14px', background: disabled ? '#2a3441' : '#DC440A', border: 'none',
    color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  ghostBtn: { padding: '8px 12px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  inlineRow: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-end' },
  hint: { fontSize: 9, color: '#6e7681', marginTop: 6, letterSpacing: 1 },
};

export default function MetaTargetPicker({ selectedAdsetId, onAdsetChange }) {
  const [campaigns, setCampaigns] = useState([]); // each campaign has .adsets inlined from cache
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [cacheMeta, setCacheMeta] = useState(null); // { cached, ageSec, stale, usage }

  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [internalAdsetId, setInternalAdsetId] = useState(selectedAdsetId || '');

  const [newCampaign, setNewCampaign] = useState({ name: '', objective: 'OUTCOME_SALES' });
  const [newAdset, setNewAdset] = useState({ name: '', budget: '10' });
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [creatingAdset, setCreatingAdset] = useState(false);

  const load = async (force = false) => {
    setLoadingCampaigns(true);
    try {
      const r = await fetch(`/api/meta-cache?type=campaigns_with_adsets${force ? '&force=1' : ''}`);
      const d = await r.json();
      if (d.error && !d.campaigns) throw new Error(d.error);
      setCampaigns(d.campaigns || []);
      setCacheMeta({ cached: d.cached, ageSec: d.ageSec, stale: d.stale, usage: d.usage });
      setCampaignsLoaded(true);
    } catch (err) { alert(`Failed to load campaigns: ${err.message}`); }
    finally { setLoadingCampaigns(false); }
  };

  useEffect(() => { load(false); }, []);

  const adsets = (campaigns.find(c => c.id === selectedCampaignId)?.adsets?.data
    || campaigns.find(c => c.id === selectedCampaignId)?.adsets
    || []);
  const loadingAdsets = false; // no separate loading, inlined in campaigns

  const selectCampaign = (id) => {
    setSelectedCampaignId(id);
    setInternalAdsetId('');
    onAdsetChange?.('');
  };

  const selectAdset = (id) => {
    setInternalAdsetId(id);
    if (id && id !== '__new__') onAdsetChange?.(id);
    else onAdsetChange?.('');
  };

  const createCampaign = async () => {
    if (!newCampaign.name.trim()) return;
    setCreatingCampaign(true);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_campaign', name: newCampaign.name.trim(), objective: newCampaign.objective }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      const created = { id: d.id, name: newCampaign.name.trim(), objective: newCampaign.objective, status: 'PAUSED', adsets: [] };
      setCampaigns(prev => [created, ...prev]);
      setSelectedCampaignId(d.id);
      setNewCampaign(p => ({ ...p, name: '' }));
    } catch (err) { alert(`Failed to create campaign: ${err.message}`); }
    finally { setCreatingCampaign(false); }
  };

  const createAdset = async () => {
    if (!newAdset.name.trim() || !selectedCampaignId || selectedCampaignId === '__new__') return;
    setCreatingAdset(true);
    const campaign = campaigns.find(c => c.id === selectedCampaignId);
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_adset',
          name: newAdset.name.trim(),
          campaign_id: selectedCampaignId,
          daily_budget_dollars: newAdset.budget,
          objective: campaign?.objective || 'OUTCOME_TRAFFIC',
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || d.error);
      const created = { id: d.id, name: newAdset.name.trim(), status: 'PAUSED' };
      setCampaigns(prev => prev.map(c => c.id === selectedCampaignId
        ? { ...c, adsets: { data: [created, ...(c.adsets?.data || c.adsets || [])] } }
        : c));
      setInternalAdsetId(d.id);
      onAdsetChange?.(d.id);
      setNewAdset(p => ({ ...p, name: '' }));
    } catch (err) { alert(`Failed to create ad set: ${err.message}`); }
    finally { setCreatingAdset(false); }
  };

  const adAccUsage = cacheMeta?.usage?.ad_account;
  const callCountPct = adAccUsage?.acc_id_util_pct ?? adAccUsage?.call_count ?? null;
  const cacheLabel = cacheMeta
    ? cacheMeta.cached
      ? `cached ${Math.floor((cacheMeta.ageSec || 0) / 60)}m${(cacheMeta.ageSec || 0) % 60}s ago${cacheMeta.stale ? ' (stale)' : ''}`
      : 'fresh from Meta'
    : '';

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 9, color: '#6e7681', letterSpacing: 2, textTransform: 'uppercase' }}>
        <div>
          {cacheLabel}
          {callCountPct != null && <span style={{ marginLeft: 12, color: callCountPct > 80 ? '#f85149' : callCountPct > 50 ? '#DC440A' : '#3fb950' }}>Meta usage: {callCountPct}%</span>}
        </div>
        <button style={{ ...S.ghostBtn, padding: '4px 10px' }} onClick={() => load(true)} disabled={loadingCampaigns}>
          {loadingCampaigns ? '…' : '↻ Refresh'}
        </button>
      </div>
      <div style={S.row}>
        <div>
          <label style={S.label}>Campaign</label>
          <select style={S.select} value={selectedCampaignId} onChange={e => selectCampaign(e.target.value)} disabled={loadingCampaigns}>
            <option value="">{loadingCampaigns ? 'Loading…' : campaignsLoaded ? 'Select campaign' : 'Loading…'}</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} {c.status ? `· ${c.status}` : ''}</option>)}
            <option value="__new__">+ Create new campaign</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Ad Set</label>
          <select
            style={S.select}
            value={internalAdsetId}
            onChange={e => selectAdset(e.target.value)}
            disabled={!selectedCampaignId || selectedCampaignId === '__new__' || loadingAdsets}
          >
            <option value="">{loadingAdsets ? 'Loading…' : !selectedCampaignId ? 'Select campaign first' : 'Select ad set'}</option>
            {adsets.map(a => <option key={a.id} value={a.id}>{a.name} {a.status ? `· ${a.status}` : ''}</option>)}
            {selectedCampaignId && selectedCampaignId !== '__new__' && (
              <option value="__new__">+ Create new ad set</option>
            )}
          </select>
        </div>
      </div>

      {selectedCampaignId === '__new__' && (
        <div style={{ marginTop: 14, padding: 12, border: '1px dashed #2a3441', borderRadius: 4 }}>
          <label style={S.label}>New campaign</label>
          <div style={S.inlineRow}>
            <input style={{ ...S.input, flex: 2 }} placeholder="Campaign name" value={newCampaign.name} onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))} />
            <select style={{ ...S.select, flex: 1 }} value={newCampaign.objective} onChange={e => setNewCampaign(p => ({ ...p, objective: e.target.value }))}>
              {OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button style={S.btn(creatingCampaign || !newCampaign.name.trim())} disabled={creatingCampaign || !newCampaign.name.trim()} onClick={createCampaign}>
              {creatingCampaign ? 'Creating…' : 'Create'}
            </button>
          </div>
          <div style={S.hint}>Campaign will be created PAUSED.</div>
        </div>
      )}

      {internalAdsetId === '__new__' && selectedCampaignId && selectedCampaignId !== '__new__' && (
        <div style={{ marginTop: 14, padding: 12, border: '1px dashed #2a3441', borderRadius: 4 }}>
          <label style={S.label}>New ad set</label>
          <div style={S.inlineRow}>
            <input style={{ ...S.input, flex: 2 }} placeholder="Ad set name" value={newAdset.name} onChange={e => setNewAdset(p => ({ ...p, name: e.target.value }))} />
            <input style={{ ...S.input, flex: 1 }} placeholder="Daily $" value={newAdset.budget} onChange={e => setNewAdset(p => ({ ...p, budget: e.target.value }))} />
            <button style={S.btn(creatingAdset || !newAdset.name.trim())} disabled={creatingAdset || !newAdset.name.trim()} onClick={createAdset}>
              {creatingAdset ? 'Creating…' : 'Create'}
            </button>
          </div>
          <div style={S.hint}>Ad set will be created PAUSED.</div>
        </div>
      )}
    </div>
  );
}
