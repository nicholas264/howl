import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import JSZip from 'jszip';
import { useAuth } from '@clerk/clerk-react';
import { COLORS, FONTS, canvasFont, cssLetterSpacing, loadBrandFonts } from '../brand';
import { ls, lsSet } from '../utils/localStorage';
import { fetchImageLibrary, uploadImageToLibrary, deleteImageRecord } from '../utils/imageLibrary';

const LS_PRESETS = 'howl_style_presets';
const LS_FAV     = 'howl_favorites';

const FORMATS = [
  { id: 'square', label: '4:5',  w: 1080, h: 1350 },
  { id: 'story',  label: '9:16', w: 1080, h: 1920 },
];

// Default text positions: headline near the bottom, body just under it.
const DEFAULT_TEXT_POS = { x: 0.5, y: 0.86 };
const DEFAULT_BODY_POS = { x: 0.5, y: 0.94 };
const DEFAULT_BODY_FONT = 34;

// Auto-align based on horizontal position so text reads naturally near edges.
function alignFor(x) {
  if (x < 0.33) return 'left';
  if (x > 0.67) return 'right';
  return 'center';
}

const TEXT_COLORS = [
  { id: 'white',  label: 'White',  value: '#ffffff' },
  { id: 'dark',   label: 'Dark',   value: '#1c2330' },
  { id: 'orange', label: 'Orange', value: COLORS.flame },
];

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function renderToCanvas(imgSrc, text, bodyText, fw, fh, opts) {
  const headlineSz = opts.fontSize;
  const bodySz     = opts.bodyFontSize || DEFAULT_BODY_FONT;
  await loadBrandFonts({ headline: headlineSz, body: bodySz });

  const imgEl = typeof imgSrc === 'string' ? await loadImg(imgSrc) : imgSrc;

  const canvas = document.createElement('canvas');
  canvas.width = fw; canvas.height = fh;
  const ctx = canvas.getContext('2d');

  // Cover-fit image
  const imgAR = imgEl.naturalWidth / imgEl.naturalHeight;
  const canAR = fw / fh;
  let sx, sy, sw, sh;
  if (imgAR > canAR) { sh = imgEl.naturalHeight; sw = sh * canAR; sx = (imgEl.naturalWidth - sw) / 2; sy = 0; }
  else               { sw = imgEl.naturalWidth; sh = sw / canAR; sx = 0; sy = (imgEl.naturalHeight - sh) / 2; }
  ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, fw, fh);

  const headlineLineH = Math.round(headlineSz * 1.25);
  const bodyLineH     = Math.round(bodySz * 1.4);
  const maxWidth      = fw * 0.82;

  ctx.font = canvasFont('headline', headlineSz);
  ctx.textBaseline = 'top';
  const headlineLines = wrapText(ctx, text.toUpperCase(), maxWidth);
  const headlineH = headlineLines.length * headlineLineH;

  ctx.font = canvasFont('body', bodySz);
  const bodyLines = bodyText ? wrapText(ctx, bodyText, maxWidth) : [];
  const bodyH = bodyLines.length * bodyLineH;

  const hp = opts.textPos || DEFAULT_TEXT_POS;
  const hAlign = alignFor(hp.x);
  const hx = Math.round(hp.x * fw);
  const hy = Math.round(hp.y * fh - headlineH / 2);

  const setShadow = (size) => {
    if (opts.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = Math.round(size * 0.4); ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; }
  };
  const clrShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  ctx.textAlign = hAlign;
  ctx.font = canvasFont('headline', headlineSz);
  ctx.fillStyle = opts.color;
  setShadow(headlineSz);
  headlineLines.forEach((line, i) => ctx.fillText(line, hx, hy + i * headlineLineH));

  if (bodyLines.length) {
    const bp = opts.bodyPos || DEFAULT_BODY_POS;
    const bAlign = alignFor(bp.x);
    const bx = Math.round(bp.x * fw);
    const by = Math.round(bp.y * fh - bodyH / 2);

    clrShadow();
    ctx.textAlign = bAlign;
    ctx.font = canvasFont('body', bodySz);
    ctx.fillStyle = opts.color === '#ffffff' ? 'rgba(255,255,255,0.82)'
      : opts.color === COLORS.flame ? 'rgba(220,68,10,0.82)'
      : 'rgba(28,35,48,0.82)';
    setShadow(bodySz);
    bodyLines.forEach((line, i) => ctx.fillText(line, bx, by + i * bodyLineH));
  }

  return canvas;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ── Batch preview card (CSS overlay, no canvas) ───────────────────────────
const CARD_H = 180;

function BatchCard({ img, hook, body, fmt, textPos, bodyPos, color, fontSize, bodyFontSize, shadow, onExport }) {
  const cardW = fmt.id === 'square' ? CARD_H : Math.round(CARD_H * fmt.w / fmt.h);
  const scale = CARD_H / fmt.h;
  const pxFont = fontSize * scale;
  const bodyPx = bodyFontSize * scale;
  const hAlign = alignFor(textPos.x);
  const htx = hAlign === 'left' ? '0%' : hAlign === 'right' ? '-100%' : '-50%';
  const bAlign = alignFor(bodyPos.x);
  const btx = bAlign === 'left' ? '0%' : bAlign === 'right' ? '-100%' : '-50%';

  const headlineStyle = {
    position: 'absolute', pointerEvents: 'none',
    left: `${textPos.x * 100}%`,
    top: `${textPos.y * 100}%`,
    transform: `translate(${htx}, -50%)`,
    textAlign: hAlign,
    maxWidth: '82%', color,
    fontFamily: FONTS.headline.family, fontWeight: FONTS.headline.weight,
    fontSize: `${pxFont}px`, lineHeight: 1.25,
    textTransform: 'uppercase', letterSpacing: cssLetterSpacing('headline'),
    textShadow: shadow ? '0 2px 6px rgba(0,0,0,0.85)' : 'none',
    wordBreak: 'break-word',
  };
  const bodyStyle = {
    position: 'absolute', pointerEvents: 'none',
    left: `${bodyPos.x * 100}%`,
    top: `${bodyPos.y * 100}%`,
    transform: `translate(${btx}, -50%)`,
    textAlign: bAlign,
    maxWidth: '82%', color,
    fontFamily: FONTS.body.family, fontWeight: FONTS.body.weight,
    fontSize: `${bodyPx}px`, lineHeight: 1.4,
    letterSpacing: cssLetterSpacing('body'),
    opacity: 0.85,
    textShadow: shadow ? '0 2px 6px rgba(0,0,0,0.85)' : 'none',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ position: 'relative', width: cardW, height: CARD_H, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#000', cursor: 'pointer' }} onClick={onExport} title="Click to export this combination">
      <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={headlineStyle}>{hook.toUpperCase()}</div>
      {body && <div style={bodyStyle}>{body}</div>}
      <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.55)', borderRadius: 3, padding: '2px 5px', fontSize: 8, color: '#fff', letterSpacing: 1 }}>↓</div>
    </div>
  );
}

export default function ImageAdTool({ initialText, onTextConsumed, driveAuth, onAddToCart }) {
  const { getToken } = useAuth();
  const [mode, setMode]             = useState('single'); // 'single' | 'batch'
  const [images, setImages]         = useState([]);
  const [activeImg, setActiveImg]   = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [uploading, setUploading]   = useState(0);
  const [formatId, setFormatId]     = useState('square');
  const [overlayText, setOverlayText] = useState(initialText || '');
  const [batchHooks, setBatchHooks] = useState(initialText ? initialText : '');
  const [bodyText, setBodyText]     = useState('');
  const [fontSize, setFontSize]     = useState(80);
  const [bodyFontSize, setBodyFontSize] = useState(DEFAULT_BODY_FONT);
  const [colorId, setColorId]       = useState('white');
  const [textPos, setTextPos]       = useState(DEFAULT_TEXT_POS);
  const [bodyPos, setBodyPos]       = useState(DEFAULT_BODY_POS);
  const [shadow, setShadow]         = useState(true);
  const [dragging, setDragging]     = useState(false);
  const [textDragging, setTextDragging] = useState(false);
  const [bodyDragging, setBodyDragging] = useState(false);
  const previewBoxRef = useRef(null);
  const [exporting, setExporting]   = useState(false);
  const [exportMsg, setExportMsg]   = useState('');
  const [presets, setPresets]       = useState(() => ls(LS_PRESETS, []));
  const [presetName, setPresetName] = useState('');
  const [showPresetInput, setShowPresetInput] = useState(false);

  const fileInputRef = useRef(null);
  const imgRef       = useRef(null);

  useLayoutEffect(() => {
    if (initialText) {
      setOverlayText(initialText);
      setBatchHooks(prev => prev ? `${prev}\n${initialText}` : initialText);
      onTextConsumed?.();
    }
  }, [initialText]);

  const fmt = FORMATS.find(f => f.id === formatId);
  const color = TEXT_COLORS.find(c => c.id === colorId).value;
  const styleOpts = { fontSize, bodyFontSize, color, textPos, bodyPos, shadow };

  // Drag the headline or body overlay anywhere on the preview.
  useEffect(() => {
    if (!textDragging && !bodyDragging) return;
    const setter = textDragging ? setTextPos : setBodyPos;
    const onMove = (e) => {
      const box = previewBoxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      setter({
        x: Math.max(0.02, Math.min(0.98, nx)),
        y: Math.max(0.04, Math.min(0.96, ny)),
      });
    };
    const onUp = () => { setTextDragging(false); setBodyDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [textDragging, bodyDragging]);

  // ── Image management ──────────────────────────────────────────────────
  // Load library on mount.
  useEffect(() => {
    let cancelled = false;
    fetchImageLibrary().then(rows => {
      if (cancelled) return;
      setImages(rows);
      setActiveImg(rows[0] || null);
      setSelectedIds(new Set(rows.map(r => r.id)));
    });
    return () => { cancelled = true; };
  }, []);

  const addImage = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(n => n + 1);
    try {
      const record = await uploadImageToLibrary(file, getToken);
      if (!record) throw new Error('Upload failed');
      setImages(prev => [record, ...prev]);
      setActiveImg(record);
      setSelectedIds(prev => new Set([...prev, record.id]));
    } catch (err) {
      alert(`Image upload failed: ${err?.message || err}`);
    } finally {
      setUploading(n => Math.max(0, n - 1));
    }
  }, [getToken]);

  const removeImage = useCallback(async (id) => {
    const prevImages = images;
    setImages(prev => prev.filter(x => x.id !== id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (activeImg?.id === id) {
      const next = prevImages.filter(x => x.id !== id);
      setActiveImg(next[0] || null);
    }
    const ok = await deleteImageRecord(id);
    if (!ok) {
      // restore on failure
      setImages(prevImages);
      alert('Could not delete image.');
    }
  }, [images, activeImg]);

  const toggleSelected = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ── Presets ───────────────────────────────────────────────────────────
  const savePreset = () => {
    if (!presetName.trim()) return;
    const p = { id: Date.now(), name: presetName.trim(), fontSize, bodyFontSize, colorId, textPos, bodyPos, shadow };
    const next = [p, ...presets].slice(0, 10);
    setPresets(next);
    lsSet(LS_PRESETS, next);
    setPresetName('');
    setShowPresetInput(false);
  };

  const applyPreset = (p) => {
    setFontSize(p.fontSize);
    if (p.bodyFontSize) setBodyFontSize(p.bodyFontSize);
    setColorId(p.colorId);
    if (p.textPos) setTextPos(p.textPos);
    if (p.bodyPos) setBodyPos(p.bodyPos);
    setShadow(p.shadow);
  };

  const deletePreset = (id) => {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    lsSet(LS_PRESETS, next);
  };

  const loadFavoriteHooks = () => {
    const favs = ls(LS_FAV, []);
    const hooks = favs.map(f => f.hook).filter(Boolean);
    if (!hooks.length) { alert('No saved variations yet. Star some in the Results tab.'); return; }
    setBatchHooks(hooks.join('\n'));
  };

  // ── Single export ─────────────────────────────────────────────────────
  const handleExport = useCallback(async ({ toDrive = false } = {}) => {
    if (!activeImg || !overlayText.trim()) return;
    setExporting(true);
    try {
      const canvas = await renderToCanvas(activeImg.url, overlayText, bodyText || null, fmt.w, fmt.h, styleOpts);
      const dataUrl = canvas.toDataURL('image/png');
      const fileName = `howl_image_${formatId}_${Date.now()}.png`;
      if (toDrive && driveAuth?.connected) {
        await driveAuth.uploadFile({ fileName, fileData: dataUrl, mimeType: 'image/png' });
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = fileName;
        a.click();
      }
    } catch (err) { alert(`Export failed: ${err?.message || err}`); }
    finally { setExporting(false); }
  }, [activeImg, overlayText, bodyText, fmt, styleOpts, formatId, driveAuth]);

  // ── Queue for Meta Publish ───────────────────────────────────────────
  const handleQueueForPublish = useCallback(async () => {
    if (!activeImg || !overlayText.trim()) return;
    setExporting(true);
    try {
      const [squareCanvas, storyCanvas] = await Promise.all([
        renderToCanvas(activeImg.url, overlayText, bodyText || null, 1080, 1080, styleOpts),
        renderToCanvas(activeImg.url, overlayText, bodyText || null, 1080, 1920, styleOpts),
      ]);
      const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      await onAddToCart?.({
        id: Date.now(),
        type: 'static',
        squareUrl: squareCanvas.toDataURL('image/jpeg', 0.92),
        storyUrl:  storyCanvas.toDataURL('image/jpeg', 0.92),
        name: `HOWL | Static | ${overlayText.slice(0, 30).trim()} | ${monthDay}`,
        hook: overlayText,
        body: bodyText || '',
      });
      setExportMsg('Added to cart!');
      setTimeout(() => setExportMsg(''), 2000);
    } catch (err) { alert(`Failed to add to cart: ${err?.message || err}`); }
    finally { setExporting(false); }
  }, [activeImg, overlayText, bodyText, styleOpts, onAddToCart]);

  // ── Single card export from batch grid ───────────────────────────────
  const exportCard = async (img, hook) => {
    try {
      const canvas = await renderToCanvas(img.url, hook, bodyText || null, fmt.w, fmt.h, styleOpts);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `howl_${hook.slice(0,16).replace(/\W+/g,'_').toLowerCase()}_${Date.now()}.png`;
      a.click();
    } catch (err) { alert(`Export failed: ${err?.message}`); }
  };

  // ── Batch add to cart ─────────────────────────────────────────────────
  const handleBatchAddToCart = useCallback(async () => {
    const selImgs = images.filter(i => selectedIds.has(i.id));
    const hooks = batchHooks.split('\n').map(h => h.trim()).filter(Boolean);
    if (!selImgs.length || !hooks.length || !onAddToCart) return;

    setExporting(true);
    const total = selImgs.length * hooks.length;
    let done = 0;
    setExportMsg(`0 / ${total}`);

    try {
      for (const img of selImgs) {
        for (const hook of hooks) {
          const [sq, st] = await Promise.all([
            renderToCanvas(img.url, hook, bodyText || null, 1080, 1080, styleOpts),
            renderToCanvas(img.url, hook, bodyText || null, 1080, 1920, styleOpts),
          ]);
          const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          await onAddToCart({
            id: Date.now() + Math.random(),
            type: 'static',
            squareUrl: sq.toDataURL('image/jpeg', 0.85),
            storyUrl:  st.toDataURL('image/jpeg', 0.85),
            name: `HOWL | Static | ${hook.slice(0, 30).trim()} | ${monthDay}`,
            hook,
            body: bodyText || '',
          });
          done++;
          setExportMsg(`${done} / ${total}`);
        }
      }
    } catch (err) { alert(`Failed: ${err?.message || err}`); }
    finally { setExporting(false); setExportMsg(''); }
  }, [images, selectedIds, batchHooks, bodyText, styleOpts, onAddToCart]);

  // ── Batch export ZIP ─────────────────────────────────────────────────
  const handleBatchExport = useCallback(async () => {
    const selImgs = images.filter(i => selectedIds.has(i.id));
    const hooks = batchHooks.split('\n').map(h => h.trim()).filter(Boolean);
    if (!selImgs.length || !hooks.length) return;

    setExporting(true);
    const total = selImgs.length * hooks.length;
    let done = 0;
    setExportMsg(`0 / ${total}`);

    try {
      const zip = new JSZip();
      for (const img of selImgs) {
        for (const hook of hooks) {
          const canvas = await renderToCanvas(img.url, hook, bodyText || null, fmt.w, fmt.h, styleOpts);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          const slug = hook.slice(0, 20).replace(/\W+/g, '_').toLowerCase();
          zip.file(`howl_${formatId}_${img.id}_${slug}.png`, blob);
          done++;
          setExportMsg(`${done} / ${total}`);
        }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `howl_image_ads_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { alert(`Export failed: ${err?.message}`); }
    finally { setExporting(false); setExportMsg(''); }
  }, [images, selectedIds, batchHooks, bodyText, fmt, styleOpts, formatId]);

  // ── Preview dims ──────────────────────────────────────────────────────
  const availH = typeof window !== 'undefined' ? window.innerHeight - 130 : 800;
  const availW = typeof window !== 'undefined' ? window.innerWidth - 320 : 700;
  const previewScale = Math.min(availH / fmt.h, availW / fmt.w, 1);
  const displayW = Math.round(fmt.w * previewScale);
  const displayH = Math.round(fmt.h * previewScale);
  const previewFontSize = fontSize * previewScale;

  const previewBodyFontSize = bodyFontSize * previewScale;
  const headlineAlign = alignFor(textPos.x);
  const headlineTx = headlineAlign === 'left' ? '0%' : headlineAlign === 'right' ? '-100%' : '-50%';
  const bodyAlign = alignFor(bodyPos.x);
  const bodyTx = bodyAlign === 'left' ? '0%' : bodyAlign === 'right' ? '-100%' : '-50%';

  const headlineOverlayStyle = {
    position: 'absolute',
    left: `${textPos.x * 100}%`,
    top: `${textPos.y * 100}%`,
    transform: `translate(${headlineTx}, -50%)`,
    textAlign: headlineAlign,
    maxWidth: '82%', color,
    fontFamily: FONTS.headline.family, fontWeight: FONTS.headline.weight,
    fontSize: `${previewFontSize}px`, lineHeight: 1.25,
    textTransform: 'uppercase', letterSpacing: cssLetterSpacing('headline'),
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
    wordBreak: 'break-word',
    cursor: textDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    outline: textDragging ? `1px dashed ${COLORS.flame}` : 'none',
    outlineOffset: 6,
  };
  const bodyOverlayStyle = {
    position: 'absolute',
    left: `${bodyPos.x * 100}%`,
    top: `${bodyPos.y * 100}%`,
    transform: `translate(${bodyTx}, -50%)`,
    textAlign: bodyAlign,
    maxWidth: '82%', color,
    fontFamily: FONTS.body.family, fontWeight: FONTS.body.weight,
    fontSize: `${previewBodyFontSize}px`, lineHeight: 1.4,
    letterSpacing: cssLetterSpacing('body'),
    opacity: 0.85,
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
    wordBreak: 'break-word',
    cursor: bodyDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    outline: bodyDragging ? `1px dashed ${COLORS.flame}` : 'none',
    outlineOffset: 6,
  };

  // ── Batch grid data ───────────────────────────────────────────────────
  const selImgs = images.filter(i => selectedIds.has(i.id));
  const batchHookList = batchHooks.split('\n').map(h => h.trim()).filter(Boolean);
  const batchCombos = selImgs.flatMap(img => batchHookList.map(hook => ({ img, hook })));
  const canBatchExport = selImgs.length > 0 && batchHookList.length > 0 && !exporting;
  const canSingleExport = !!activeImg && !!overlayText.trim() && !exporting;

  // ── Controls shared between modes ────────────────────────────────────
  const StyleControls = (
    <>
      <div>
        <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
          <span>Headline Size</span><span style={{ color: '#f0f4f8' }}>{fontSize}px</span>
        </div>
        <input type="range" min={32} max={200} step={4} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#DC440A' }} />
      </div>

      <div>
        <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
          <span>Body Size</span><span style={{ color: '#f0f4f8' }}>{bodyFontSize}px</span>
        </div>
        <input type="range" min={14} max={120} step={2} value={bodyFontSize} onChange={e => setBodyFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#DC440A' }} />
      </div>

      <div>
        <div style={S.label}>Text Color</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TEXT_COLORS.map(c => {
            const isLight = c.value === '#ffffff';
            return (
              <button key={c.id} onClick={() => setColorId(c.id)} style={{
                flex: 1, padding: '7px 0', borderRadius: 4, cursor: 'pointer',
                border: `2px solid ${colorId === c.id ? '#DC440A' : '#2a3441'}`,
                background: isLight ? '#f5f5f5' : c.value,
                color: isLight ? '#333' : '#fff',
                fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                fontWeight: colorId === c.id ? 700 : 400,
              }}>{c.label}</button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
          <span>Headline Position</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setTextPos({ x: 0.5, y: 0.5 })} style={S.link}>Center</button>
            <button onClick={() => setTextPos(DEFAULT_TEXT_POS)} style={S.link}>Reset</button>
          </div>
        </div>
        <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span>Body Position</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setBodyPos({ x: 0.5, y: 0.5 })} style={S.link}>Center</button>
            <button onClick={() => setBodyPos(DEFAULT_BODY_POS)} style={S.link}>Reset</button>
          </div>
        </div>
        <div style={{ fontSize: 9, color: '#8b949e', lineHeight: 1.5 }}>
          Drag the headline or body on the preview to reposition.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.label}>Text Shadow</div>
        <button onClick={() => setShadow(s => !s)} style={{
          padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
          border: `1px solid ${shadow ? '#DC440A' : '#2a3441'}`,
          background: shadow ? '#DC440A' : '#1c2330',
          color: shadow ? '#fff' : '#8b949e',
          fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
        }}>{shadow ? 'On' : 'Off'}</button>
      </div>

      {/* Presets */}
      <div>
        <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Style Presets</span>
          <button onClick={() => setShowPresetInput(v => !v)} style={S.link}>+ Save</button>
        </div>
        {showPresetInput && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && savePreset()}
              placeholder="Preset name…"
              style={{ flex: 1, padding: '5px 8px', border: '1px solid #2a3441', borderRadius: 4, fontFamily: 'inherit', fontSize: 10, outline: 'none' }}
            />
            <button onClick={savePreset} style={{ ...S.link, color: '#fff', background: '#DC440A', padding: '5px 10px', borderRadius: 4 }}>Save</button>
          </div>
        )}
        {presets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {presets.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => applyPreset(p)} style={{
                  flex: 1, textAlign: 'left', padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                  border: '1px solid #2a3441', background: '#1c2330', color: '#f0f4f8',
                  fontFamily: 'inherit', fontSize: 10,
                }}>{p.name} <span style={{ color: '#b0a898', fontSize: 9 }}>{p.fontSize}px · {p.colorId}</span></button>
                <button onClick={() => deletePreset(p.id)} style={{ ...S.link, color: '#374151', fontSize: 12 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid #2a3441', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Create</div>
          <div className="display-md" style={{ color: '#f0f4f8' }}>Image Ads</div>
        </div>
        <button
          onClick={async () => {
            try {
              const r = await fetch('/api/db/schema', { method: 'POST' });
              const d = await r.json();
              alert(r.ok ? 'Schema synced — image_library table is ready.' : `Schema failed: ${d.error || r.status}`);
            } catch (err) { alert(`Schema failed: ${err.message}`); }
          }}
          style={{ fontSize: 9, padding: '6px 12px', borderRadius: 4, border: '1px solid #2a3441', background: '#1c2330', color: '#8b949e', fontFamily: 'inherit', letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}
          title="Run /api/db/schema — idempotent, safe to click."
        >Init DB Schema</button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

      {/* Left panel */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #2a3441', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Mode toggle */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a3441', display: 'flex', gap: 6 }}>
          {['single', 'batch'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${mode === m ? '#DC440A' : '#2a3441'}`,
              background: mode === m ? '#DC440A' : '#1c2330',
              color: mode === m ? '#fff' : '#8b949e',
              fontFamily: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
            }}>{m === 'single' ? 'Single' : 'Batch'}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Format */}
          <div>
            <div style={S.label}>Format</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {FORMATS.map(f => (
                <button key={f.id} onClick={() => setFormatId(f.id)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 4, cursor: 'pointer',
                  border: `2px solid ${formatId === f.id ? '#DC440A' : '#2a3441'}`,
                  background: formatId === f.id ? 'rgba(220,68,10,0.15)' : '#1c2330',
                  color: formatId === f.id ? '#DC440A' : '#8b949e',
                  fontFamily: 'inherit', fontSize: 10, fontWeight: formatId === f.id ? 700 : 400,
                  letterSpacing: 1, textTransform: 'uppercase',
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          {/* Image library */}
          <div
            onDrop={e => { e.preventDefault(); setDragging(false); Array.from(e.dataTransfer.files).forEach(addImage); }}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={e => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragging(false); }}
            style={{ borderRadius: 4, padding: dragging ? 6 : 0, margin: dragging ? -6 : 0, background: dragging ? 'rgba(220,68,10,0.10)' : 'transparent', outline: dragging ? '1px dashed #DC440A' : 'none' }}
          >
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
              <span>Images {mode === 'batch' && images.length > 0 && <span style={{ color: '#DC440A' }}>({selectedIds.size} selected)</span>}{uploading > 0 && <span style={{ color: '#8b949e', marginLeft: 6 }}>· uploading {uploading}…</span>}</span>
              <button onClick={() => fileInputRef.current?.click()} style={S.link}>+ Add</button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => { Array.from(e.target.files).forEach(addImage); e.target.value = ''; }} style={{ display: 'none' }} />
            {images.length === 0 ? (
              <label
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'block', padding: '18px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#374151'}`, background: 'transparent' }}
              >
                <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8b949e' }}>{dragging ? 'Drop images here' : 'Upload or drag images'}</div>
              </label>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {images.map(img => {
                  const isActive = mode === 'single' ? activeImg?.id === img.id : selectedIds.has(img.id);
                  return (
                    <div key={img.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 4, overflow: 'hidden', border: `2px solid ${isActive ? '#DC440A' : '#2a3441'}`, cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => mode === 'single' ? setActiveImg(img) : toggleSelected(img.id)}>
                      <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {mode === 'batch' && selectedIds.has(img.id) && (
                        <div style={{ position: 'absolute', top: 3, left: 3, width: 14, height: 14, background: '#DC440A', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>
                        </div>
                      )}
                      <button onClick={e => { e.stopPropagation(); removeImage(img.id); }}
                        style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, background: 'rgba(51,63,76,0.75)', border: 'none', borderRadius: 2, color: '#fff', fontSize: 9, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    </div>
                  );
                })}
                <div onClick={() => fileInputRef.current?.click()} style={{ width: 72, height: 72, borderRadius: 4, border: '1px dashed #c0b89a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8b949e', fontSize: 20, flexShrink: 0 }}>+</div>
              </div>
            )}
          </div>

          {/* Single mode: hook + body */}
          {mode === 'single' && (
            <>
              <div>
                <div style={S.label}>Hook <span style={{ color: '#b0a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— big text</span></div>
                <textarea value={overlayText} onChange={e => setOverlayText(e.target.value)} placeholder="e.g. Still had a campfire at 6°" rows={2} style={S.textarea} />
              </div>
              <div>
                <div style={S.label}>Body <span style={{ color: '#b0a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— optional</span></div>
                <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="e.g. 938 reviews. 90.4% five star." rows={2} style={S.textarea} />
              </div>
            </>
          )}

          {/* Batch mode: hooks */}
          {mode === 'batch' && (
            <>
              <div>
                <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Hooks <span style={{ color: '#b0a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— one per line</span></span>
                  <button onClick={loadFavoriteHooks} style={S.link}>★ Load saved</button>
                </div>
                <textarea value={batchHooks} onChange={e => setBatchHooks(e.target.value)} placeholder={"Still had a campfire at 6°\nNucking futs.\nFeel it to believe it."} rows={6} style={S.textarea} />
                {batchHookList.length > 0 && images.length > 0 && (
                  <div style={{ fontSize: 9, color: '#8b949e', marginTop: 4 }}>
                    {selImgs.length} image{selImgs.length !== 1 ? 's' : ''} × {batchHookList.length} hook{batchHookList.length !== 1 ? 's' : ''} = <b style={{ color: '#f0f4f8' }}>{selImgs.length * batchHookList.length} ads</b>
                  </div>
                )}
              </div>
              <div>
                <div style={S.label}>Body <span style={{ color: '#b0a898', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— optional, applied to all</span></div>
                <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="e.g. 938 reviews. 90.4% five star." rows={2} style={S.textarea} />
              </div>
              {mode === 'batch' && images.length > 0 && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setSelectedIds(new Set(images.map(i => i.id)))} style={{ ...S.link, fontSize: 9 }}>Select all</button>
                  <span style={{ color: '#2a3441' }}>·</span>
                  <button onClick={() => setSelectedIds(new Set())} style={{ ...S.link, fontSize: 9, color: '#b0a898' }}>None</button>
                </div>
              )}
            </>
          )}

          {StyleControls}
        </div>

        {/* Export pinned bottom */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #2a3441' }}>
          {exporting && exportMsg && (
            <div style={{ fontSize: 9, color: '#8b949e', marginBottom: 8, letterSpacing: 1 }}>Rendering {exportMsg}…</div>
          )}
          {mode === 'single' ? (
            <>
              <button onClick={() => handleExport()} disabled={!canSingleExport} style={S.exportBtn(!canSingleExport)}>
                {exporting ? 'Exporting…' : !activeImg ? 'Upload an image' : !overlayText.trim() ? 'Enter hook text' : `Export PNG (${fmt.label})`}
              </button>
              <button onClick={handleQueueForPublish} disabled={!canSingleExport || exporting} style={{ ...S.exportBtn(!canSingleExport || exporting), background: (!canSingleExport || exporting) ? undefined : '#6e40c9', marginTop: 6 }}>
                {exportMsg === 'Added to cart!' ? 'Added to Cart!' : 'Add to Cart'}
              </button>
              {driveAuth?.connected && (
                <button onClick={() => handleExport({ toDrive: true })} disabled={!canSingleExport} style={{ ...S.exportBtn(!canSingleExport), background: !canSingleExport ? undefined : '#1a7f37', marginTop: 6 }}>
                  {exporting ? 'Saving…' : 'Save to Drive'}
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={handleBatchExport} disabled={!canBatchExport} style={S.exportBtn(!canBatchExport)}>
                {exporting ? `Rendering ${exportMsg}…`
                  : !selImgs.length ? 'Select images'
                  : !batchHookList.length ? 'Enter hooks above'
                  : `Export ${selImgs.length * batchHookList.length} PNGs as ZIP`}
              </button>
              {onAddToCart && (
                <button onClick={handleBatchAddToCart} disabled={!canBatchExport} style={{ ...S.exportBtn(!canBatchExport), background: !canBatchExport ? undefined : '#6e40c9', marginTop: 6 }}>
                  {exporting ? `Adding ${exportMsg}…`
                    : !selImgs.length ? 'Select images'
                    : !batchHookList.length ? 'Enter hooks above'
                    : `Add ${selImgs.length * batchHookList.length} to Cart`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: preview area */}
      <div style={{ flex: 1, minWidth: 0, background: '#1a1a1a', overflow: 'auto', display: 'flex', alignItems: mode === 'batch' ? 'flex-start' : 'center', justifyContent: mode === 'batch' ? 'flex-start' : 'center' }}>
        {mode === 'single' ? (
          activeImg ? (
            <div ref={previewBoxRef} style={{ position: 'relative', width: displayW, height: displayH, flexShrink: 0 }}>
              <img ref={imgRef} src={activeImg.url} alt="" draggable={false} style={{ width: displayW, height: displayH, objectFit: 'cover', display: 'block' }} />
              {overlayText && (
                <div
                  style={headlineOverlayStyle}
                  onMouseDown={(e) => { e.preventDefault(); setTextDragging(true); }}
                >
                  {overlayText.toUpperCase()}
                </div>
              )}
              {bodyText && (
                <div
                  style={bodyOverlayStyle}
                  onMouseDown={(e) => { e.preventDefault(); setBodyDragging(true); }}
                >
                  {bodyText}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40, lineHeight: 1.8 }}>Upload an image to preview</div>
          )
        ) : (
          batchCombos.length === 0 ? (
            <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40, lineHeight: 1.8 }}>
              {images.length === 0 ? 'Upload images to get started' : selImgs.length === 0 ? 'Select at least one image' : 'Enter hooks in the left panel'}
            </div>
          ) : (
            <div style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
              {batchCombos.map(({ img, hook }, i) => (
                <BatchCard key={i} img={img} hook={hook} body={bodyText} fmt={fmt} textPos={textPos} bodyPos={bodyPos} color={color} fontSize={fontSize} bodyFontSize={bodyFontSize} shadow={shadow} onExport={() => exportCard(img, hook)} />
              ))}
            </div>
          )
        )}
      </div>
      </div>
    </div>
  );
}

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e', marginBottom: 6, fontWeight: 600, display: 'block' },
  link: { fontSize: 9, color: '#DC440A', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #2a3441', borderRadius: 4, background: '#1c2330', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#2a3441' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
};
