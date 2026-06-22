import React, { useEffect, useState, useCallback } from 'react';
import { PRODUCTS, ANGLES } from '../data';

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1400 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 },
  filters: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
  input: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', minWidth: 180 },
  select: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer' },
  ghostBtn: { padding: '8px 14px', background: 'none', border: '1px solid #dedbd3', color: '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#88857f', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #dedbd3' },
  td: { fontSize: 11, color: '#343330', padding: '14px 12px', borderBottom: '1px solid #f4f1ea', verticalAlign: 'top' },
  mono: { fontFamily: "'JetBrains Mono', monospace" },
  adName: { fontSize: 12, color: '#171717', fontWeight: 500, marginBottom: 3 },
  creatorPill: { display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 10, background: 'rgba(220,68,10,0.12)', color: '#d84a17', letterSpacing: 1, fontWeight: 600 },
  sourceSub: { display: 'block', marginTop: 5, fontSize: 9, color: '#77746f', textTransform: 'capitalize' },
  copy: { fontSize: 10, color: '#77746f', lineHeight: 1.5, maxWidth: 360 },
  link: { fontSize: 10, color: '#77746f', letterSpacing: 1.5, textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px dashed #dedbd3' },
  empty: { border: '2px dashed #dedbd3', borderRadius: 6, padding: '72px 32px', textAlign: 'center', color: '#88857f' },
  stat: { border: '1px solid #dedbd3', borderRadius: 6, padding: '14px 18px', background: '#fff', minWidth: 140 },
  statLabel: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 4 },
  statVal: { fontSize: 22, color: '#171717' },
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
function sourceTypeLabel(type) {
  return ({
    external_creator: 'Creator UGC',
    internal_employee: 'Internal employee',
    founder: 'Founder',
    tool_generated: 'Made in tool',
  })[type] || (type ? type.replaceAll('_', ' ') : 'Unattributed');
}
function sourceLabel(row) {
  return row.creator || row.source_label || sourceTypeLabel(row.source_type);
}

export default function LaunchLogTool() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [angleFilter, setAngleFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

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

  const sources = Array.from(new Set(rows.map(sourceLabel).filter(Boolean))).sort();
  const angles = Array.from(new Set(rows.map(r => r.angle_id).filter(Boolean)));
  const users = Array.from(new Set(rows.map(r => r.launched_by_email).filter(Boolean))).sort();

  const filtered = rows.filter(r => {
    if (sourceFilter && sourceLabel(r) !== sourceFilter) return false;
    if (angleFilter && r.angle_id !== angleFilter) return false;
    if (userFilter && r.launched_by_email !== userFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.ad_name || ''} ${r.headline || ''} ${r.primary_text || ''} ${r.creator || ''} ${r.source_label || ''} ${r.source_type || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Stats (all rows, not filtered)
  const last7d = rows.filter(r => (Date.now() - new Date(r.launched_at).getTime()) < 7 * 86400 * 1000).length;
  const last24h = rows.filter(r => (Date.now() - new Date(r.launched_at).getTime()) < 86400 * 1000).length;
  const uniqueSources = new Set(rows.map(sourceLabel).filter(Boolean)).size;
  const creatorLaunches = rows.filter(r => r.creator_id || r.source_type === 'external_creator' || (!r.source_type && r.creator)).length;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Insights</div>
          <div className="display-lg" style={{ color: '#171717' }}>Launch Log</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#77746f', marginTop: 6 }}>
            Every ad you've ever pushed, in the order it went out.
          </div>
        </div>
        <button style={S.ghostBtn} onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ padding: '10px 14px', border: '1px solid rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.1)', color: '#b42318', fontSize: 11, borderRadius: 4, marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={S.stat}>
          <div style={S.statLabel}>Total launches</div>
          <div className="display-md" style={{ color: '#171717' }}>{rows.length}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Last 24h</div>
          <div className="display-md" style={{ color: '#171717' }}>{last24h}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Last 7 days</div>
          <div className="display-md" style={{ color: '#171717' }}>{last7d}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Sources used</div>
          <div className="display-md" style={{ color: '#171717' }}>{uniqueSources}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Creator UGC</div>
          <div className="display-md" style={{ color: '#171717' }}>{creatorLaunches}</div>
        </div>
      </div>

      <div style={S.filters}>
        <input style={S.input} placeholder="Search ad name, copy, source…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={S.select} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {sources.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={S.select} value={angleFilter} onChange={e => setAngleFilter(e.target.value)}>
          <option value="">All angles</option>
          {angles.map(a => <option key={a} value={a}>{angleName(a)}</option>)}
        </select>
        <select style={S.select} value={userFilter} onChange={e => setUserFilter(e.target.value)}>
          <option value="">All users</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <span style={{ fontSize: 10, color: '#88857f', letterSpacing: 1.5 }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {!loading && rows.length === 0 && (
        <div style={S.empty}>
          <div className="display-lg" style={{ color: '#171717', marginBottom: 10 }}>Nothing launched yet.</div>
          <div className="display-italic" style={{ fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
            Ads you push from the Launcher will appear here with full metadata — source, angle, copy used, timestamp.
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>When</th>
              <th style={S.th}>Ad</th>
              <th style={S.th}>Source</th>
              <th style={S.th}>Launched by</th>
              <th style={S.th}>Product / Angle</th>
              <th style={S.th}>Copy</th>
              <th style={S.th}>Meta</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, ...S.mono, whiteSpace: 'nowrap', color: '#77746f' }}>{fmtDate(r.launched_at)}</td>
                <td style={S.td}>
                  <div style={S.adName}>{r.ad_name}</div>
                  <div style={{ ...S.mono, fontSize: 9, color: '#88857f' }}>{r.drive_file_name}</div>
                </td>
                <td style={S.td}>
                  {sourceLabel(r) ? <span style={S.creatorPill}>{sourceLabel(r)}</span> : <span style={{ color: '#88857f' }}>—</span>}
                  <span style={S.sourceSub}>{sourceTypeLabel(r.source_type || (r.creator_id || r.creator ? 'external_creator' : null))}</span>
                </td>
                <td style={{ ...S.td, fontSize: 10, color: '#77746f' }}>
                  {r.launched_by_email || <span style={{ color: '#88857f' }}>—</span>}
                </td>
                <td style={{ ...S.td, fontSize: 10, color: '#77746f' }}>
                  <div>{productName(r.product_id)}</div>
                  <div style={{ color: '#88857f' }}>{angleName(r.angle_id)}</div>
                </td>
                <td style={S.td}>
                  {r.headline && <div style={{ fontSize: 11, color: '#171717', fontWeight: 500, marginBottom: 3 }}>{r.headline}</div>}
                  {r.primary_text && <div style={S.copy}>{r.primary_text}</div>}
                </td>
                <td style={S.td}>
                  <a
                    href={`https://www.facebook.com/adsmanager/manage/ads?act=${(r.adset_id || '').split('_')[0]}&selected_ad_ids=${r.ad_id}`}
                    target="_blank" rel="noreferrer" style={S.link}
                  >
                    Open ↗
                  </a>
                  <div style={{ ...S.mono, fontSize: 9, color: '#88857f', marginTop: 4 }}>{r.ad_id}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
