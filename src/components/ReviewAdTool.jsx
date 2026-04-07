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
  'r4': 'HOWL R4',
};

const VALID_HANDLES = new Set(['r1', 'r4', 'r4mkii']);

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
  try { return JSON.parse(localStorage.getItem(LS_REVIEWS) || '[]'); } catch { return []; }
}

export default function ReviewAdTool() {
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

  // Single / no-CSV mode
  const [manualQuote, setManualQuote] = useState('');
  const [manualReviewer, setManualReviewer] = useState('');
  const [manualFormat, setManualFormat] = useState('square');

  const captureRefs = useRef({});
  const singleCaptureRef = useRef(null);

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

  const handleBulkExport = useCallback(async () => {
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
          const a = document.createElement('a');
          a.download = `howl_${review.handle || 'review'}_${fmt.label.replace(':', 'x')}_${count}.png`;
          a.href = dataUrl; a.click();
          await new Promise(res => setTimeout(res, 250));
        }
      }
    } catch (err) { console.error(err); alert('Export failed. Try a smaller batch.'); }
    finally { setExporting(false); setExportProgress(''); }
  }, [reviews, selected, formatKeys]);

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
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 28, gap: 20 }}>
          <div>
            <div style={S.label}>Import Loox CSV</div>
            <label
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              style={{ display: 'block', padding: '14px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
            >
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8a8270' }}>
                {dragging ? 'Drop CSV here' : 'Upload Loox CSV — bulk export'}
              </div>
            </label>
          </div>

          <div>
            <div style={S.label}>Review Quote</div>
            <textarea value={manualQuote} onChange={e => setManualQuote(e.target.value)} placeholder="Or paste a single review here..." rows={6} style={S.textarea} />
          </div>

          <div>
            <div style={S.label}>Reviewer <span style={{ color: '#b0a898', fontWeight: 400 }}>(optional)</span></div>
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

          <button onClick={handleSingleExport} disabled={exporting || !manualQuote.trim()} style={S.exportBtn(exporting || !manualQuote.trim())}>
            {exporting ? 'Exporting...' : 'Download PNG'}
          </button>
        </div>

        {/* Right */}
        <div style={S.rightPanel}>
          <PreviewCard fmt={fmt} scale={scale}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} />
          </PreviewCard>
        </div>

        <div style={{ position: 'fixed', left: -99999, top: 0 }}>
          <div ref={singleCaptureRef} style={{ width: fmt.width, height: fmt.height }}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} />
          </div>
        </div>
      </div>
    );
  }

  // ---- CSV / Bulk mode ----
  const pvFmt = FORMATS[formatKeys[0]];
  const pvScale = 0.4;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>
      {/* Left panel — flex column with fixed header/footer, scrollable list */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Fixed: CSV header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0d9c4', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#333F4C', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {csvName || `${reviews.length} reviews`}
            </div>
            <div style={{ fontSize: 9, color: '#8a8270', marginTop: 1 }}>{reviews.length} reviews loaded</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <label style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#DC440A', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              Replace
            </label>
            <button onClick={clearCSV} style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#8a8270', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
          </div>
        </div>

        {/* Fixed: Rating filter */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #e0d9c4', flexShrink: 0, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #e0d9c4', flexShrink: 0, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
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
            <div style={{ padding: 20, fontSize: 10, color: '#8a8270' }}>No reviews at this rating.</div>
          )}
          {filtered.map(r => {
            const isSelected = selected.has(r.id);
            const isPreviewing = previewId === r.id;
            return (
              <div key={r.id} onClick={() => setPreviewId(r.id)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #e0d9c4', background: isPreviewing ? '#fef8f0' : 'transparent', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
                  <div style={{ fontSize: 10, color: '#333F4C', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.quote}</div>
                  <div style={{ fontSize: 9, color: '#8a8270', marginTop: 3 }}>{r.nickname}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed: Format + export */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.entries(FORMATS).map(([key, f]) => (
              <button key={key} onClick={() => toggleFormat(key)} style={S.fmtBtn(formatKeys.includes(key))}>{f.label}</button>
            ))}
          </div>
          <button onClick={handleBulkExport} disabled={exporting || selectedCount === 0} style={S.exportBtn(exporting || selectedCount === 0)}>
            {exporting
              ? `Exporting ${exportProgress}...`
              : selectedCount === 0 ? 'Select reviews'
              : `Export ${exportTotal} PNG${exportTotal !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Right: preview */}
      <div style={S.rightPanel}>
        {previewReview ? (
          <PreviewCard fmt={pvFmt} scale={pvScale}>
            <UGCTemplate
              variation={{ headline: previewReview.quote }}
              format={formatKeys[0]}
              dimensions={pvFmt}
              reviewerName={previewReview.nickname}
              attribution={verifiedLabel(previewReview.handle)}
            />
          </PreviewCard>
        ) : (
          <div style={{ color: '#8a8270', fontSize: 12 }}>No reviews match filter</div>
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
                <UGCTemplate variation={{ headline: r.quote }} format={fk} dimensions={fmt} reviewerName={r.nickname} attribution={verifiedLabel(r.handle)} />
              </div>
            );
          })
        )}
      </div>
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
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8, fontWeight: 600 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff', color: '#333F4C', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff', color: '#333F4C', fontFamily: 'inherit', fontSize: 12, outline: 'none' },
  fmtBtn: (active) => ({ flex: 1, padding: '7px 0', border: `1px solid ${active ? '#DC440A' : '#e0d9c4'}`, background: active ? '#fef8f0' : '#fff', color: active ? '#DC440A' : '#8a8270', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 }),
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#e0d9c4' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#a09880' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
  filterBtn: (active) => ({ padding: '3px 8px', border: `1px solid ${active ? '#DC440A' : '#e0d9c4'}`, background: active ? '#fef8f0' : '#fff', color: active ? '#DC440A' : '#8a8270', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer', borderRadius: 3 }),
  microBtn: { padding: '3px 7px', border: '1px solid #e0d9c4', background: '#fff', color: '#8a8270', fontFamily: 'inherit', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3 },
  rightPanel: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0ead4', padding: 40, overflow: 'auto' },
};
