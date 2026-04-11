import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import JSZip from 'jszip';
import { COLORS } from '../brand';

const LS_IMAGES  = 'howl_saved_images';
const LS_PRESETS = 'howl_style_presets';
const LS_FAV     = 'howl_favorites';
const LS_PUBLISH = 'howl_publish_queue';

const FORMATS = [
  { id: 'square', label: '1:1',  w: 1080, h: 1080 },
  { id: 'story',  label: '9:16', w: 1080, h: 1920 },
];

const POSITIONS = [
  { id: 'tl', label: '↖', v: 'top',    h: 'left'   },
  { id: 'tc', label: '↑', v: 'top',    h: 'center' },
  { id: 'tr', label: '↗', v: 'top',    h: 'right'  },
  { id: 'ml', label: '←', v: 'middle', h: 'left'   },
  { id: 'mc', label: '·', v: 'middle', h: 'center' },
  { id: 'mr', label: '→', v: 'middle', h: 'right'  },
  { id: 'bl', label: '↙', v: 'bottom', h: 'left'   },
  { id: 'bc', label: '↓', v: 'bottom', h: 'center' },
  { id: 'br', label: '↘', v: 'bottom', h: 'right'  },
];

const TEXT_COLORS = [
  { id: 'white',  label: 'White',  value: '#ffffff' },
  { id: 'dark',   label: 'Dark',   value: '#333F4C' },
  { id: 'orange', label: 'Orange', value: COLORS.flame },
];

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

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
  await Promise.all([
    document.fonts.load(`800 ${opts.fontSize}px Montserrat`),
    document.fonts.load(`700 ${Math.round(opts.fontSize * 0.42)}px "Libre Franklin"`),
  ]);

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

  const quoteSz    = opts.fontSize;
  const bodySz     = Math.round(quoteSz * 0.42);
  const quoteLineH = Math.round(quoteSz * 1.25);
  const bodyLineH  = Math.round(bodySz * 1.4);
  const maxWidth   = fw * 0.82;
  const margin     = fw * 0.09;
  const gap        = Math.round(quoteSz * 0.45);

  ctx.font = `800 ${quoteSz}px Montserrat, sans-serif`;
  ctx.textBaseline = 'top';
  const quoteLines = wrapText(ctx, text, maxWidth);
  const quoteH = quoteLines.length * quoteLineH;

  ctx.font = `700 ${bodySz}px "Libre Franklin", sans-serif`;
  const bodyLines = bodyText ? wrapText(ctx, bodyText, maxWidth) : [];
  const bodyH = bodyLines.length ? gap + bodyLines.length * bodyLineH : 0;
  const blockH = quoteH + bodyH;

  let x, align;
  if (opts.h === 'left')       { x = margin;      align = 'left'; }
  else if (opts.h === 'right') { x = fw - margin; align = 'right'; }
  else                         { x = fw / 2;      align = 'center'; }

  const vPad = fh * 0.08;
  let y;
  if (opts.v === 'top')         y = vPad;
  else if (opts.v === 'bottom') y = fh - vPad - blockH;
  else                          y = (fh - blockH) / 2;

  const setShadow = () => {
    if (opts.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = Math.round(quoteSz * 0.4); ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; }
  };
  const clrShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  ctx.textAlign = align;
  ctx.font = `800 ${quoteSz}px Montserrat, sans-serif`;
  ctx.fillStyle = opts.color;
  setShadow();
  quoteLines.forEach((line, i) => ctx.fillText(line, x, y + i * quoteLineH));

  if (bodyLines.length) {
    clrShadow();
    ctx.font = `700 ${bodySz}px "Libre Franklin", sans-serif`;
    ctx.fillStyle = opts.color === '#ffffff' ? 'rgba(255,255,255,0.82)'
      : opts.color === COLORS.flame ? 'rgba(220,68,10,0.82)'
      : 'rgba(51,63,76,0.75)';
    setShadow();
    bodyLines.forEach((line, i) => ctx.fillText(line, x, y + quoteH + gap + i * bodyLineH));
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

function BatchCard({ img, hook, body, fmt, pos, color, fontSize, shadow, onExport }) {
  const cardW = fmt.id === 'square' ? CARD_H : Math.round(CARD_H * fmt.w / fmt.h);
  const scale = CARD_H / fmt.h;
  const pxFont = fontSize * scale;

  const overlayStyle = {
    position: 'absolute', pointerEvents: 'none',
    left: pos.h === 'left' ? '9%' : pos.h === 'right' ? 'auto' : '50%',
    right: pos.h === 'right' ? '9%' : 'auto',
    top: pos.v === 'top' ? '8%' : pos.v === 'middle' ? '50%' : 'auto',
    bottom: pos.v === 'bottom' ? '8%' : 'auto',
    transform: [pos.h === 'center' ? 'translateX(-50%)' : '', pos.v === 'middle' ? 'translateY(-50%)' : ''].filter(Boolean).join(' ') || 'none',
    textAlign: pos.h === 'center' ? 'center' : pos.h,
    maxWidth: '82%', color,
    fontFamily: "'Montserrat', sans-serif", fontWeight: 800,
    fontSize: `${pxFont}px`, lineHeight: 1.25,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    textShadow: shadow ? '0 2px 6px rgba(0,0,0,0.85)' : 'none',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ position: 'relative', width: cardW, height: CARD_H, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#000', cursor: 'pointer' }} onClick={onExport} title="Click to export this combination">
      <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={overlayStyle}>
        <div>{hook.toUpperCase()}</div>
        {body && <div style={{ marginTop: '0.35em', fontSize: '0.52em', fontFamily: "'Libre Franklin', sans-serif", fontWeight: 700, opacity: 0.85, letterSpacing: '0.06em', lineHeight: 1.4 }}>{body}</div>}
      </div>
      <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.55)', borderRadius: 3, padding: '2px 5px', fontSize: 8, color: '#fff', letterSpacing: 1 }}>↓</div>
    </div>
  );
}

export default function ImageAdTool({ initialText, onTextConsumed, driveAuth }) {
  const [mode, setMode]             = useState('single'); // 'single' | 'batch'
  const [images, setImages]         = useState(() => ls(LS_IMAGES, []));
  const [activeImg, setActiveImg]   = useState(() => { const imgs = ls(LS_IMAGES, []); return imgs[0] || null; });
  const [selectedIds, setSelectedIds] = useState(() => { const imgs = ls(LS_IMAGES, []); return new Set(imgs.map(i => i.id)); });
  const [formatId, setFormatId]     = useState('square');
  const [overlayText, setOverlayText] = useState(initialText || '');
  const [batchHooks, setBatchHooks] = useState(initialText ? initialText : '');
  const [bodyText, setBodyText]     = useState('');
  const [fontSize, setFontSize]     = useState(80);
  const [colorId, setColorId]       = useState('white');
  const [positionId, setPositionId] = useState('bc');
  const [shadow, setShadow]         = useState(true);
  const [dragging, setDragging]     = useState(false);
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
  const pos = POSITIONS.find(p => p.id === positionId);
  const color = TEXT_COLORS.find(c => c.id === colorId).value;
  const styleOpts = { fontSize, color, v: pos.v, h: pos.h, shadow };

  // ── Image management ──────────────────────────────────────────────────
  const addImage = useCallback((file) => {
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
        const entry = { id: Date.now(), url };
        setImages(prev => {
          const next = [entry, ...prev.filter(x => x.url !== url)].slice(0, 8);
          lsSet(LS_IMAGES, next);
          return next;
        });
        setActiveImg(entry);
        setSelectedIds(prev => new Set([...prev, entry.id]));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const removeImage = useCallback((id) => {
    setImages(prev => {
      const next = prev.filter(x => x.id !== id);
      lsSet(LS_IMAGES, next);
      if (activeImg?.id === id) setActiveImg(next[0] || null);
      return next;
    });
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, [activeImg]);

  const toggleSelected = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ── Presets ───────────────────────────────────────────────────────────
  const savePreset = () => {
    if (!presetName.trim()) return;
    const p = { id: Date.now(), name: presetName.trim(), fontSize, colorId, positionId, shadow };
    const next = [p, ...presets].slice(0, 10);
    setPresets(next);
    lsSet(LS_PRESETS, next);
    setPresetName('');
    setShowPresetInput(false);
  };

  const applyPreset = (p) => {
    setFontSize(p.fontSize);
    setColorId(p.colorId);
    setPositionId(p.positionId);
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
      const canvas = await renderToCanvas(activeImg.url, overlayText, bodyText || null, fmt.w, fmt.h, styleOpts);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const entry = {
        id: Date.now(),
        url: dataUrl,
        name: `HOWL ${overlayText.slice(0, 24).trim()}`,
        hook: overlayText,
        body: bodyText || '',
      };
      try {
        const prev = JSON.parse(localStorage.getItem(LS_PUBLISH) || '[]');
        localStorage.setItem(LS_PUBLISH, JSON.stringify([entry, ...prev]));
      } catch {}
      setExportMsg('Queued for publish!');
      setTimeout(() => setExportMsg(''), 2000);
    } catch (err) { alert(`Failed: ${err?.message || err}`); }
    finally { setExporting(false); }
  }, [activeImg, overlayText, bodyText, fmt, styleOpts]);

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

  const overlayStyle = {
    position: 'absolute', pointerEvents: 'none',
    left: pos.h === 'left' ? '9%' : pos.h === 'right' ? 'auto' : '50%',
    right: pos.h === 'right' ? '9%' : 'auto',
    top: pos.v === 'top' ? '8%' : pos.v === 'middle' ? '50%' : 'auto',
    bottom: pos.v === 'bottom' ? '8%' : 'auto',
    transform: [pos.h === 'center' ? 'translateX(-50%)' : '', pos.v === 'middle' ? 'translateY(-50%)' : ''].filter(Boolean).join(' ') || 'none',
    textAlign: pos.h === 'center' ? 'center' : pos.h,
    maxWidth: '82%', color,
    fontFamily: "'Montserrat', sans-serif", fontWeight: 800,
    fontSize: `${previewFontSize}px`, lineHeight: 1.25,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
    wordBreak: 'break-word',
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
          <span>Font Size</span><span style={{ color: '#333F4C' }}>{fontSize}px</span>
        </div>
        <input type="range" min={32} max={200} step={4} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#DC440A' }} />
      </div>

      <div>
        <div style={S.label}>Text Color</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TEXT_COLORS.map(c => (
            <button key={c.id} onClick={() => setColorId(c.id)} style={{
              flex: 1, padding: '7px 0', borderRadius: 4, cursor: 'pointer',
              border: `2px solid ${colorId === c.id ? c.value : '#e0d9c4'}`,
              background: c.value === '#ffffff' ? '#f5f5f5' : c.value,
              color: c.value === '#ffffff' ? '#333' : '#fff',
              fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
              fontWeight: colorId === c.id ? 700 : 400,
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      <div>
        <div style={S.label}>Position</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {POSITIONS.map(p => (
            <button key={p.id} onClick={() => setPositionId(p.id)} style={{
              padding: '8px 0', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${positionId === p.id ? '#DC440A' : '#e0d9c4'}`,
              background: positionId === p.id ? '#fef8f0' : '#fff',
              color: positionId === p.id ? '#DC440A' : '#8a8270',
              fontFamily: 'inherit', fontSize: 14,
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.label}>Text Shadow</div>
        <button onClick={() => setShadow(s => !s)} style={{
          padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
          border: `1px solid ${shadow ? '#DC440A' : '#e0d9c4'}`,
          background: shadow ? '#DC440A' : '#fff',
          color: shadow ? '#fff' : '#8a8270',
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
              style={{ flex: 1, padding: '5px 8px', border: '1px solid #e0d9c4', borderRadius: 4, fontFamily: 'inherit', fontSize: 10, outline: 'none' }}
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
                  border: '1px solid #e0d9c4', background: '#fff', color: '#333F4C',
                  fontFamily: 'inherit', fontSize: 10,
                }}>{p.name} <span style={{ color: '#b0a898', fontSize: 9 }}>{p.fontSize}px · {p.colorId} · {p.positionId}</span></button>
                <button onClick={() => deletePreset(p.id)} style={{ ...S.link, color: '#c0b89a', fontSize: 12 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>

      {/* Left panel */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Mode toggle */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0d9c4', display: 'flex', gap: 6 }}>
          {['single', 'batch'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${mode === m ? '#DC440A' : '#e0d9c4'}`,
              background: mode === m ? '#DC440A' : '#fff',
              color: mode === m ? '#fff' : '#8a8270',
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
                  border: `2px solid ${formatId === f.id ? '#DC440A' : '#e0d9c4'}`,
                  background: formatId === f.id ? '#fef8f0' : '#fff',
                  color: formatId === f.id ? '#DC440A' : '#8a8270',
                  fontFamily: 'inherit', fontSize: 10, fontWeight: formatId === f.id ? 700 : 400,
                  letterSpacing: 1, textTransform: 'uppercase',
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          {/* Image library */}
          <div>
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
              <span>Images {mode === 'batch' && images.length > 0 && <span style={{ color: '#DC440A' }}>({selectedIds.size} selected)</span>}</span>
              <button onClick={() => fileInputRef.current?.click()} style={S.link}>+ Add</button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e => { Array.from(e.target.files).forEach(addImage); e.target.value = ''; }} style={{ display: 'none' }} />
            {images.length === 0 ? (
              <label
                onDrop={e => { e.preventDefault(); setDragging(false); Array.from(e.dataTransfer.files).forEach(addImage); }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ display: 'block', padding: '18px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
              >
                <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8a8270' }}>{dragging ? 'Drop images here' : 'Upload or drag images'}</div>
              </label>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {images.map(img => {
                  const isActive = mode === 'single' ? activeImg?.id === img.id : selectedIds.has(img.id);
                  return (
                    <div key={img.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 4, overflow: 'hidden', border: `2px solid ${isActive ? '#DC440A' : '#e0d9c4'}`, cursor: 'pointer', flexShrink: 0 }}
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
                <div onClick={() => fileInputRef.current?.click()} style={{ width: 72, height: 72, borderRadius: 4, border: '1px dashed #c0b89a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8a8270', fontSize: 20, flexShrink: 0 }}>+</div>
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
                  <div style={{ fontSize: 9, color: '#8a8270', marginTop: 4 }}>
                    {selImgs.length} image{selImgs.length !== 1 ? 's' : ''} × {batchHookList.length} hook{batchHookList.length !== 1 ? 's' : ''} = <b style={{ color: '#333F4C' }}>{selImgs.length * batchHookList.length} ads</b>
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
                  <span style={{ color: '#e0d9c4' }}>·</span>
                  <button onClick={() => setSelectedIds(new Set())} style={{ ...S.link, fontSize: 9, color: '#b0a898' }}>None</button>
                </div>
              )}
            </>
          )}

          {StyleControls}
        </div>

        {/* Export pinned bottom */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #e0d9c4' }}>
          {exporting && exportMsg && (
            <div style={{ fontSize: 9, color: '#8a8270', marginBottom: 8, letterSpacing: 1 }}>Rendering {exportMsg}…</div>
          )}
          {mode === 'single' ? (
            <>
              <button onClick={() => handleExport()} disabled={!canSingleExport} style={S.exportBtn(!canSingleExport)}>
                {exporting ? 'Exporting…' : !activeImg ? 'Upload an image' : !overlayText.trim() ? 'Enter hook text' : `Export PNG (${fmt.label})`}
              </button>
              <button onClick={handleQueueForPublish} disabled={!canSingleExport || exporting} style={{ ...S.exportBtn(!canSingleExport || exporting), background: (!canSingleExport || exporting) ? undefined : '#6e40c9', marginTop: 6 }}>
                {exportMsg === 'Queued for publish!' ? 'Queued!' : 'Queue for Publish'}
              </button>
              {driveAuth?.connected && (
                <button onClick={() => handleExport({ toDrive: true })} disabled={!canSingleExport} style={{ ...S.exportBtn(!canSingleExport), background: !canSingleExport ? undefined : '#1a7f37', marginTop: 6 }}>
                  {exporting ? 'Saving…' : 'Save to Drive'}
                </button>
              )}
            </>
          ) : (
            <button onClick={handleBatchExport} disabled={!canBatchExport} style={S.exportBtn(!canBatchExport)}>
              {exporting ? `Rendering ${exportMsg}…`
                : !selImgs.length ? 'Select images'
                : !batchHookList.length ? 'Enter hooks above'
                : `Export ${selImgs.length * batchHookList.length} PNGs as ZIP`}
            </button>
          )}
        </div>
      </div>

      {/* Right: preview area */}
      <div style={{ flex: 1, minWidth: 0, background: '#1a1a1a', overflow: 'auto', display: 'flex', alignItems: mode === 'batch' ? 'flex-start' : 'center', justifyContent: mode === 'batch' ? 'flex-start' : 'center' }}>
        {mode === 'single' ? (
          activeImg ? (
            <div style={{ position: 'relative', width: displayW, height: displayH, flexShrink: 0 }}>
              <img ref={imgRef} src={activeImg.url} alt="" style={{ width: displayW, height: displayH, objectFit: 'cover', display: 'block' }} />
              {overlayText && (
                <div style={overlayStyle}>
                  <div>{overlayText.toUpperCase()}</div>
                  {bodyText && <div style={{ marginTop: '0.35em', fontSize: '0.52em', fontFamily: "'Libre Franklin', sans-serif", fontWeight: 700, opacity: 0.85, letterSpacing: '0.06em', lineHeight: 1.4 }}>{bodyText}</div>}
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
                <BatchCard key={i} img={img} hook={hook} body={bodyText} fmt={fmt} pos={pos} color={color} fontSize={fontSize} shadow={shadow} onExport={() => exportCard(img, hook)} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 6, fontWeight: 600, display: 'block' },
  link: { fontSize: 9, color: '#DC440A', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff', color: '#333F4C', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#e0d9c4' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#a09880' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
};
