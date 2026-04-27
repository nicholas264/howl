import React, { useEffect, useState, useCallback } from 'react';
import { PRODUCTS, ANGLES } from '../data';

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1400 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 },
  filters: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', minWidth: 180 },
  select: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer' },
  ghostBtn: { padding: '8px 14px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#6e7681', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #2a3441' },
  td: { fontSize: 11, color: '#c9d1d9', padding: '14px 12px', borderBottom: '1px solid #1c2330', verticalAlign: 'top' },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  adName: { fontSize: 12, color: '#f0f4f8', fontWeight: 500, marginBottom: 3 },
  creatorPill: { display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 10, background: 'rgba(220,68,10,0.12)', color: '#DC440A', letterSpacing: 1, fontWeight: 600 },
  copy: { fontSize: 10, color: '#8b949e', lineHeight: 1.5, maxWidth: 360 },
  link: { fontSize: 10, color: '#8b949e', letterSpacing: 1.5, textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px dashed #2a3441' },
  empty: { border: '2px dashed #2a3441', borderRadius: 6, padding: '72px 32px', textAlign: 'center', color: '#6e7681' },
  stat: { border: '1px solid #2a3441', borderRadius: 6, padding: '14px 18px', background: '#161b22', minWidth: 140 },
  statLabel: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', marginBottom: 4 },
  statVal: { fontSize: 22, color: '#f0f4f8' },
};

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function productName(id) { return PRODUCTS.find(p => p.id === id)?.name || id || '—'; }
function angleName(id) { return ANGLES.find(a => a.id === id)?.label || id || '—'; }

export default function LaunchLogTool() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [angleFilter, setAngleFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/db/launch-history?limit=500');
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setRows(d.rows || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const creators = Array.from(new Set(rows.map(r => r.creator).filter(Boolean))).sort();
  const angles = Array.from(new Set(rows.map(r => r.angle_id).filter(Boolean)));

  const filtered = rows.filter(r => {
    if (creatorFilter && r.creator !== creatorFilter) return false;
    if (angleFilter && r.angle_id !== angleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.ad_name || ''} ${r.headline || ''} ${r.primary_text || ''} ${r.creator || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Stats (all rows, not filtered)
  const last7d = rows.filter(r => (Date.now() - new Date(r.launched_at).getTime()) < 7 * 86400 * 1000).length;
  const last24h = rows.filter(r => (Date.now() - new Date(r.launched_at).getTime()) < 86400 * 1000).length;
  const uniqueCreators = new Set(rows.map(r => r.creator).filter(Boolean)).size;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Insights</div>
          <div className="display-lg" style={{ color: '#f0f4f8' }}>Launch Log</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', marginTop: 6 }}>
            Every ad you've ever pushed, in the order it went out.
          </div>
        </div>
        <button style={S.ghostBtn} onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ padding: '10px 14px', border: '1px solid rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.1)', color: '#f85149', fontSize: 11, borderRadius: 4, marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={S.stat}>
          <div style={S.statLabel}>Total launches</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>{rows.length}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Last 24h</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>{last24h}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Last 7 days</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>{last7d}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Creators used</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>{uniqueCreators}</div>
        </div>
      </div>

      <div style={S.filters}>
        <input style={S.input} placeholder="Search ad name, copy, creator…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={S.select} value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}>
          <option value="">All creators</option>
          {creators.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={S.select} value={angleFilter} onChange={e => setAngleFilter(e.target.value)}>
          <option value="">All angles</option>
          {angles.map(a => <option key={a} value={a}>{angleName(a)}</option>)}
        </select>
        <span style={{ fontSize: 10, color: '#6e7681', letterSpacing: 1.5 }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {!loading && rows.length === 0 && (
        <div style={S.empty}>
          <div className="display-lg" style={{ color: '#f0f4f8', marginBottom: 10 }}>Nothing launched yet.</div>
          <div className="display-italic" style={{ fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
            Ads you push from the UGC Inbox will appear here with full metadata — creator, angle, copy used, timestamp.
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>When</th>
              <th style={S.th}>Ad</th>
              <th style={S.th}>Creator</th>
              <th style={S.th}>Product / Angle</th>
              <th style={S.th}>Copy</th>
              <th style={S.th}>Meta</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, ...S.mono, whiteSpace: 'nowrap', color: '#8b949e' }}>{fmtDate(r.launched_at)}</td>
                <td style={S.td}>
                  <div style={S.adName}>{r.ad_name}</div>
                  <div style={{ ...S.mono, fontSize: 9, color: '#6e7681' }}>{r.drive_file_name}</div>
                </td>
                <td style={S.td}>
                  {r.creator && <span style={S.creatorPill}>{r.creator}</span>}
                </td>
                <td style={{ ...S.td, fontSize: 10, color: '#8b949e' }}>
                  <div>{productName(r.product_id)}</div>
                  <div style={{ color: '#6e7681' }}>{angleName(r.angle_id)}</div>
                </td>
                <td style={S.td}>
                  {r.headline && <div style={{ fontSize: 11, color: '#f0f4f8', fontWeight: 500, marginBottom: 3 }}>{r.headline}</div>}
                  {r.primary_text && <div style={S.copy}>{r.primary_text}</div>}
                </td>
                <td style={S.td}>
                  <a
                    href={`https://www.facebook.com/adsmanager/manage/ads?act=${(r.adset_id || '').split('_')[0]}&selected_ad_ids=${r.ad_id}`}
                    target="_blank" rel="noreferrer" style={S.link}
                  >
                    Open ↗
                  </a>
                  <div style={{ ...S.mono, fontSize: 9, color: '#6e7681', marginTop: 4 }}>{r.ad_id}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
