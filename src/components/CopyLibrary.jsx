import React, { useEffect, useState, useCallback } from 'react';

const LS_LEGACY = 'howl_copy_library';
const LS_MIGRATED = 'howl_copy_library_migrated_v1';

async function apiGet() {
  const r = await fetch('/api/db/copy-library');
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return (d.rows || []).map(r => ({
    id: r.id,
    label: r.label || '',
    headline: r.headline || '',
    primaryText: r.primary_text || '',
    createdAt: r.created_at,
  }));
}
async function apiAdd({ label, headline, primaryText }) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', label, headline, primaryText }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.row;
}
async function apiDelete(id) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
}
async function apiBulkImport(items) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bulk_import', items }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.inserted;
}

export function useCopyLibrary() {
  const [variants, setVariants] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiGet();
      setVariants(rows);
      setLoaded(true);
    } catch (err) { console.error('Copy library load:', err); }
  }, []);

  // One-time migration: move localStorage entries into DB, then clear local.
  useEffect(() => {
    (async () => {
      await refresh();
      if (localStorage.getItem(LS_MIGRATED)) return;
      try {
        const legacy = JSON.parse(localStorage.getItem(LS_LEGACY) || '[]');
        if (Array.isArray(legacy) && legacy.length > 0) {
          const n = await apiBulkImport(legacy.map(v => ({
            label: v.label || '', headline: v.headline || '', primaryText: v.primaryText || '',
          })));
          if (n > 0) {
            localStorage.setItem(LS_MIGRATED, '1');
            localStorage.removeItem(LS_LEGACY);
            await refresh();
          }
        } else {
          localStorage.setItem(LS_MIGRATED, '1');
        }
      } catch (err) { console.error('Copy library migration failed:', err); }
    })();
  }, [refresh]);

  const add = async (v) => {
    try {
      const row = await apiAdd(v);
      setVariants(prev => [{
        id: row.id, label: row.label || '', headline: row.headline || '', primaryText: row.primary_text || '', createdAt: row.created_at,
      }, ...prev]);
    } catch (err) { alert(`Save failed: ${err.message}`); }
  };
  const remove = async (id) => {
    try {
      await apiDelete(id);
      setVariants(prev => prev.filter(v => v.id !== id));
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  };

  return { variants, add, remove, refresh, loaded };
}

const S = {
  wrap: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', marginBottom: 20 },
  header: { padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' },
  body: { padding: 16, borderTop: '1px solid #2a3441' },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 6, display: 'block' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  textarea: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%', resize: 'vertical', minHeight: 60 },
  addRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 10, alignItems: 'flex-end' },
  btn: (disabled) => ({
    padding: '8px 14px', background: disabled ? '#2a3441' : '#DC440A', border: 'none',
    color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  variantCard: { border: '1px solid #2a3441', borderRadius: 4, padding: 10, marginTop: 8, background: '#0d1117', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 },
  vLabel: { fontSize: 10, color: '#DC440A', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 },
  vHeadline: { fontSize: 12, color: '#f0f4f8', fontWeight: 600, marginBottom: 4 },
  vBody: { fontSize: 11, color: '#8b949e', lineHeight: 1.4 },
  deleteBtn: { background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3, padding: '4px 8px', fontFamily: 'inherit' },
  count: { fontSize: 10, color: '#6e7681', letterSpacing: 2, textTransform: 'uppercase' },
};

export default function CopyLibrary({ library, onUse }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: '', headline: '', primaryText: '' });

  const submit = async () => {
    if (!form.headline.trim() && !form.primaryText.trim()) return;
    await library.add({ label: form.label.trim(), headline: form.headline.trim(), primaryText: form.primaryText.trim() });
    setForm({ label: '', headline: '', primaryText: '' });
  };

  return (
    <div style={S.wrap}>
      <div style={S.header} onClick={() => setOpen(o => !o)}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Reusable</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>
            Copy Library <span style={{ ...S.count, marginLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>· {library.variants.length} saved {library.loaded ? '' : '(loading…)'}</span>
          </div>
        </div>
        <div style={S.count}>{open ? '▲ Hide' : '▼ Show'}</div>
      </div>
      {open && (
        <div style={S.body}>
          <div style={S.addRow}>
            <div>
              <label style={S.label}>Label</label>
              <input style={S.input} placeholder="e.g. Burn ban hook" value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} />
            </div>
            <div>
              <label style={S.label}>Headline</label>
              <input style={S.input} placeholder="Punchy 6 words max" value={form.headline} onChange={e => setForm(p => ({ ...p, headline: e.target.value }))} />
            </div>
            <div>
              <label style={S.label}>Primary Text</label>
              <textarea style={S.textarea} placeholder="Body copy, 2-3 sentences" value={form.primaryText} onChange={e => setForm(p => ({ ...p, primaryText: e.target.value }))} />
            </div>
            <button style={S.btn(!form.headline.trim() && !form.primaryText.trim())} onClick={submit}>Save</button>
          </div>

          {library.variants.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {library.variants.map(v => (
                <div key={v.id} style={S.variantCard}>
                  <div>
                    {v.label && <div style={S.vLabel}>{v.label}</div>}
                    {v.headline && <div style={S.vHeadline}>{v.headline}</div>}
                    {v.primaryText && <div style={S.vBody}>{v.primaryText}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    {onUse && <button style={S.btn(false)} onClick={() => onUse(v)}>Use</button>}
                    <button style={S.deleteBtn} onClick={() => library.remove(v.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
