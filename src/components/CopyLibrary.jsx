import React, { useEffect, useState, useCallback } from 'react';
import { PRODUCTS } from '../data';

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
    productIds: Array.isArray(r.product_ids) ? r.product_ids : [],
    createdAt: r.created_at,
  }));
}
async function apiAdd({ label, headline, primaryText, productIds }) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', label, headline, primaryText, productIds }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.row;
}
async function apiUpdateProducts(id, productIds) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_products', id, productIds }),
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
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const rows = await apiGet();
      setVariants(rows);
      setError('');
      setLoaded(true);
    } catch (err) {
      console.error('Copy library load:', err);
      setError(err.message || 'Copy library could not load');
      setLoaded(true);
    }
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
        id: row.id, label: row.label || '', headline: row.headline || '', primaryText: row.primary_text || '',
        productIds: Array.isArray(row.product_ids) ? row.product_ids : [], createdAt: row.created_at,
      }, ...prev]);
    } catch (err) { alert(`Save failed: ${err.message}`); }
  };
  const updateProducts = async (id, productIds) => {
    try {
      const row = await apiUpdateProducts(id, productIds);
      setVariants(prev => prev.map(v => v.id === id ? {
        ...v,
        productIds: Array.isArray(row.product_ids) ? row.product_ids : [],
      } : v));
    } catch (err) { alert(`Update failed: ${err.message}`); }
  };
  const remove = async (id) => {
    try {
      await apiDelete(id);
      setVariants(prev => prev.filter(v => v.id !== id));
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  };

  return { variants, add, remove, updateProducts, refresh, loaded, error };
}

const S = {
  wrap: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', marginBottom: 20 },
  header: { padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' },
  body: { padding: 16, borderTop: '1px solid #dedbd3' },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f', marginBottom: 6, display: 'block' },
  input: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  textarea: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%', resize: 'vertical', minHeight: 60 },
  addRow: { display: 'grid', gridTemplateColumns: 'minmax(120px, .8fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(220px, 2fr) auto', gap: 10, alignItems: 'flex-end' },
  btn: (disabled) => ({
    padding: '8px 14px', background: disabled ? '#dedbd3' : '#d84a17', border: 'none',
    color: disabled ? '#88857f' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  variantCard: { border: '1px solid #dedbd3', borderRadius: 4, padding: 10, marginTop: 8, background: '#fff', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 },
  vLabel: { fontSize: 10, color: '#d84a17', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 },
  vHeadline: { fontSize: 12, color: '#171717', fontWeight: 600, marginBottom: 4 },
  vBody: { fontSize: 11, color: '#77746f', lineHeight: 1.4 },
  deleteBtn: { background: 'none', border: '1px solid #dedbd3', color: '#77746f', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3, padding: '4px 8px', fontFamily: 'inherit' },
  count: { fontSize: 10, color: '#88857f', letterSpacing: 2, textTransform: 'uppercase' },
};

export default function CopyLibrary({ library, onUse }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: '', label: '', headline: '', primaryText: '' });

  const submit = async () => {
    if (!form.headline.trim() && !form.primaryText.trim()) return;
    await library.add({
      productIds: form.productId ? [form.productId] : [],
      label: form.label.trim(),
      headline: form.headline.trim(),
      primaryText: form.primaryText.trim(),
    });
    setForm({ productId: '', label: '', headline: '', primaryText: '' });
  };

  return (
    <div style={S.wrap}>
      <div style={S.header} onClick={() => setOpen(o => !o)}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Reusable</div>
          <div className="display-md" style={{ color: '#171717' }}>
            Copy Library <span style={{ ...S.count, marginLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>· {library.variants.length} saved {library.loaded ? '' : '(loading…)'}</span>
          </div>
        </div>
        <div style={S.count}>{open ? '▲ Hide' : '▼ Show'}</div>
      </div>
      {open && (
        <div style={S.body}>
          {library.error && (
            <div style={{ marginBottom: 12, padding: '8px 10px', border: '1px solid #efb4a2', background: '#fff4ef', color: '#9f3212', fontSize: 10, borderRadius: 4 }}>
              Copy Library could not load. <button type="button" onClick={library.refresh} style={{ border: 0, padding: 0, background: 'transparent', color: '#d84a17', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            </div>
          )}
          <div style={S.addRow}>
            <div>
              <label style={S.label}>Product</label>
              <select style={S.input} value={form.productId} onChange={e => setForm(p => ({ ...p, productId: e.target.value }))}>
                <option value="">All products</option>
                {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </div>
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
                    <div style={{ marginBottom: 6 }}>
                      <select
                        aria-label={`Product for ${v.label || v.headline || 'saved copy'}`}
                        style={{ ...S.input, width: 'auto', minWidth: 130, padding: '5px 7px', fontSize: 10 }}
                        value={v.productIds?.[0] || ''}
                        onChange={e => library.updateProducts(v.id, e.target.value ? [e.target.value] : [])}
                      >
                        <option value="">All products</option>
                        {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    </div>
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
