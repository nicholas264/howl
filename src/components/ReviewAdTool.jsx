import { useState, useRef, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import { toPng } from 'html-to-image';
import { useAuth } from '@clerk/clerk-react';
import { FORMATS } from '../brand';
import UGCTemplate from '../templates/UGCTemplate';
import { fetchImageLibrary, uploadImageToLibrary, deleteImageRecord } from '../utils/imageLibrary';

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

async function waitForImages(root) {
  const images = Array.from(root?.querySelectorAll?.('img') || []);
  await Promise.all(images.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (img.complete) return Promise.reject(new Error(`Image failed to load: ${img.currentSrc || img.src}`));
    return new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Image failed to load: ${img.currentSrc || img.src}`));
    });
  }));
  await Promise.all(images.map(img => img.decode?.().catch(() => {}) || Promise.resolve()));
}

const LS_BG = 'howl_review_bg';
const LS_BG_SET = 'howl_review_bg_set';
const LS_BG_MODE = 'howl_review_bg_mode';

function loadBgImages() {
  try {
    const savedSet = JSON.parse(localStorage.getItem(LS_BG_SET) || '[]').filter(Boolean);
    if (savedSet.length) return savedSet;
    const legacy = localStorage.getItem(LS_BG);
    return legacy ? [legacy] : [];
  } catch { return []; }
}

function hashString(value) {
  let hash = 0;
  const str = String(value || '');
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export default function ReviewAdTool({ driveAuth, onAddToCart }) {
  const { getToken } = useAuth();
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
  const [previewMode, setPreviewMode] = useState('single');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [dragging, setDragging] = useState(false);
  const [bgImages, setBgImages] = useState(loadBgImages);
  const [bgMode, setBgMode] = useState(() => { try { return localStorage.getItem(LS_BG_MODE) || 'single'; } catch { return 'single'; } });
  const [scrimColor, setScrimColor] = useState(() => { try { return localStorage.getItem('howl_review_scrim') || 'rgba(249,243,223,0.72)'; } catch { return 'rgba(249,243,223,0.72)'; } });
  const [savedImages, setSavedImages] = useState([]);
  const [bgUploading, setBgUploading] = useState(false);
  const [syncedLoading, setSyncedLoading] = useState(false);
  const [textColor, setTextColor] = useState(() => { try { return localStorage.getItem('howl_review_textcolor') || '#333F4C'; } catch { return '#333F4C'; } });
  const bgFileRef = useRef(null);
  const bgImage = bgImages[0] || null;

  const handleScrimChange = (val) => {
    setScrimColor(val);
    try { localStorage.setItem('howl_review_scrim', val); } catch {}
  };

  const handleTextColorChange = (val) => {
    setTextColor(val);
    try { localStorage.setItem('howl_review_textcolor', val); } catch {}
  };

  const saveBgImages = (next) => {
    const clean = [...new Set(next.filter(Boolean))];
    setBgImages(clean);
    try {
      localStorage.setItem(LS_BG_SET, JSON.stringify(clean));
      if (clean[0]) localStorage.setItem(LS_BG, clean[0]);
      else localStorage.removeItem(LS_BG);
    } catch {}
  };

  const handleBgModeChange = (mode) => {
    setBgMode(mode);
    try { localStorage.setItem(LS_BG_MODE, mode); } catch {}
  };

  const selectBgImage = (url) => {
    if (!url) return;
    if (bgMode === 'rotate') {
      const next = bgImages.includes(url)
        ? bgImages.filter(item => item !== url)
        : [...bgImages, url];
      saveBgImages(next.length ? next : [url]);
    } else {
      saveBgImages([url]);
    }
  };

  const backgroundForReview = useCallback((review, formatKey = '') => {
    if (!bgImages.length) return null;
    if (bgMode !== 'rotate') return bgImages[0];
    const idx = hashString(`${review?.id || 'manual'}:${formatKey}`) % bgImages.length;
    return bgImages[idx];
  }, [bgImages, bgMode]);

  const updateReview = (id, patch) => {
    setReviews(prev => {
      const next = prev.map(r => r.id === id ? { ...r, ...patch } : r);
      if (!next.find(r => r.id === id)?.source) {
        try { localStorage.setItem(LS_REVIEWS, JSON.stringify(next)); } catch {}
      }
      return next;
    });
  };

  const persistReviewEdit = async (review) => {
    if (!review?.source || review.source !== 'loox') return;
    try {
      await fetch('/api/db/loox-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: review.looxId || review.id, quote: review.quote, nickname: review.nickname }),
      });
    } catch (err) {
      console.error('Could not save synced review edit', err);
    }
  };

  // Single / no-CSV mode
  const [manualQuote, setManualQuote] = useState('');
  const [manualReviewer, setManualReviewer] = useState('');
  const [manualFormat, setManualFormat] = useState('square');

  const captureRefs = useRef({});
  const singleCaptureRef = useRef(null);

  // Load shared image library on mount.
  useEffect(() => {
    let cancelled = false;
    fetchImageLibrary().then(rows => { if (!cancelled) setSavedImages(rows); });
    return () => { cancelled = true; };
  }, []);

  const handleBgFiles = async (files) => {
    const imageFiles = Array.from(files || []).filter(file => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setBgUploading(true);
    try {
      const records = [];
      for (const file of imageFiles) {
        const record = await uploadImageToLibrary(file, getToken);
        if (record) records.push(record);
      }
      if (records.length === 0) throw new Error('Upload failed');
      setSavedImages(prev => [...records, ...prev.filter(i => !records.some(r => r.url === i.url))]);
      saveBgImages(bgMode === 'rotate'
        ? [...bgImages, ...records.map(r => r.url)]
        : [records[0].url]);
    } catch (err) {
      alert(`Background upload failed: ${err?.message || err}`);
    } finally {
      setBgUploading(false);
    }
  };

  const clearBg = () => {
    saveBgImages([]);
  };

  const removeSavedImage = async (id) => {
    const prev = savedImages;
    const target = prev.find(i => i.id === id);
    setSavedImages(prev.filter(i => i.id !== id));
    if (target && bgImages.includes(target.url)) saveBgImages(bgImages.filter(url => url !== target.url));
    const ok = await deleteImageRecord(id);
    if (!ok) {
      setSavedImages(prev);
      alert('Could not delete image.');
    }
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

  const loadSyncedReviews = async () => {
    setSyncedLoading(true);
    try {
      const r = await fetch('/api/db/loox-reviews?limit=500');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not load synced reviews');
      const rows = (data.reviews || []).filter(row => VALID_HANDLES.has(row.handle));
      setReviews(rows);
      setCsvName('Synced Loox reviews');
      setSelected(new Set(rows.filter(row => row.rating === 5 && row.adStatus !== 'hold').map(row => row.id)));
      setPreviewId(rows[0]?.id || null);
      setRatingFilter(5);
      setProductFilter('all');
      if (rows.length > 0) setPreviewMode('bulk');
    } catch (err) {
      alert(`Could not load synced Loox reviews: ${err?.message || err}`);
    } finally {
      setSyncedLoading(false);
    }
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
      await waitForImages(el);
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
          await waitForImages(el);
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
      await waitForImages(el);
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
          await waitForImages(el);
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

  const handleAddCarouselToCart = useCallback(async () => {
    const toExport = reviews.filter(r =>
      (ratingFilter === 0 || r.rating === ratingFilter) &&
      (productFilter === 'all' || r.handle === productFilter)
    ).filter(r => selected.has(r.id));
    if (toExport.length < 2) { alert('Select at least 2 reviews for a carousel.'); return; }
    if (toExport.length > 10) { alert('Meta carousels support up to 10 cards. Deselect some reviews.'); return; }
    setExporting(true);
    try {
      await document.fonts.ready;
      const cards = [];
      let count = 0;
      setExportProgress(`0/${toExport.length}`);
      for (const review of toExport) {
        count++;
        setExportProgress(`${count}/${toExport.length}`);
        const el = captureRefs.current[`${review.id}_square`];
        if (!el) continue;
        const fmt = FORMATS.square;
        await waitForImages(el);
        await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
        const dataUrl = await toPng(el, { width: fmt.width, height: fmt.height, pixelRatio: 1 });
        cards.push({
          imageBase64: dataUrl,
          squareUrl: dataUrl,
          headline: (review.quote || '').slice(0, 80).trim(),
          body: `— ${review.nickname || 'Verified Customer'}`,
          reviewerName: review.nickname || review.handle || 'Customer',
        });
        await new Promise(res => setTimeout(res, 250));
      }
      if (cards.length >= 2) {
        const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        onAddToCart?.({
          id: Date.now(),
          type: 'carousel',
          cards,
          squareUrl: cards[0].squareUrl,
          name: `HOWL | Review Carousel (${cards.length}) | ${monthDay}`,
          hook: `${cards.length} verified reviews`,
          body: '',
        });
      }
    } catch (err) { console.error(err); alert('Failed to create carousel. Try fewer cards.'); }
    finally { setExporting(false); setExportProgress(''); }
  }, [reviews, selected, ratingFilter, productFilter, onAddToCart]);

  const products = [...new Set(reviews.map(r => r.handle).filter(Boolean))].sort();
  const filtered = reviews.filter(r =>
    (ratingFilter === 0 || r.rating === ratingFilter) &&
    (productFilter === 'all' || r.handle === productFilter)
  );
  const previewReview = reviews.find(r => r.id === previewId) || filtered[0] || null;
  const selectedReviews = filtered.filter(r => selected.has(r.id));
  const selectedCount = filtered.filter(r => selected.has(r.id)).length;
  const exportTotal = selectedCount * formatKeys.length;
  const bulkPreviewReviews = selectedReviews.slice(0, 80);

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
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #dedbd3', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 28, gap: 20 }}>
          <div>
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>Import Loox CSV</span>
              <button onClick={loadSyncedReviews} disabled={syncedLoading} style={S.linkBtn}>{syncedLoading ? 'Loading' : 'Load synced'}</button>
            </div>
            <label
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              style={{ display: 'block', padding: '14px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#d84a17' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
            >
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              <div style={{ fontSize: 10, color: dragging ? '#d84a17' : '#77746f' }}>
                {dragging ? 'Drop CSV here' : 'Upload Loox CSV — bulk export'}
              </div>
            </label>
          </div>

          <div>
            <div style={S.label}>Review Quote</div>
            <textarea value={manualQuote} onChange={e => setManualQuote(e.target.value)} placeholder="Or paste a single review here..." rows={6} style={S.textarea} />
          </div>

          <div>
            <div style={S.label}>Reviewer <span style={{ color: '#77746f', fontWeight: 400 }}>(optional)</span></div>
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
          <BgImagePicker bgImages={bgImages} bgMode={bgMode} savedImages={savedImages} onModeChange={handleBgModeChange} onSelect={selectBgImage} onUpload={handleBgFiles} onClear={clearBg} fileRef={bgFileRef} scrimColor={scrimColor} onScrimChange={handleScrimChange} uploading={bgUploading} />
          <TextColorPicker textColor={textColor} onChange={handleTextColorChange} />

          <button
            onClick={handleSingleExport}
            disabled={exporting || !manualQuote.trim()}
            style={S.exportBtn(exporting || !manualQuote.trim())}
            title={!manualQuote.trim() ? 'Enter review text before downloading.' : ''}
          >
            {exporting ? 'Exporting...' : 'Download PNG'}
          </button>
          {onAddToCart && (
            <button
              onClick={handleAddSingleToCart}
              disabled={exporting || !manualQuote.trim()}
              style={{ ...S.exportBtn(exporting || !manualQuote.trim()), background: (exporting || !manualQuote.trim()) ? '#dedbd3' : '#6e40c9', marginTop: 6 }}
              title={!manualQuote.trim() ? 'Enter review text before adding to cart.' : ''}
            >
              {exporting ? 'Rendering...' : 'Add to Cart'}
            </button>
          )}
        </div>

        {/* Right */}
        <div style={S.rightPanel}>
          <PreviewCard fmt={fmt} scale={scale}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} backgroundImage={bgImage} scrimColor={scrimColor} textColor={textColor} />
          </PreviewCard>
        </div>

        <div style={{ position: 'fixed', left: -99999, top: 0 }}>
          <div ref={singleCaptureRef} style={{ width: fmt.width, height: fmt.height }}>
            <UGCTemplate variation={variation} format={manualFormat} dimensions={fmt} attribution={attribution} backgroundImage={bgImage} scrimColor={scrimColor} textColor={textColor} />
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid #dedbd3', flexShrink: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Create</div>
        <div className="display-md" style={{ color: '#171717' }}>Review Ads</div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Left panel — flex column with fixed header/footer, scrollable list */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #dedbd3', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Fixed: CSV header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #dedbd3', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#171717', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {csvName || `${reviews.length} reviews`}
            </div>
            <div style={{ fontSize: 9, color: '#77746f', marginTop: 1 }}>{reviews.length} reviews loaded</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button onClick={loadSyncedReviews} disabled={syncedLoading} style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#d84a17', background: 'none', border: 'none', cursor: syncedLoading ? 'wait' : 'pointer', padding: 0 }}>
              {syncedLoading ? 'Loading' : 'Sync'}
            </button>
            <label style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#d84a17', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="file" accept=".csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              Replace
            </label>
            <button onClick={clearCSV} style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#77746f', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
          </div>
        </div>

        {/* Fixed: Rating filter */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #dedbd3', flexShrink: 0, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #dedbd3', flexShrink: 0, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
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
            <div style={{ padding: 20, fontSize: 10, color: '#77746f' }}>No reviews at this rating.</div>
          )}
          {filtered.map(r => {
            const isSelected = selected.has(r.id);
            const isPreviewing = previewId === r.id;
            return (
              <div key={r.id} onClick={() => setPreviewId(r.id)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #dedbd3', background: isPreviewing ? 'rgba(220,68,10,0.1)' : 'transparent', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
                  style={{ marginTop: 3, flexShrink: 0, accentColor: '#d84a17' }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: '#d84a17', marginBottom: 2 }}>{'★'.repeat(r.rating)}</div>
                  <div style={{ fontSize: 10, color: '#171717', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.quote}</div>
                  <div style={{ fontSize: 9, color: '#77746f', marginTop: 3 }}>{r.nickname}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed: Format + background + export */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #dedbd3', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.entries(FORMATS).map(([key, f]) => (
              <button key={key} onClick={() => toggleFormat(key)} style={S.fmtBtn(formatKeys.includes(key))}>{f.label}</button>
            ))}
          </div>
          <BgImagePicker bgImages={bgImages} bgMode={bgMode} savedImages={savedImages} onModeChange={handleBgModeChange} onSelect={selectBgImage} onUpload={handleBgFiles} onClear={clearBg} fileRef={bgFileRef} scrimColor={scrimColor} onScrimChange={handleScrimChange} uploading={bgUploading} />
          <TextColorPicker textColor={textColor} onChange={handleTextColorChange} />
          <button
            onClick={() => handleBulkExport()}
            disabled={exporting || selectedCount === 0}
            style={S.exportBtn(exporting || selectedCount === 0)}
            title={selectedCount === 0 ? 'Select at least one review first.' : ''}
          >
            {exporting
              ? `Exporting ${exportProgress}...`
              : selectedCount === 0 ? 'Select reviews'
              : `Export ${exportTotal} PNG${exportTotal !== 1 ? 's' : ''}`}
          </button>
          {onAddToCart && (
            <button
              onClick={handleBulkAddToCart}
              disabled={exporting || selectedCount === 0}
              style={{ ...S.exportBtn(exporting || selectedCount === 0), background: (exporting || selectedCount === 0) ? '#dedbd3' : '#6e40c9', marginTop: 4 }}
              title={selectedCount === 0 ? 'Select at least one review before adding to cart.' : ''}
            >
              {exporting ? `Rendering ${exportProgress}...` : selectedCount === 0 ? 'Select reviews' : `Add ${exportTotal} to Cart`}
            </button>
          )}
          {onAddToCart && (
            <button
              onClick={handleAddCarouselToCart}
              disabled={exporting || selectedCount < 2}
              style={{ ...S.exportBtn(exporting || selectedCount < 2), background: (exporting || selectedCount < 2) ? '#dedbd3' : '#1a7f37', marginTop: 4 }}
              title={selectedCount < 2 ? 'Select at least two reviews to build a carousel.' : ''}
            >
              {exporting ? `Building carousel ${exportProgress}...` : selectedCount < 2 ? 'Select 2+ for carousel' : `Add as Carousel (${selectedCount} cards)`}
            </button>
          )}
          {driveAuth?.connected && (
            <button
              onClick={() => handleBulkExport({ toDrive: true })}
              disabled={exporting || selectedCount === 0}
              style={{ ...S.exportBtn(exporting || selectedCount === 0), background: exporting || selectedCount === 0 ? '#dedbd3' : '#1a7f37', marginTop: 4 }}
              title={selectedCount === 0 ? 'Select at least one review before saving to Drive.' : ''}
            >
              {exporting ? `Saving ${exportProgress}...` : `Save to Drive`}
            </button>
          )}
        </div>
      </div>

      {/* Right: preview */}
      <div style={S.rightPanel}>
        <div style={S.previewToolbar}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPreviewMode('single')} style={S.modeBtn(previewMode === 'single')}>Single</button>
            <button onClick={() => setPreviewMode('bulk')} style={S.modeBtn(previewMode === 'bulk')}>Bulk</button>
          </div>
          <div style={{ fontSize: 10, color: '#77746f', letterSpacing: 1, textTransform: 'uppercase' }}>
            {selectedCount} selected
          </div>
        </div>

        {previewMode === 'bulk' ? (
          selectedCount > 0 ? (
            <>
              <div style={S.bulkGrid}>
                {bulkPreviewReviews.flatMap(review => formatKeys.map(fk => {
                  const fmt = FORMATS[fk];
                  const scale = fk === 'story' ? 0.11 : 0.14;
                  return (
                    <button
                      key={`${review.id}_${fk}`}
                      onClick={() => { setPreviewId(review.id); setPreviewMode('single'); }}
                      style={S.bulkCard}
                      title="Open this review"
                    >
                      <PreviewCard fmt={fmt} scale={scale}>
                        <UGCTemplate
                          variation={{ headline: review.quote }}
                          format={fk}
                          dimensions={fmt}
                          reviewerName={review.nickname}
                          attribution={verifiedLabel(review.handle)}
                          backgroundImage={backgroundForReview(review, fk)}
                          scrimColor={scrimColor}
                          textColor={textColor}
                        />
                      </PreviewCard>
                      <div style={S.bulkMeta}>
                        <span>{review.nickname || 'Customer'}</span>
                        <span>{fmt.label}</span>
                      </div>
                    </button>
                  );
                }))}
              </div>
              {selectedReviews.length > bulkPreviewReviews.length && (
                <div style={{ fontSize: 10, color: '#77746f', letterSpacing: 1, textTransform: 'uppercase' }}>
                  Showing first {bulkPreviewReviews.length} of {selectedReviews.length}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#77746f', fontSize: 12 }}>Select reviews to preview the batch.</div>
          )
        ) : (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
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
                        backgroundImage={backgroundForReview(previewReview, 'square')}
                        scrimColor={scrimColor}
                        textColor={textColor}
                      />
                    </PreviewCard>
                    <PreviewCard fmt={FORMATS.story} scale={storyScale}>
                      <UGCTemplate
                        variation={{ headline: previewReview.quote }}
                        format="story"
                        dimensions={FORMATS.story}
                        reviewerName={previewReview.nickname}
                        attribution={verifiedLabel(previewReview.handle)}
                        backgroundImage={backgroundForReview(previewReview, 'story')}
                        scrimColor={scrimColor}
                        textColor={textColor}
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
                      backgroundImage={backgroundForReview(previewReview, formatKeys[0])}
                      scrimColor={scrimColor}
                      textColor={textColor}
                    />
                  </PreviewCard>
                )
              ) : (
                <div style={{ color: '#77746f', fontSize: 12 }}>No reviews match filter</div>
              )}
            </div>

            {previewReview && (
              <div style={S.editPanel}>
                <div>
                  <div style={S.label}>Review Text</div>
                  <textarea
                    value={previewReview.quote}
                    onChange={e => updateReview(previewReview.id, { quote: e.target.value })}
                    onBlur={() => persistReviewEdit(previewReview)}
                    rows={4}
                    style={S.textarea}
                  />
                </div>
                <div>
                  <div style={S.label}>Reviewer</div>
                  <input
                    type="text"
                    value={previewReview.nickname || ''}
                    onChange={e => updateReview(previewReview.id, { nickname: e.target.value })}
                    onBlur={() => persistReviewEdit(previewReview)}
                    style={S.input}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Hidden capture divs */}
      <div style={{ position: 'fixed', left: -99999, top: 0 }}>
        {filtered.filter(r => selected.has(r.id)).flatMap(r => {
          // Always include square for carousel support, plus any selected formats
          const fks = [...new Set(['square', ...formatKeys])];
          return fks.map(fk => {
            const fmt = FORMATS[fk];
            const key = `${r.id}_${fk}`;
            return (
              <div key={key} ref={el => { captureRefs.current[key] = el; }} style={{ width: fmt.width, height: fmt.height }}>
                <UGCTemplate variation={{ headline: r.quote }} format={fk} dimensions={fmt} reviewerName={r.nickname} attribution={verifiedLabel(r.handle)} backgroundImage={backgroundForReview(r, fk)} scrimColor={scrimColor} textColor={textColor} />
              </div>
            );
          });
        })}
      </div>
      </div>
    </div>
  );
}

const TEXT_COLOR_OPTIONS = [
  { label: 'Dark',   value: '#333F4C' },
  { label: 'White',  value: '#ffffff' },
  { label: 'Flame',  value: '#d84a17' },
  { label: 'Black',  value: '#000000' },
];

function TextColorPicker({ textColor, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', fontWeight: 600, marginBottom: 5 }}>Text Color</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {TEXT_COLOR_OPTIONS.map(o => (
          <button key={o.label} onClick={() => onChange(o.value)} style={{
            flex: 1, padding: '5px 0', borderRadius: 3, cursor: 'pointer', fontSize: 9,
            border: `1px solid ${textColor === o.value ? '#d84a17' : '#dedbd3'}`,
            background: textColor === o.value ? 'rgba(220,68,10,0.15)' : '#f4f1ea',
            color: textColor === o.value ? '#d84a17' : '#77746f',
            fontFamily: 'inherit', letterSpacing: 1, textTransform: 'uppercase',
          }}>{o.label}</button>
        ))}
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

function BgImagePicker({ bgImages, bgMode, savedImages, onModeChange, onSelect, onUpload, onClear, fileRef, scrimColor, onScrimChange, uploading }) {
  const hasBackground = bgImages.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Background Image</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{ fontSize: 9, color: '#d84a17', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>{uploading ? 'Uploading' : '+ Upload'}</button>
          {hasBackground && <button onClick={onClear} style={{ fontSize: 9, color: '#77746f', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase' }}>Clear</button>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        <button onClick={() => onModeChange('single')} style={S.miniModeBtn(bgMode !== 'rotate')}>Single</button>
        <button onClick={() => onModeChange('rotate')} style={S.miniModeBtn(bgMode === 'rotate')}>Mix</button>
      </div>
      <input ref={fileRef} type="file" multiple accept="image/*" onChange={e => { onUpload(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
      {savedImages.length > 0 ? (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {savedImages.map(img => (
            <div key={img.id} onClick={() => onSelect(img.url)} style={{ width: 48, height: 48, borderRadius: 3, overflow: 'hidden', border: `2px solid ${bgImages.includes(img.url) ? '#d84a17' : '#e0d9c4'}`, cursor: 'pointer', flexShrink: 0, position: 'relative' }}>
              <img crossOrigin="anonymous" src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {bgMode === 'rotate' && bgImages.includes(img.url) && (
                <span style={{ position: 'absolute', right: 3, bottom: 3, padding: '1px 4px', borderRadius: 2, background: '#d84a17', color: '#fff', fontSize: 8, fontWeight: 700 }}>
                  {bgImages.indexOf(img.url) + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#77746f' }}>Upload images in Image Ads tab to reuse here.</div>
      )}
      {hasBackground && (
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', fontWeight: 600, marginBottom: 5 }}>Overlay Color</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {SCRIM_OPTIONS.map(o => (
              <button key={o.label} onClick={() => onScrimChange(o.value)} style={{
                flex: 1, padding: '5px 0', borderRadius: 3, cursor: 'pointer', fontSize: 9,
                border: `1px solid ${scrimColor === o.value ? '#d84a17' : '#e0d9c4'}`,
                background: scrimColor === o.value ? '#fef8f0' : '#fff',
                color: scrimColor === o.value ? '#d84a17' : '#8a8270',
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
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f', marginBottom: 8, fontWeight: 600 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dedbd3', borderRadius: 4, background: '#f4f1ea', color: '#171717', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1px solid #dedbd3', borderRadius: 4, background: '#f4f1ea', color: '#171717', fontFamily: 'inherit', fontSize: 12, outline: 'none' },
  fmtBtn: (active) => ({ flex: 1, padding: '7px 0', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`, background: active ? 'rgba(220,68,10,0.15)' : '#f4f1ea', color: active ? '#d84a17' : '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 }),
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#dedbd3' : '#d84a17', border: 'none', borderRadius: 4, color: disabled ? '#88857f' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
  filterBtn: (active) => ({ padding: '3px 8px', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`, background: active ? 'rgba(220,68,10,0.15)' : '#f4f1ea', color: active ? '#d84a17' : '#77746f', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer', borderRadius: 3 }),
  microBtn: { padding: '3px 7px', border: '1px solid #dedbd3', background: '#f4f1ea', color: '#77746f', fontFamily: 'inherit', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3 },
  linkBtn: { padding: 0, border: 'none', background: 'none', color: '#d84a17', fontFamily: 'inherit', fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' },
  miniModeBtn: (active) => ({ flex: 1, padding: '5px 0', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`, background: active ? 'rgba(220,68,10,0.15)' : '#f4f1ea', color: active ? '#d84a17' : '#77746f', fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 3 }),
  modeBtn: (active) => ({ padding: '6px 14px', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`, background: active ? 'rgba(220,68,10,0.12)' : '#f4f1ea', color: active ? '#d84a17' : '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 }),
  previewToolbar: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 },
  editPanel: { width: 'min(620px, 100%)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: 12, padding: 16, border: '1px solid #dedbd3', borderRadius: 4, background: '#fffdf8', boxSizing: 'border-box' },
  bulkGrid: { width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, alignItems: 'start' },
  bulkCard: { border: '1px solid #dedbd3', borderRadius: 4, background: '#fffdf8', padding: 10, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minHeight: 0 },
  bulkMeta: { width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, color: '#77746f', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },
  rightPanel: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 22, background: '#fff', padding: 32, overflow: 'auto' },
};
