import React, { useState, useEffect, useMemo } from 'react';

const S = {
  wrap:    { padding: '28px 36px', maxWidth: 1400 },
  h1:      { fontSize: 22, fontWeight: 700, color: '#f0f4f8', margin: 0, letterSpacing: 0.5 },
  sub:     { fontSize: 11, color: '#8b949e', marginTop: 6 },
  toolbar: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, marginBottom: 18, flexWrap: 'wrap' },
  input:   { padding: '8px 12px', background: '#0d1117', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, borderRadius: 4, minWidth: 220 },
  select:  { padding: '8px 12px', background: '#0d1117', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, borderRadius: 4 },
  btn:     { padding: '8px 16px', background: '#DC440A', border: 'none', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  ghostBtn:{ padding: '8px 16px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  card:    { background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th:      { textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid #2a3441', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', fontWeight: 600, background: '#0d1117', position: 'sticky', top: 0 },
  thNum:   { textAlign: 'right' },
  td:      { padding: '10px 14px', borderBottom: '1px solid #1f2530', color: '#f0f4f8' },
  tdNum:   { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tdMuted: { color: '#8b949e' },
  err:     { padding: '10px 14px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 11, borderRadius: 4 },
  badge:   { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 },
  low:     { background: 'rgba(220,68,10,0.15)', color: '#DC440A' },
  out:     { background: 'rgba(220,68,10,0.3)', color: '#fff' },
  ok:      { background: 'rgba(26,127,55,0.15)', color: '#3fb950' },
  pill:    { display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', background: '#1f2530', color: '#8b949e', marginRight: 4 },
  totalsBar: { display: 'flex', gap: 24, padding: '14px 20px', background: '#0d1117', borderBottom: '1px solid #2a3441' },
  totalLbl: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', display: 'block', marginBottom: 4 },
  totalVal: { fontSize: 18, fontWeight: 700, color: '#f0f4f8' },
};

const LOW_STOCK_THRESHOLD = 10;

function statusBadge(qty) {
  if (qty <= 0) return { ...S.badge, ...S.out, label: 'Out' };
  if (qty < LOW_STOCK_THRESHOLD) return { ...S.badge, ...S.low, label: 'Low' };
  return { ...S.badge, ...S.ok, label: 'OK' };
}

export default function InventoryTool() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [sortKey, setSortKey] = useState('totalAvailable');
  const [sortDir, setSortDir] = useState('asc');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_inventory' }),
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
  };

  useEffect(() => { load(); }, []);

  const flatVariants = useMemo(() => {
    if (!data?.stores) return [];
    const rows = [];
    for (const [role, s] of Object.entries(data.stores)) {
      for (const v of s.variants) rows.push({ ...v, storeRole: role, storeDomain: s.store });
    }
    return rows;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = flatVariants.filter(v => {
      if (storeFilter !== 'all' && v.storeRole !== storeFilter) return false;
      if (q && !`${v.productTitle} ${v.variantTitle} ${v.sku}`.toLowerCase().includes(q)) return false;
      const qty = v.totalAvailable;
      if (stockFilter === 'out' && qty > 0) return false;
      if (stockFilter === 'low' && (qty <= 0 || qty >= LOW_STOCK_THRESHOLD)) return false;
      if (stockFilter === 'ok' && qty < LOW_STOCK_THRESHOLD) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = sortKey === 'productTitle' ? a.productTitle : a[sortKey];
      const bv = sortKey === 'productTitle' ? b.productTitle : b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [flatVariants, search, storeFilter, stockFilter, sortKey, sortDir]);

  const totals = useMemo(() => {
    const t = { variants: filtered.length, available: 0, onHand: 0, committed: 0, incoming: 0, retailValue: 0 };
    for (const v of filtered) {
      t.available += v.totalAvailable;
      t.onHand += v.totalOnHand;
      t.committed += v.totalCommitted;
      t.incoming += v.totalIncoming;
      t.retailValue += v.totalAvailable * v.price;
    }
    return t;
  }, [filtered]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const exportCSV = () => {
    const headers = ['Store', 'Product', 'Variant', 'SKU', 'Status', 'Price', 'Available', 'On Hand', 'Committed', 'Incoming'];
    const rows = filtered.map(v => [
      v.storeRole, v.productTitle, v.variantTitle, v.sku, v.productStatus,
      v.price, v.totalAvailable, v.totalOnHand, v.totalCommitted, v.totalIncoming,
    ]);
    const csv = [headers, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `howl_inventory_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const storeRoles = Object.keys(data?.stores || {});
  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Inventory</h1>
      <div style={S.sub}>
        Live snapshot from Shopify Admin API
        {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
        {data?._meta && ` · ${data._meta.variantsScanned} tracked variants`}
      </div>

      <div style={S.toolbar}>
        <input
          style={S.input}
          placeholder="Search product, variant, SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {storeRoles.length > 1 && (
          <select style={S.select} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="all">All stores</option>
            {storeRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <select style={S.select} value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
          <option value="all">All stock levels</option>
          <option value="out">Out of stock</option>
          <option value="low">Low (&lt; {LOW_STOCK_THRESHOLD})</option>
          <option value="ok">In stock</option>
        </select>
        <button style={S.ghostBtn} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button style={S.btn} onClick={exportCSV} disabled={filtered.length === 0}>Export CSV</button>
      </div>

      {error && <div style={S.err}>Error: {error}</div>}

      {data && (
        <div style={S.card}>
          <div style={S.totalsBar}>
            <div><span style={S.totalLbl}>Variants</span><span style={S.totalVal}>{totals.variants.toLocaleString()}</span></div>
            <div><span style={S.totalLbl}>Available</span><span style={S.totalVal}>{totals.available.toLocaleString()}</span></div>
            <div><span style={S.totalLbl}>On Hand</span><span style={S.totalVal}>{totals.onHand.toLocaleString()}</span></div>
            <div><span style={S.totalLbl}>Committed</span><span style={S.totalVal}>{totals.committed.toLocaleString()}</span></div>
            <div><span style={S.totalLbl}>Incoming</span><span style={S.totalVal}>{totals.incoming.toLocaleString()}</span></div>
            <div><span style={S.totalLbl}>Retail Value</span><span style={S.totalVal}>${Math.round(totals.retailValue).toLocaleString()}</span></div>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={{ ...S.th, cursor: 'pointer' }} onClick={() => toggleSort('productTitle')}>Product{sortArrow('productTitle')}</th>
                  <th style={S.th}>Variant</th>
                  <th style={S.th}>SKU</th>
                  <th style={S.th}>Status</th>
                  <th style={{ ...S.th, ...S.thNum, cursor: 'pointer' }} onClick={() => toggleSort('totalAvailable')}>Available{sortArrow('totalAvailable')}</th>
                  <th style={{ ...S.th, ...S.thNum, cursor: 'pointer' }} onClick={() => toggleSort('totalCommitted')}>Committed{sortArrow('totalCommitted')}</th>
                  <th style={{ ...S.th, ...S.thNum, cursor: 'pointer' }} onClick={() => toggleSort('totalOnHand')}>On Hand{sortArrow('totalOnHand')}</th>
                  <th style={{ ...S.th, ...S.thNum, cursor: 'pointer' }} onClick={() => toggleSort('totalIncoming')}>Incoming{sortArrow('totalIncoming')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const badge = statusBadge(v.totalAvailable);
                  return (
                    <tr key={`${v.storeRole}-${v.variantId}`}>
                      <td style={S.td}>
                        {storeRoles.length > 1 && <span style={S.pill}>{v.storeRole}</span>}
                        {v.productTitle}
                      </td>
                      <td style={{ ...S.td, ...S.tdMuted }}>{v.variantTitle === 'Default Title' ? '—' : v.variantTitle}</td>
                      <td style={{ ...S.td, ...S.tdMuted }}>{v.sku || '—'}</td>
                      <td style={S.td}>
                        <span style={{ ...S.badge, ...(badge.label === 'Out' ? S.out : badge.label === 'Low' ? S.low : S.ok) }}>{badge.label}</span>
                      </td>
                      <td style={{ ...S.td, ...S.tdNum, fontWeight: 600 }}>{v.totalAvailable.toLocaleString()}</td>
                      <td style={{ ...S.td, ...S.tdNum, ...S.tdMuted }}>{v.totalCommitted.toLocaleString()}</td>
                      <td style={{ ...S.td, ...S.tdNum, ...S.tdMuted }}>{v.totalOnHand.toLocaleString()}</td>
                      <td style={{ ...S.td, ...S.tdNum, ...S.tdMuted }}>{v.totalIncoming || '—'}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ ...S.td, ...S.tdMuted, textAlign: 'center', padding: 40 }}>
                    {loading ? 'Loading…' : 'No variants match these filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
