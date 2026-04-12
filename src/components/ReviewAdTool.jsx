import { useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { toPng } from 'html-to-image';
import { FORMATS } from '../brand';
import UGCTemplate from '../templates/UGCTemplate';

const LS_REVIEWS = 'howl_review_ads_reviews';
const LS_NAME = 'howl_review_ads_name';

const PRODUCT_NAMES = {
  'r1': 'HOWL R1',
  'r4mkii': 'HOWL R4 MkII',
};

const VALID_HANDLES = new Set(['r1', 'r4mkii']);

function verifiedLabel(handle) {
  const name = PRODUCT_NAMES[handle] || 'HOWL';
  return `Verified ${name} Customer`;
}

function parseLoox(csv) {
  const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return data
    .filter(r => r.review && r.review.trim())
    .map((r, i) => ({
      id: r.id || String(i),
      rating: parseInt(r.rating, 10) || 5,
      quote: r.review.trim(),
      nickname: r.nickname || r.full_name || 'Verified HOWL Customer',
      handle: (r.handle || '').replace('the-howl-', ''),
    }))
    .filter(r => VALID_HANDLES.has(r.handle));
}

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_REVIEWS) || '[]');
    return data.filter(r => VALID_HANDLES.has(r.handle));
  } catch { return []; }
}

const LS_SAVED_IMAGES = 'howl_saved_images';
const LS_BG = 'howl_review_bg';

function loadSavedImages() {
  try { return JSON.parse(localStorage.getItem(LS_SAVED_IMAGES) || '[]'); } catch { return []; }
}

export default function ReviewAdTool({ driveAuth, onAddToCart }) {
  const [reviews, setReviews] = useState(loadSaved);
  const [csvName, setCsvName] = useState(() => localStorage.getItem(LS_NAME) || '');
  const [selected, setSelected] = useState(() => {
    const saved = loadSaved();
    return new Set(saved.filter(r => r.rating === 5).map(r => r.id));
  });
  const [previewId, setPreviewId] = useState(() => loadSaved()[0]?.id || null);
  const [ratingFilter, setRatingFilter] = useState(5);
  const [productFilter, setProductFilter] = useState('all');
  const [formatKeys, setFormatKeys] = useState(['square']);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [dragging, setDragging] = useState(false);
  const [bgImage, setBgImage] = useState(() => { try { return localStorage.getItem(LS_BG) || null; } catch { return null; } });
  const [scrimColor, setScrimColor] = useState(() => { try { return localStorage.getItem('howl_review_scrim') || 'rgba(249,243,223,0.72)'; } catch { return 'rgba(249,243,223,0.72)'; } });
  const [savedImages, setSavedImages] = useState(loadSavedImages);
  const bgFileRef = useRef(null);

  const handleScrimChange = (val) => {
    setScrimColor(val);
    try { localStorage.setItem('howl_review_scrim', val); } catch {}
  };

  // Single / no-CSV mode
  const [manualQuote, setManualQuote] = useState('');
  const [manualReviewer, setManualReviewer] = useState('');
  const [manualFormat, setManualFormat] = useState('square');

  const captureRefs = useRef({});
  const singleCaptureRef = useRef(null);

  const handleBgFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 2160;
        let { width: w, height: h } = img;
        if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const url = canvas.toDataURL('image/jpeg', 0.92);
        setBgImage(url);
        try { localStorage.setItem(LS_BG, url); } catch {}
        // Also add to shared image library if not already there
        setSavedImages(prev => {
          if (prev.some(i => i.url === url)) return prev;
          const next = [{ id: Date.now(), url }, ...prev].slice(0, 8);
          try { localStorage.setItem(LS_SAVED_IMAGES, JSON.stringify(next)); } catch {}
          return next;
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const clearBg = () => {
    setBgImage(null);
    try { localStorage.removeItem(LS_BG); } catch {}
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseLoox(e.target.result);
      setReviews(parsed);
      setCsvName(file.name);
      const fiveStars = new Set(parsed.filter(r => r.rating === 5).map(r => r.id));
      setSelected(fiveStars);
      setPreviewId(parsed[0]?.id || null);
      setRatingFilter(5);
      setProductFilter('all');
      try { localStorage.setItem(LS_REVIEWS, JSON.stringify(parsed)); } catch {}
      try { localStorage.setItem(LS_NAME, file.name); } catch {}
    };
    reader.readAsText(file);
  };

  const clearCSV = () => {
    setReviews([]);
    setCsvName('');
    setSelected(new Set());
    setPreviewId(null);
    try { localStorage.removeItem(LS_REVIEWS); localStorage.removeItem(LS_NAME); } catch {}
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleSingleExport = useCallback(async () => {
    if (!manualQuote.trim() || !singleCaptureRef.current) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const fmt = FORMATS[manualFormat];
      const el = singleCaptureRef.current;
      await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
      const dataUrl = await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
      const a = document.createElement('a');
      a.download = `howl_review_${fmt.label.replace(':', 'x')}_${Date.now()}.png`;
      a.href = dataUrl; a.click();
    } catch (err) { console.error(err); alert('Export failed.'); }
    finally { setExporting(false); }
  }, [manualQuote, manualFormat]);

  const handleBulkExport = useCallback(async ({ toDrive = false } = {}) => {
    const toExport = filtered.filter(r => selected.has(r.id));
    if (toExport.length === 0) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      let count = 0;
      const total = toExport.length * formatKeys.length;
      for (const review of toExport) {
        for (const fk of formatKeys) {
          count++;
          setExportProgress(`${count}/${total}`);
          const el = captureRefs.current[`${review.id}_${fk}`];
          if (!el) continue;
          const fmt = FORMATS[fk];
          await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
          const dataUrl = await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
          const fileName = `howl_${review.handle || 'review'}_${fmt.label.replace(':', 'x')}_${count}.png`;
          if (toDrive && driveAuth?.connected) {
            await driveAuth.uploadFile({ fileName, fileData: dataUrl, mimeType: 'image/png' });
          } else {
            const a = document.createElement('a');
            a.download = fileName;
            a.href = dataUrl; a.click();
          }
          await new Promise(res => setTimeout(res, 250));
        }
      }
    } catch (err) { console.error(err); alert('Export failed. Try a smaller batch.'); }
    finally { setExporting(false); setExportProgress(''); }
  }, [reviews, selected, formatKeys, driveAuth]);

  const handleAddSingleToCart = useCallback(async () => {
    if (!manualQuote.trim() || !singleCaptureRef.current) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const fmt = FORMATS[manualFormat];
      const el = singleCaptureRef.current;
      await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
      const dataUrl = await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
      const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      onAddToCart?.({
        id: Date.now(),
        type: 'static',
        squareUrl: manualFormat === 'square' ? dataUrl : null,
        storyUrl:  manualFormat === 'story'  ? dataUrl : null,
        name: `HOWL | Review | ${manualQuote.slice(0, 30).trim()} | ${monthDay}`,
        hook: manualQuote.slice(0, 80).trim(),
        body: '',
      });
    } catch (err) { console.error(err); alert('Failed to add to cart.'); }
    finally { setExporting(false); }
  }, [manualQuote, manualFormat, onAddToCart]);

  const handleBulkAddToCart = useCallback(async () => {
    const toExport = filtered.filter(r => selected.has(r.id));
    if (toExport.length === 0) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      let count = 0;
      setExportProgress(`0/${toExport.length}`);
      for (const review of toExport) {
        count++;
        setExportProgress(`${count}/${toExport.length}`);
        const renders = {};
        for (const fk of ['square', 'story']) {
          const el = captureRefs.current[`${review.id}_${fk}`];
          if (!el) continue;
          const fmt = FORMATS[fk];
          await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
          renders[fk] = await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
        }
        if (renders.square || renders.story) {
          const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const reviewerName = review.nickname || review.handle || 'Customer';
          onAddToCart?.({
            id: Date.now() + count,
            type: 'static',
            squareUrl: renders.square || null,
            storyUrl:  renders.story  || null,
            name: `HOWL | Review | ${reviewerName} | ${monthDay}`,
            hook: (review.quote || '').slice(0, 80).trim(),
            body: '',
          });
        }
        await new Promise(res => setTimeout(res, 300));
      }
    } catch (err) { console.error(err); alert('Failed. Try a smaller batch.'); }
    finally { setExporting(false); setExportProgress(''); }
  }, [reviews, selected, onAddToCart]);

  const products = [...new Set(reviews.map(r => r.handle).filter(Boolean))].sort();
  const filtered = reviews.filter(r =>
    (ratingFilter === 0 || r.rating === ratingFilter) &&
    (productFilter === 'all' || r.handle === productFilter)
  );
  const previewReview = reviews.find(r => r.id === previewId) || filtered[0] || null;
  const selectedCount = filtered.filter(r => selected.has(r.id)).length;
  const exportTotal = selectedCount * formatKeys.length;

  const toggleFormat = (key) => setFormatKeys(prev =>
    prev.includes(key) ? (prev.length > 1 ? prev.filter(k => k !== key) : prev) : [...prev, key]
  );

  // ---- Single / no-CSV mode ----
  if (reviews.length === 0) {
    const fmt = FORMATS[manualFormat];
    const scale = 0.4;
    const variation = { headline: manualQuote || 'Paste a review to get started.' };
    const attribution = manualReviewer.trim() || undefined;

    return (
      <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>
        {/* Left */}
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #2a3441', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 28, gap: 20 }}>
          <div>
            <div style={S.label}>Import Loox CSV</div>
            <label
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              style={{ display: 'block', padding: '14px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
            >
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8b949e' }}>
                {dragging ? 'Drop CSV here' : 'Upload Loox CSV — bulk export'}
              </div>
            </label>
          </div>

          <div>
            <div style={S.label}>Review Quote</div>
            <textarea value={manualQuote} onChange={e => setManualQuote(e.target.value)} placeholder="Or paste a single review here..." rows={6} style={S.textarea} />
          </div>

          <div>
            <div style={S.label}>Reviewer <span style={{ color: '#8b949e', fontWeight: 400 }}>(optional)</span></div>
            <input type="text" value={manualReviewer} onChange={e => setManualReviewer(e.target.value)} placeholder="e.g. John B." style={S.input} />
          </div>

          <div>
            <div style={S.label}>Format</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(FORMATS).map(([key, f]) => (
                <button key={key} onClick={() => setManualFormat(key)} style={S.fmtBtn(manualFormat === key)}>{f.label}</button>
              ))}
            </div>
          </div>

          {/* Background image */}
          <BgImagePicker bgImage={bgImage} savedImages={savedImages} onSelect={url => { setBgImage(url); try { localStorage.setItem(LS_BG, url); } catch {} }} onUpload={handleBgFile} onClear={clearBg} fileRef={bgFileRef} scrimColor={scrimColor} onScrimChange={handleScrimChange} />

          <button onClick={handleSingleExport} disabled={exporting || !manualQuote.trim()} style={S.exportBtn(exporting || !manualQuote.trim())}>
            {exporting ? 'Exporting...' : 'Download PNG'}
          </button>
          {onAddToCart && (
            <button onClick={handleAddSingleToCart} disabled={exporting || !manualQuote.trim()} style={{ ...S.exportBtn(exporting || !manualQuote.trim()), background: (exporting || !manualQuote.trim()) ? '#2a3441' : '#6e40c9', marginTop: 6 }}>
              {exporting ? 'Rendering...' : 'Add to Cart'}
            </button>
          )}
        </div>

        {/* Right */}
        <div style={S.rightPanel}>
          <PreviewCard fmt={fmt} scale={scale}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} backgroundImage={bgImage} scrimColor={scrimColor} />
          </PreviewCard>
        </div>

        <div style={{ position: 'fixed', left: -99999, top: 0 }}>
          <div ref={singleCaptureRef} style={{ width: fmt.width, height: fmt.height }}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} backgroundImage={bgImage} scrimColor={scrimColor} />
          </div>
        </div>
      </div>
    );
  }

  // ---- CSV / Bulk mode ----
  const bothSelected = formatKeys.includes('square') && formatKeys.includes('story');
  const squareScale = bothSelected ? 0.32 : 0.4;
  const storyScale = bothSelected ? 0.22 : 0.4;
  const pvFmt = FORMATS[formatKeys[0]];
  const pvScale = formatKeys[0] === 'story' ? storyScale : squareScale;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>
      {/* Left panel — flex column with fixed header/footer, scrollable list */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #2a3441', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Fixed: CSV header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a3441', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#f0f4f8', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {csvName || `${reviews.length} reviews`}
            </div>
            <div style={{ fontSize: 9, color: '#8b949e', marginTop: 1 }}>{reviews.length} reviews loaded</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <label style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#DC440A', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              Replace
            </label>
            <button onClick={clearCSV} style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
          </div>
        </div>

        {/* Fixed: Rating filter */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #2a3441', flexShrink: 0, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {[0, 5, 4, 3].map(r => (
            <button key={r} onClick={() => setRatingFilter(r)} style={S.filterBtn(ratingFilter === r)}>
              {r === 0 ? 'All' : `${r}★`}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
            <button onClick={() => setSelected(new Set(filtered.map(r => r.id)))} style={S.microBtn}>All</button>
            <button onClick={() => setSelected(new Set())} style={S.microBtn}>None</button>
          </div>
        </div>

        {/* Fixed: Product filter (only if multiple products) */}
        {products.length > 1 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #2a3441', flexShrink: 0, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['all', ...products].map(p => (
              <button key={p} onClick={() => setProductFilter(p)} style={{ ...S.filterBtn(productFilter === p), textTransform: 'uppercase', letterSpacing: 1 }}>
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable: review list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, fontSize: 10, color: '#8b949e' }}>No reviews at this rating.</div>
          )}
          {filtered.map(r => {
            const isSelected = selected.has(r.id);
            const isPreviewing = previewId === r.id;
            return (
              <div key={r.id} onClick={() => setPreviewId(r.id)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #2a3441', background: isPreviewing ? 'rgba(220,68,10,0.1)' : 'transparent', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    setSelected(prev => {
                      const next = new Set(prev);
                      next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                      return next;
                    });
                    setPreviewId(r.id);
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ marginTop: 3, flexShrink: 0, accentColor: '#DC440A' }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: '#DC440A', marginBottom: 2 }}>{'★'.repeat(r.rating)}</div>
                  <div style={{ fontSize: 10, color: '#f0f4f8', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.quote}</div>
                  <div style={{ fontSize: 9, color: '#8b949e', marginTop: 3 }}>{r.nickname}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed: Format + background + export */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #2a3441', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.entries(FORMATS).map(([key, f]) => (
              <button key={key} onClick={() => toggleFormat(key)} style={S.fmtBtn(formatKeys.includes(key))}>{f.label}</button>
            ))}
          </div>
          <BgImagePicker bgImage={bgImage} savedImages={savedImages} onSelect={url => { setBgImage(url); try { localStorage.setItem(LS_BG, url); } catch {} }} onUpload={handleBgFile} onClear={clearBg} fileRef={bgFileRef} scrimColor={scrimColor} onScrimChange={handleScrimChange} />
          <button onClick={() => handleBulkExport()} disabled={exporting || selectedCount === 0} style={S.exportBtn(exporting || selectedCount === 0)}>
            {exporting
              ? `Exporting ${exportProgress}...`
              : selectedCount === 0 ? 'Select reviews'
              : `Export ${exportTotal} PNG${exportTotal !== 1 ? 's' : ''}`}
          </button>
          {onAddToCart && (
            <button onClick={handleBulkAddToCart} disabled={exporting || selectedCount === 0} style={{ ...S.exportBtn(exporting || selectedCount === 0), background: (exporting || selectedCount === 0) ? '#2a3441' : '#6e40c9', marginTop: 4 }}>
              {exporting ? `Rendering ${exportProgress}...` : selectedCount === 0 ? 'Select reviews' : `Add ${exportTotal} to Cart`}
            </button>
          )}
          {driveAuth?.connected && (
            <button onClick={() => handleBulkExport({ toDrive: true })} disabled={exporting || selectedCount === 0} style={{ ...S.exportBtn(exporting || selectedCount === 0), background: exporting || selectedCount === 0 ? '#2a3441' : '#1a7f37', marginTop: 4 }}>
              {exporting ? `Saving ${exportProgress}...` : `Save to Drive`}
            </button>
          )}
        </div>
      </div>

      {/* Right: preview */}
      <div style={{ ...S.rightPanel, gap: 24, flexWrap: 'wrap' }}>
        {previewReview ? (
          bothSelected ? (
            <>
              <PreviewCard fmt={FORMATS.square} scale={squareScale}>
                <UGCTemplate
                  variation={{ headline: previewReview.quote }}
                  format="square"
                  dimensions={FORMATS.square}
                  reviewerName={previewReview.nickname}
                  attribution={verifiedLabel(previewReview.handle)}
                  backgroundImage={bgImage}
                  scrimColor={scrimColor}
                />
              </PreviewCard>
              <PreviewCard fmt={FORMATS.story} scale={storyScale}>
                <UGCTemplate
                  variation={{ headline: previewReview.quote }}
                  format="story"
                  dimensions={FORMATS.story}
                  reviewerName={previewReview.nickname}
                  attribution={verifiedLabel(previewReview.handle)}
                  backgroundImage={bgImage}
                  scrimColor={scrimColor}
                />
              </PreviewCard>
            </>
          ) : (
            <PreviewCard fmt={pvFmt} scale={pvScale}>
              <UGCTemplate
                variation={{ headline: previewReview.quote }}
                format={formatKeys[0]}
                dimensions={pvFmt}
                reviewerName={previewReview.nickname}
                attribution={verifiedLabel(previewReview.handle)}
                backgroundImage={bgImage}
                scrimColor={scrimColor}
              />
            </PreviewCard>
          )
        ) : (
          <div style={{ color: '#8b949e', fontSize: 12 }}>No reviews match filter</div>
        )}
      </div>

      {/* Hidden capture divs */}
      <div style={{ position: 'fixed', left: -99999, top: 0 }}>
        {filtered.filter(r => selected.has(r.id)).flatMap(r =>
          formatKeys.map(fk => {
            const fmt = FORMATS[fk];
            const key = `${r.id}_${fk}`;
            return (
              <div key={key} ref={el => { captureRefs.current[key] = el; }} style={{ width: fmt.width, height: fmt.height }}>
                <UGCTemplate variation={{ headline: r.quote }} format={fk} dimensions={fmt} reviewerName={r.nickname} attribution={verifiedLabel(r.handle)} backgroundImage={bgImage} scrimColor={scrimColor} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const SCRIM_OPTIONS = [
  { label: 'Tan',   value: 'rgba(249,243,223,0.72)' },
  { label: 'Black', value: 'rgba(0,0,0,0.55)' },
  { label: 'White', value: 'rgba(255,255,255,0.72)' },
  { label: 'None',  value: 'rgba(0,0,0,0)' },
];

function BgImagePicker({ bgImage, savedImages, onSelect, onUpload, onClear, fileRef, scrimColor, onScrimChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Background Image</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{ fontSize: 9, color: '#DC440A', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>+ Upload</button>
          {bgImage && <button onClick={onClear} style={{ fontSize: 9, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>Clear</button>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={e => { onUpload(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
      {savedImages.length > 0 ? (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {savedImages.map(img => (
            <div key={img.id} onClick={() => onSelect(img.url)} style={{ width: 48, height: 48, borderRadius: 3, overflow: 'hidden', border: `2px solid ${bgImage === img.url ? '#DC440A' : '#e0d9c4'}`, cursor: 'pointer', flexShrink: 0 }}>
              <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#8b949e' }}>Upload images in Image Ads tab to reuse here.</div>
      )}
      {bgImage && (
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', fontWeight: 600, marginBottom: 5 }}>Overlay Color</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {SCRIM_OPTIONS.map(o => (
              <button key={o.label} onClick={() => onScrimChange(o.value)} style={{
                flex: 1, padding: '5px 0', borderRadius: 3, cursor: 'pointer', fontSize: 9,
                border: `1px solid ${scrimColor === o.value ? '#DC440A' : '#e0d9c4'}`,
                background: scrimColor === o.value ? '#fef8f0' : '#fff',
                color: scrimColor === o.value ? '#DC440A' : '#8a8270',
                fontFamily: 'inherit', letterSpacing: 1, textTransform: 'uppercase',
              }}>{o.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewCard({ fmt, scale, children }) {
  return (
    <div style={{ width: fmt.width * scale, height: fmt.height * scale, flexShrink: 0, overflow: 'hidden', borderRadius: 4, boxShadow: '0 4px 32px rgba(51,63,76,0.18)' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: fmt.width, height: fmt.height }}>
        {children}
      </div>
    </div>
  );
}

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', marginBottom: 8, fontWeight: 600 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #2a3441', borderRadius: 4, background: '#1c2330', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid #2a3441', borderRadius: 4, background: '#1c2330', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, outline: 'none' },
  fmtBtn: (active) => ({ flex: 1, padding: '7px 0', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`, background: active ? 'rgba(220,68,10,0.15)' : '#1c2330', color: active ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 }),
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#2a3441' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
  filterBtn: (active) => ({ padding: '3px 8px', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`, background: active ? 'rgba(220,68,10,0.15)' : '#1c2330', color: active ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer', borderRadius: 3 }),
  microBtn: { padding: '3px 7px', border: '1px solid #2a3441', background: '#1c2330', color: '#8b949e', fontFamily: 'inherit', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3 },
  rightPanel: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', background: '#0d1117', padding: 40, overflow: 'auto' },
};
