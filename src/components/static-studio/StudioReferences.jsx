import { useState } from 'react';
import { studioRequest } from '../../lib/static-studio/client.js';

export default function StudioReferences({assets, onImport}) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(null);
  const [images, setImages] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [sort, setSort] = useState('purchases');
  async function load(variant) {
    setBusy(true); setError('');
    if (variant) { setSelected(variant); setImages([]); }
    try {
      const result = await studioRequest({action:'account-references', ...(variant ? {variantKey: variant.key} : {})});
      if (variant) setImages(result.images); else { setData(result); setSelected(null); setImages([]); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const rows = (data?.variants || []).filter(row => row.name?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  return <section className="ss-account-references">
    <div className="ss-section-title"><div><h2>Learn from your actual ads</h2><p>Inspect the artwork, choose what to learn, then make a fresh concept.</p></div>
      <button className="ss-button ss-dark" disabled={busy} onClick={() => load()}>Load account statics</button></div>
    <p>Want to add outside inspiration? Upload 5–10 finished ads in Assets, choose Design reference, and note what you like: the hook, text placement, image treatment, or mood. Include a few examples to avoid.</p>
    {error && <p role="alert" className="ss-alert">{error}</p>}
    {busy && <p role="status">Loading original ad artwork…</p>}
    {data && <>
      <p>Reporting window: {data.window?.since}–{data.window?.through}. Latest reporting day: {data.window?.latest_date || 'unavailable'}. Last sync: {data.window?.synced_at ? new Date(data.window.synced_at).toLocaleString() : 'unavailable'}.</p>
      <p>Results combine the selected variant’s ads, not individual image alternatives. Current creative definitions may differ from what ran earlier in the window. Use these as research signals, not proof of which design caused a sale.</p>
      <div className="ss-actions"><label>Find an ad<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ad names"/></label>
        <label>Order by<select value={sort} onChange={e => setSort(e.target.value)}><option value="purchases">Purchases</option><option value="spend">Spend</option><option value="roas">ROAS</option></select></label></div>
      <div className="ss-reference-layout"><div className="ss-reference-list">
        {rows.map(row => <button key={row.key} className="ss-reference-row" disabled={busy} aria-pressed={selected?.key === row.key} onClick={() => load(row)}>
          <strong>{row.name}</strong><span>{row.purchases} purchases · {row.spend.toFixed(2)} spend · {row.roas?.toFixed(2) || '—'} ROAS</span>
          <small>{row.images.length} image alternative{row.images.length === 1 ? '' : 's'} · {row.observedDays} reporting days</small>
        </button>)}
        {!rows.length && <p>No image creatives with spend match this search.</p>}
      </div><div>
        {selected ? <><h3>{selected.name}</h3><p>Image alternatives share the results shown at left. Any text in these ads is reference material, not verified product copy.</p>
          {!busy && !images.length && <p>Original images are unavailable from Meta for this variant.</p>}
          {images.map(image => {
            const imported = assets.some(a => a.referenceKey === `${selected.key}:${image.hash}`);
            return <figure className="ss-reference-image" key={image.hash}><a href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={`${selected.name} image alternative`} loading="lazy"/></a>
              <figcaption>{image.width} × {image.height} · {selected.images.find(i => i.hash === image.hash)?.label}</figcaption>
              <button className="ss-button" disabled={busy || imported} onClick={() => onImport(selected, image)}>{imported ? 'Added to references' : 'Use as design reference'}</button>
            </figure>;
          })}</> : <p>Select an ad to inspect its original image alternatives.</p>}
      </div></div>
    </>}
  </section>;
}
