import { apiFetch as fetch } from '../lib/apiFetch.js';
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
async function apiUpdate({ id, label, headline, primaryText, productIds }) {
  const r = await fetch('/api/db/copy-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update', id, label, headline, primaryText, productIds }),
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
      return true;
    } catch (err) {
      alert(`Save failed: ${err.message}`);
      return false;
    }
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
  const update = async (variant) => {
    try {
      const row = await apiUpdate(variant);
      setVariants(prev => prev.map(v => v.id === variant.id ? {
        id: row.id, label: row.label || '', headline: row.headline || '', primaryText: row.primary_text || '',
        productIds: Array.isArray(row.product_ids) ? row.product_ids : [], createdAt: row.created_at,
      } : v));
      return true;
    } catch (err) {
      alert(`Update failed: ${err.message}`);
      return false;
    }
  };
  const remove = async (id) => {
    try {
      await apiDelete(id);
      setVariants(prev => prev.filter(v => v.id !== id));
      return true;
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      return false;
    }
  };

  return { variants, add, remove, update, updateProducts, refresh, loaded, error };
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function mentionedProductIds(value) {
  const text = String(value || '').toLowerCase();
  return PRODUCTS.filter(product => {
    if (product.id === 'r4mkii') return /\br4(?:\s*mkii)?\b/.test(text) || text.includes('the-howl-r4');
    return new RegExp(`\\b${product.id}\\b`).test(text) || text.includes(`the-howl-${product.id}`);
  }).map(product => product.id);
}

function inferProductIds(variant) {
  if (variant.productIds?.length) return variant.productIds;
  const mentions = mentionedProductIds(`${variant.label} ${variant.headline} ${variant.primaryText}`);
  return mentions.length === 1 ? mentions : [];
}

export function getCopyWarnings(variant) {
  const warnings = [];
  const productIds = variant.productIds || [];
  const text = `${variant.label || ''} ${variant.headline || ''} ${variant.primaryText || ''}`;
  const mentions = mentionedProductIds(text);
  if (wordCount(variant.headline) > 6) warnings.push('Headline is longer than 6 words.');
  if (!productIds.length && mentions.length === 1) {
    const product = PRODUCTS.find(item => item.id === mentions[0]);
    warnings.push(`Copy names ${product?.name || mentions[0]} but is available to every product.`);
  }
  if (productIds.length === 1) {
    const product = PRODUCTS.find(item => item.id === productIds[0]);
    const expectedWeight = Number.parseFloat(product?.specs?.weight);
    const weightClaim = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/gi)].find(match => {
      const context = text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20);
      return !/\b(?:tank|lighter|heavier)\b/i.test(context);
    });
    if (weightClaim && Number.isFinite(expectedWeight) && Number(weightClaim[1]) !== expectedWeight) {
      warnings.push(`Check weight claim: ${product.name} is listed as ${product.specs.weight}.`);
    }
  }
  if (/\b(?:UL|CSA|ETL)\s+certified\b/i.test(text)) warnings.push('Verify certification language before launch.');
  return warnings;
}

const S = {
  wrap: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', marginBottom: 20 },
  header: { padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', width: '100%', border: 0, background: 'transparent', textAlign: 'left', fontFamily: 'inherit' },
  body: { padding: 16, borderTop: '1px solid #dedbd3' },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f', marginBottom: 6, display: 'block' },
  input: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  textarea: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%', resize: 'vertical', minHeight: 60 },
  addRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'flex-end' },
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
  warning: { marginTop: 6, color: '#9f3212', fontSize: 10, lineHeight: 1.35 },
  count: { fontSize: 10, color: '#88857f', letterSpacing: 2, textTransform: 'uppercase' },
};

export default function CopyLibrary({ library, onUse }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: '', label: '', headline: '', primaryText: '' });
  const [editing, setEditing] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [query, setQuery] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const qualityIssueCount = library.variants.filter(variant => getCopyWarnings(variant).length > 0).length;
  const inferredFormProducts = inferProductIds({
    productIds: form.productId ? [form.productId] : [],
    label: form.label,
    headline: form.headline,
    primaryText: form.primaryText,
  });
  const normalizedQuery = query.trim().toLowerCase();
  const visibleVariants = library.variants.filter(variant => {
    const matchesQuery = !normalizedQuery || `${variant.label} ${variant.headline} ${variant.primaryText}`.toLowerCase().includes(normalizedQuery);
    const matchesProduct = productFilter === 'all'
      || (productFilter === 'unassigned' ? !variant.productIds?.length : variant.productIds?.includes(productFilter));
    return matchesQuery && matchesProduct;
  });

  const submit = async () => {
    if (!form.headline.trim() && !form.primaryText.trim()) return;
    const draft = {
      productIds: form.productId ? [form.productId] : [],
      label: form.label.trim(),
      headline: form.headline.trim(),
      primaryText: form.primaryText.trim(),
    };
    setSavingId('new');
    const saved = await library.add({ ...draft, productIds: inferProductIds(draft) });
    setSavingId(null);
    if (saved) setForm({ productId: '', label: '', headline: '', primaryText: '' });
  };

  const beginEdit = (variant) => setEditing({
    id: variant.id,
    productId: variant.productIds?.[0] || '',
    label: variant.label || '',
    headline: variant.headline || '',
    primaryText: variant.primaryText || '',
  });

  const saveEdit = async () => {
    if (!editing || (!editing.headline.trim() && !editing.primaryText.trim())) return;
    setSavingId(editing.id);
    const saved = await library.update({
      id: editing.id,
      productIds: editing.productId ? [editing.productId] : [],
      label: editing.label.trim(),
      headline: editing.headline.trim(),
      primaryText: editing.primaryText.trim(),
    });
    setSavingId(null);
    if (saved) setEditing(null);
  };

  const remove = async (variant) => {
    const name = variant.label || variant.headline || 'this copy option';
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    const removed = await library.remove(variant.id);
    if (removed && editing?.id === variant.id) setEditing(null);
  };

  return (
    <div style={S.wrap}>
      <button type="button" style={S.header} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Reusable</div>
          <div className="display-md" style={{ color: '#171717' }}>
            Copy Library <span style={{ ...S.count, marginLeft: 6, fontFamily: "'JetBrains Mono', monospace" }}>· {library.variants.length} saved {qualityIssueCount > 0 ? `· ${qualityIssueCount} need review` : ''} {library.loaded ? '' : '(loading…)'}</span>
          </div>
        </div>
        <div style={S.count}>{open ? '▲ Hide' : '▼ Show'}</div>
      </button>
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
            <button
              style={S.btn(savingId === 'new' || (!form.headline.trim() && !form.primaryText.trim()))}
              disabled={savingId === 'new' || (!form.headline.trim() && !form.primaryText.trim())}
              onClick={submit}
            >{savingId === 'new' ? 'Saving…' : 'Save'}</button>
          </div>
          {!form.productId && inferredFormProducts.length === 1 && (
            <div style={{ marginTop: 7, color: '#5d5a55', fontSize: 10 }}>
              {PRODUCTS.find(product => product.id === inferredFormProducts[0])?.name} detected and will be assigned on save.
            </div>
          )}

          {library.variants.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <input
                  aria-label="Search saved copy"
                  style={S.input}
                  placeholder="Search labels, headlines, or copy"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
                <select aria-label="Filter saved copy by product" style={S.input} value={productFilter} onChange={event => setProductFilter(event.target.value)}>
                  <option value="all">Every product</option>
                  <option value="unassigned">All-product copy</option>
                  {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <span style={S.count}>{visibleVariants.length} shown</span>
              </div>
              {visibleVariants.map(v => (
                <div className="copy-library-card" key={v.id} style={S.variantCard}>
                  {editing?.id === v.id ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <select
                        aria-label="Edit product"
                        style={S.input}
                        value={editing.productId}
                        onChange={e => setEditing(p => ({ ...p, productId: e.target.value }))}
                      >
                        <option value="">All products</option>
                        {PRODUCTS.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                      <input aria-label="Edit label" style={S.input} value={editing.label} onChange={e => setEditing(p => ({ ...p, label: e.target.value }))} />
                      <input aria-label="Edit headline" style={S.input} value={editing.headline} onChange={e => setEditing(p => ({ ...p, headline: e.target.value }))} />
                      <textarea aria-label="Edit primary text" style={S.textarea} value={editing.primaryText} onChange={e => setEditing(p => ({ ...p, primaryText: e.target.value }))} />
                      {getCopyWarnings({ ...editing, productIds: editing.productId ? [editing.productId] : [] }).map(warning => (
                        <div key={warning} style={S.warning}>{warning}</div>
                      ))}
                    </div>
                  ) : <div>
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
                    {getCopyWarnings(v).map(warning => <div key={warning} style={S.warning}>{warning}</div>)}
                  </div>}
                  <div className="copy-library-actions" style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    {editing?.id === v.id ? (
                      <>
                        <button style={S.btn(savingId === v.id || (!editing.headline.trim() && !editing.primaryText.trim()))} disabled={savingId === v.id || (!editing.headline.trim() && !editing.primaryText.trim())} onClick={saveEdit}>{savingId === v.id ? 'Saving…' : 'Save'}</button>
                        <button style={S.deleteBtn} disabled={savingId === v.id} onClick={() => setEditing(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {onUse && <button style={S.btn(false)} onClick={() => onUse(v)}>Use</button>}
                        <button style={S.deleteBtn} onClick={() => beginEdit(v)}>Edit</button>
                        <button style={S.deleteBtn} onClick={() => remove(v)}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {visibleVariants.length === 0 && (
                <div style={{ padding: '18px 4px', color: '#77746f', fontSize: 11 }}>No saved copy matches these filters.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
