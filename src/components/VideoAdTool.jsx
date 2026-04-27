import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { COLORS } from '../brand';

const LS_REVIEWS = 'howl_review_ads_reviews';

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

const PRODUCT_NAMES = { r1: 'R1', r4mkii: 'R4 MkII' };
const VALID_HANDLES = new Set(['r1', 'r4mkii']);

function detectProduct(filename) {
  const f = filename.toLowerCase();
  if (f.includes('r4')) return 'r4mkii';
  if (f.includes('r1')) return 'r1';
  return 'all';
}

function loadReviews() {
  try {
    return JSON.parse(localStorage.getItem(LS_REVIEWS) || '[]').filter(r => VALID_HANDLES.has(r.handle));
  } catch { return []; }
}

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

// Render text + attribution to a canvas (returned for reuse across frames)
async function buildOverlayCanvas(text, videoW, videoH, opts) {
  await Promise.all([
    document.fonts.load(`800 ${opts.fontSize}px Montserrat`),
    document.fonts.load(`700 ${Math.round(opts.fontSize * 0.42)}px "Libre Franklin"`),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = videoW;
  canvas.height = videoH;
  const ctx = canvas.getContext('2d');

  const quoteSz   = opts.fontSize;
  const attribSz  = Math.round(quoteSz * 0.42);
  const verifySz  = Math.round(quoteSz * 0.34);
  const quoteLineH  = Math.round(quoteSz * 1.25);
  const attribLineH = Math.round(attribSz * 1.4);
  const maxWidth = videoW * 0.82;
  const margin   = videoW * 0.09;
  const gap      = Math.round(quoteSz * 0.55);

  ctx.font = `800 ${quoteSz}px Montserrat, sans-serif`;
  ctx.textBaseline = 'top';
  const quoteLines = wrapText(ctx, text, maxWidth);
  const quoteH = quoteLines.length * quoteLineH;

  const hasAttrib = !!(opts.reviewerName || opts.verifiedLabel);
  const attribH = hasAttrib
    ? gap + (opts.reviewerName ? attribLineH : 0) + (opts.verifiedLabel ? Math.round(verifySz * 1.4) : 0)
    : 0;
  const blockH = quoteH + attribH;

  let x, align;
  if (opts.h === 'left')       { x = margin;          align = 'left'; }
  else if (opts.h === 'right') { x = videoW - margin; align = 'right'; }
  else                         { x = videoW / 2;      align = 'center'; }

  const vPad = videoH * 0.08;
  let y;
  if (opts.v === 'top')         y = vPad;
  else if (opts.v === 'bottom') y = videoH - vPad - blockH;
  else                          y = (videoH - blockH) / 2;

  const setShadow = () => {
    if (opts.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = Math.round(quoteSz * 0.4);
      ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    }
  };
  const clrShadow = () => {
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  };

  ctx.textAlign = align;

  // Quote
  ctx.font = `800 ${quoteSz}px Montserrat, sans-serif`;
  ctx.fillStyle = opts.color;
  setShadow();
  quoteLines.forEach((line, i) => ctx.fillText(line, x, y + i * quoteLineH));

  // Attribution
  if (hasAttrib) {
    let ay = y + quoteH + gap;
    if (opts.reviewerName) {
      clrShadow();
      ctx.font = `700 ${attribSz}px "Libre Franklin", sans-serif`;
      ctx.fillStyle = opts.color;
      setShadow();
      ctx.fillText(opts.reviewerName, x, ay);
      ay += attribLineH;
    }
    if (opts.verifiedLabel) {
      clrShadow();
      ctx.font = `700 ${verifySz}px "Libre Franklin", sans-serif`;
      ctx.fillStyle = opts.color === '#ffffff' ? 'rgba(255,255,255,0.72)'
        : opts.color === COLORS.flame ? 'rgba(220,68,10,0.72)'
        : 'rgba(51,63,76,0.65)';
      setShadow();
      ctx.fillText(opts.verifiedLabel.toUpperCase(), x, ay);
    }
  }

  return canvas;
}

export default function VideoAdTool({ initialText, onTextConsumed, onAddToCart }) {
  const allReviews = loadReviews();
  const hasCSV = allReviews.length > 0;
  const supported = typeof VideoEncoder !== 'undefined';

  const [videoFile, setVideoFile]         = useState(null);
  const [videoUrl, setVideoUrl]           = useState(null);
  const [videoDims, setVideoDims]         = useState({ w: 1080, h: 1920 });
  const [productFilter, setProductFilter] = useState('all');
  const [selectedReview, setSelectedReview] = useState(null);
  const [manualText, setManualText]       = useState(initialText || '');
  const [fontSize, setFontSize]           = useState(72);
  const [colorId, setColorId]             = useState('white');
  const [positionId, setPositionId]       = useState('bc');
  const [shadow, setShadow]               = useState(true);
  const [exporting, setExporting]         = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMsg, setExportMsg]         = useState('');
  const [addingToCart, setAddingToCart]   = useState(false);
  const [dragging, setDragging]           = useState(false);

  const videoRef    = useRef(null);
  const fileInputRef = useRef(null);

  useLayoutEffect(() => {
    if (initialText) {
      setManualText(initialText);
      setSelectedReview(null);
      onTextConsumed?.();
    }
  }, [initialText]);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('video/')) { alert('Please upload a video file.'); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoFile(file);
    const detected = detectProduct(file.name);
    setProductFilter(detected);
    const first = allReviews.find(r => r.rating >= 4 && (detected === 'all' || r.handle === detected));
    setSelectedReview(first || null);
  };

  const handleDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); };
  const handleVideoMeta = () => {
    if (videoRef.current) setVideoDims({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
  };

  const filteredReviews = allReviews.filter(r =>
    r.rating >= 4 && (productFilter === 'all' || r.handle === productFilter)
  );

  const overlayText = hasCSV ? (selectedReview?.quote || '') : manualText;
  const products = [...new Set(allReviews.map(r => r.handle).filter(Boolean))].sort();

  const handleAddToCart = useCallback(async () => {
    if (!videoFile || !overlayText.trim() || !onAddToCart) return;
    setAddingToCart(true);
    setExportProgress(0);
    setExportMsg('Rendering for cart…');
    try {
      const posObj  = POSITIONS.find(p => p.id === positionId);
      const colorVal = TEXT_COLORS.find(c => c.id === colorId).value;
      const { w, h } = videoDims;

      const overlayCanvas = await buildOverlayCanvas(`\u201c${overlayText}\u201d`, w, h, {
        fontSize, color: colorVal, v: posObj.v, h: posObj.h, shadow,
        reviewerName: selectedReview?.nickname || null,
        verifiedLabel: selectedReview ? `Verified HOWL ${PRODUCT_NAMES[selectedReview.handle] || 'HOWL'} Customer` : null,
      });

      const vid = document.createElement('video');
      vid.src = videoUrl;
      vid.muted = true;
      await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = rej; vid.load(); });

      const fps = 30;
      const frameCount = Math.ceil(vid.duration * fps);

      // H.264 requires even dimensions
      const ew = w - (w % 2);
      const eh = h - (h % 2);

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: ew, height: eh },
        fastStart: 'in-memory',
      });
      let encoderError = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { encoderError = e; console.error('VideoEncoder error', e); },
      });
      encoder.configure({ codec: 'avc1.42001f', width: ew, height: eh, bitrate: 2_000_000, framerate: fps });

      const canvas = document.createElement('canvas');
      canvas.width = ew; canvas.height = eh;
      const ctx = canvas.getContext('2d');

      setExportMsg('Encoding…');
      for (let i = 0; i < frameCount; i++) {
        if (encoderError) throw encoderError;
        if (encoder.state !== 'configured') throw new Error(`Encoder closed unexpectedly (${encoder.state})`);
        vid.currentTime = i / fps;
        await new Promise(res => vid.addEventListener('seeked', res, { once: true }));
        ctx.drawImage(vid, 0, 0, ew, eh);
        ctx.drawImage(overlayCanvas, 0, 0, ew, eh);
        // Backpressure: don't queue more than 30 frames ahead
        while (encoder.encodeQueueSize > 30) await new Promise(r => setTimeout(r, 10));
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1_000_000), duration: Math.round(1_000_000 / fps) });
        encoder.encode(frame, { keyFrame: i % 60 === 0 });
        frame.close();
        setExportProgress(Math.round((i / frameCount) * 100));
      }
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();

      // Convert ArrayBuffer → base64 data URL
      const bytes = new Uint8Array(muxer.target.buffer);
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const videoDataUrl = `data:video/mp4;base64,${btoa(binary)}`;

      const sizeMB = (muxer.target.buffer.byteLength / (1024 * 1024)).toFixed(1);
      if (parseFloat(sizeMB) > 6) {
        alert(`Video is ${sizeMB}MB — try a shorter clip if upload fails.`);
      }

      const monthDay = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      await onAddToCart({
        id: Date.now(),
        type: 'video',
        videoUrl: videoDataUrl,
        name: `HOWL | Video | ${overlayText.slice(0, 30).trim()} | ${monthDay}`,
        hook: overlayText,
        body: '',
      });
      setExportMsg('Added to cart!');
      setTimeout(() => setExportMsg(''), 2000);
    } catch (err) {
      console.error('Cart add failed', err);
      alert(`Failed to add to cart: ${err?.message || err}`);
    } finally {
      setAddingToCart(false);
      setExportProgress(0);
    }
  }, [videoFile, videoUrl, overlayText, fontSize, colorId, positionId, shadow, videoDims, selectedReview, onAddToCart]);

  const handleExport = useCallback(async () => {
    if (!videoFile || !overlayText.trim()) return;
    setExporting(true);
    setExportProgress(0);
    setExportMsg('Rendering text overlay…');

    try {
      const pos   = POSITIONS.find(p => p.id === positionId);
      const color = TEXT_COLORS.find(c => c.id === colorId).value;
      const { w, h } = videoDims;

      // 1. Build overlay canvas once
      const overlayCanvas = await buildOverlayCanvas(`\u201c${overlayText}\u201d`, w, h, {
        fontSize, color, v: pos.v, h: pos.h, shadow,
        reviewerName: selectedReview?.nickname || null,
        verifiedLabel: selectedReview
          ? `Verified HOWL ${PRODUCT_NAMES[selectedReview.handle] || 'HOWL'} Customer`
          : null,
      });

      // 2. Load video into a fresh element for frame seeking
      setExportMsg('Loading video…');
      const vid = document.createElement('video');
      vid.src = videoUrl;
      vid.muted = true;
      await new Promise((res, rej) => {
        vid.onloadedmetadata = res;
        vid.onerror = rej;
        vid.load();
      });
      const duration = vid.duration;
      const fps = 30;
      const frameCount = Math.ceil(duration * fps);

      // 3. Set up muxer + encoder. H.264 requires even dimensions.
      setExportMsg('Setting up encoder…');
      const ew = w - (w % 2);
      const eh = h - (h % 2);
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: ew, height: eh },
        fastStart: 'in-memory',
      });

      let encoderError = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { encoderError = e; console.error('VideoEncoder error', e); },
      });
      encoder.configure({
        codec: 'avc1.42001f',
        width: ew, height: eh,
        bitrate: 8_000_000,
        framerate: fps,
      });

      // 4. Frame canvas
      const canvas = document.createElement('canvas');
      canvas.width = ew; canvas.height = eh;
      const ctx = canvas.getContext('2d');

      // 5. Seek and encode every frame
      setExportMsg('Encoding…');
      for (let i = 0; i < frameCount; i++) {
        if (encoderError) throw encoderError;
        if (encoder.state !== 'configured') throw new Error(`Encoder closed unexpectedly (${encoder.state})`);
        vid.currentTime = i / fps;
        await new Promise(res => vid.addEventListener('seeked', res, { once: true }));

        ctx.drawImage(vid, 0, 0, ew, eh);
        ctx.drawImage(overlayCanvas, 0, 0, ew, eh);

        while (encoder.encodeQueueSize > 30) await new Promise(r => setTimeout(r, 10));

        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i / fps) * 1_000_000),
          duration:  Math.round(1_000_000 / fps),
        });
        try {
          if (encoder.state !== 'configured') { frame.close(); throw encoderError || new Error(`Encoder closed at frame ${i} (${encoder.state})`); }
          encoder.encode(frame, { keyFrame: i % 60 === 0 });
        } catch (e) { frame.close(); throw encoderError || e; }
        frame.close();

        setExportProgress(Math.round((i / frameCount) * 100));
      }

      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();

      // 6. Download
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      const a = document.createElement('a');
      const slug = selectedReview?.handle || 'howl';
      a.href = URL.createObjectURL(blob);
      a.download = `howl_${slug}_video_${Date.now()}.mp4`;
      a.click();
    } catch (err) {
      console.error('Export failed', err);
      alert(`Export failed: ${err?.message || err}`);
    } finally {
      setExporting(false);
      setExportProgress(0);
      setExportMsg('');
    }
  }, [videoFile, videoUrl, overlayText, fontSize, colorId, positionId, shadow, videoDims, selectedReview]);

  const pos   = POSITIONS.find(p => p.id === positionId);
  const color = TEXT_COLORS.find(c => c.id === colorId).value;
  const canExport = supported && !!videoFile && !!overlayText.trim() && !exporting;

  // Compute exact preview dimensions so overlay scale matches export
  const availH = typeof window !== 'undefined' ? window.innerHeight - 130 : 800;
  const availW = typeof window !== 'undefined' ? window.innerWidth - 320 : 700;
  const previewScale = videoDims.w > 0
    ? Math.min(availH / videoDims.h, availW / videoDims.w, 1)
    : 0.4;
  const displayW = Math.round(videoDims.w * previewScale);
  const displayH = Math.round(videoDims.h * previewScale);
  const previewFontSize = fontSize * previewScale;

  const overlayStyle = {
    position: 'absolute', pointerEvents: 'none',
    left: pos.h === 'left' ? '9%' : pos.h === 'right' ? 'auto' : '50%',
    right: pos.h === 'right' ? '9%' : 'auto',
    top: pos.v === 'top' ? '8%' : pos.v === 'middle' ? '50%' : 'auto',
    bottom: pos.v === 'bottom' ? '8%' : 'auto',
    transform: [
      pos.h === 'center' ? 'translateX(-50%)' : '',
      pos.v === 'middle' ? 'translateY(-50%)' : '',
    ].filter(Boolean).join(' ') || 'none',
    textAlign: pos.h === 'center' ? 'center' : pos.h,
    maxWidth: '82%', color,
    fontFamily: "'Montserrat', sans-serif", fontWeight: 800,
    fontSize: `${previewFontSize}px`, lineHeight: 1.25,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8)' : 'none',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid #2a3441', flexShrink: 0 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Create</div>
        <div className="display-md" style={{ color: '#f0f4f8' }}>Video Ads</div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

      {/* Left panel */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #2a3441', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {!supported && (
          <div style={{ padding: '10px 20px', background: '#fff0ee', borderBottom: '1px solid #f5c0b0', fontSize: 10, color: '#b03010' }}>
            VideoEncoder not supported. Use Chrome 94+ for export.
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Upload */}
          <div>
            <div style={S.label}>Video</div>
            {videoFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #2a3441', borderRadius: 4, background: '#1c2330' }}>
                <span style={{ fontSize: 10, color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{videoFile.name}</span>
                <button onClick={() => fileInputRef.current?.click()} style={S.link}>Replace</button>
              </div>
            ) : (
              <label
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ display: 'block', padding: '18px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#374151'}`, background: dragging ? 'rgba(220,68,10,0.15)' : 'transparent' }}
              >
                <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8b949e' }}>
                  {dragging ? 'Drop video here' : 'Upload MP4 / MOV / WebM'}
                </div>
                <div style={{ fontSize: 9, color: '#b0a898', marginTop: 4 }}>Include "r1" or "r4" in filename to auto-filter reviews</div>
              </label>
            )}
            <input ref={fileInputRef} type="file" accept="video/*" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
          </div>

          {/* Review picker */}
          {hasCSV ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {products.length > 1 && (
                <div>
                  <div style={S.label}>Product</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {['all', ...products].map(p => (
                      <button key={p} onClick={() => {
                        setProductFilter(p);
                        const first = allReviews.find(r => r.rating >= 4 && (p === 'all' || r.handle === p));
                        setSelectedReview(first || null);
                      }} style={{ ...S.filterBtn(productFilter === p), textTransform: 'uppercase', letterSpacing: 1 }}>
                        {p === 'all' ? 'All' : (PRODUCT_NAMES[p] || p)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Review</span>
                  <span style={{ color: '#b0a898', fontWeight: 400 }}>{filteredReviews.length} available</span>
                </div>
                <div style={{ border: '1px solid #2a3441', borderRadius: 4, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                  {filteredReviews.length === 0
                    ? <div style={{ padding: 16, fontSize: 10, color: '#8b949e' }}>No reviews for this product.</div>
                    : filteredReviews.map(r => {
                      const active = selectedReview?.id === r.id;
                      return (
                        <div key={r.id} onClick={() => setSelectedReview(r)} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #2a3441', background: active ? 'rgba(220,68,10,0.15)' : '#1c2330', borderLeft: `3px solid ${active ? COLORS.flame : 'transparent'}` }}>
                          <div style={{ fontSize: 9, color: COLORS.flame, marginBottom: 2 }}>{'★'.repeat(r.rating)} · {PRODUCT_NAMES[r.handle] || r.handle}</div>
                          <div style={{ fontSize: 10, color: '#f0f4f8', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.quote}</div>
                          <div style={{ fontSize: 9, color: '#8b949e', marginTop: 3 }}>{r.nickname}</div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={S.label}>Text <span style={{ color: '#b0a898', fontWeight: 400 }}>— upload CSV in Review Ads for review picker</span></div>
              <textarea value={manualText} onChange={e => setManualText(e.target.value)} placeholder="Enter text to overlay…" rows={4} style={S.textarea} />
            </div>
          )}

          {/* Font size */}
          <div>
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
              <span>Font Size</span><span style={{ color: '#f0f4f8' }}>{fontSize}px</span>
            </div>
            <input type="range" min={32} max={160} step={4} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width: '100%', accentColor: '#DC440A' }} />
          </div>

          {/* Color */}
          <div>
            <div style={S.label}>Text Color</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {TEXT_COLORS.map(c => (
                <button key={c.id} onClick={() => setColorId(c.id)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 4, cursor: 'pointer',
                  border: `2px solid ${colorId === c.id ? c.value : '#2a3441'}`,
                  background: c.value === '#ffffff' ? '#f5f5f5' : c.value,
                  color: c.value === '#ffffff' ? '#333' : '#fff',
                  fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                  fontWeight: colorId === c.id ? 700 : 400,
                }}>{c.label}</button>
              ))}
            </div>
          </div>

          {/* Position */}
          <div>
            <div style={S.label}>Position</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {POSITIONS.map(p => (
                <button key={p.id} onClick={() => setPositionId(p.id)} style={{
                  padding: '8px 0', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${positionId === p.id ? '#DC440A' : '#2a3441'}`,
                  background: positionId === p.id ? 'rgba(220,68,10,0.15)' : '#1c2330',
                  color: positionId === p.id ? '#DC440A' : '#8b949e',
                  fontFamily: 'inherit', fontSize: 14,
                }}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* Shadow */}
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
        </div>

        {/* Export — pinned bottom */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #2a3441' }}>
          {exporting && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ height: 3, background: '#2a3441', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${exportProgress}%`, background: '#DC440A', transition: 'width 0.2s' }} />
              </div>
              <div style={{ fontSize: 9, color: '#8b949e', marginTop: 4, letterSpacing: 1 }}>
                {exportMsg} {exportProgress > 0 && `${exportProgress}%`}
              </div>
            </div>
          )}
          <button onClick={handleExport} disabled={!canExport} style={S.exportBtn(!canExport)}>
            {exporting ? 'Encoding…'
              : !videoFile ? 'Upload a video'
              : !overlayText.trim() ? 'Select a review'
              : 'Export MP4'}
          </button>
          {onAddToCart && (
            <button
              onClick={handleAddToCart}
              disabled={!canExport || addingToCart}
              style={{ ...S.exportBtn(!canExport || addingToCart), background: (!canExport || addingToCart) ? undefined : '#6e40c9', marginTop: 6 }}
            >
              {addingToCart ? `Encoding… ${exportProgress > 0 ? exportProgress + '%' : ''}` : exportMsg === 'Added to cart!' ? 'Added to Cart!' : 'Add to Cart'}
            </button>
          )}
        </div>
      </div>

      {/* Right: preview */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', overflow: 'hidden' }}>
        {videoUrl ? (
          <div style={{ position: 'relative', width: displayW, height: displayH, flexShrink: 0 }}>
            <video ref={videoRef} src={videoUrl} onLoadedMetadata={handleVideoMeta} controls loop style={{ width: displayW, height: displayH, display: 'block' }} />
            {overlayText && (
              <div style={overlayStyle}>
                <div>{'\u201c'}{overlayText.toUpperCase()}{'\u201d'}</div>
                {selectedReview && (
                  <div style={{ marginTop: '0.45em' }}>
                    <div style={{ fontSize: '0.52em' }}>{selectedReview.nickname}</div>
                    <div style={{ fontSize: '0.42em', opacity: 0.75, letterSpacing: '0.12em' }}>
                      VERIFIED HOWL {(PRODUCT_NAMES[selectedReview.handle] || 'HOWL').toUpperCase()} CUSTOMER
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40, lineHeight: 1.8 }}>
            Upload a video to preview
            {hasCSV && <><br /><span style={{ color: '#6e7681', fontSize: 10 }}>Include "r1" or "r4" in filename to auto-filter reviews</span></>}
          </div>
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
  filterBtn: (active) => ({ padding: '3px 10px', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`, background: active ? 'rgba(220,68,10,0.15)' : '#1c2330', color: active ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer', borderRadius: 3 }),
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#2a3441' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
};
