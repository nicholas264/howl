import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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

const PRODUCT_NAMES = { r1: 'R1', r4mkii: 'R4 MkII', r4: 'R4' };

function detectProduct(filename) {
  const f = filename.toLowerCase();
  if (f.includes('r4')) return 'r4mkii';
  if (f.includes('r1')) return 'r1';
  return 'all';
}

function loadReviews() {
  try { return JSON.parse(localStorage.getItem(LS_REVIEWS) || '[]'); } catch { return []; }
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

async function renderOverlayPNG(text, videoW, videoH, opts) {
  await Promise.all([
    document.fonts.load(`800 ${opts.fontSize}px Montserrat`),
    document.fonts.load(`700 ${Math.round(opts.fontSize * 0.38)}px "Libre Franklin"`),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = videoW;
  canvas.height = videoH;
  const ctx = canvas.getContext('2d');

  const quoteFontSize   = opts.fontSize;
  const attribFontSize  = Math.round(opts.fontSize * 0.42);  // reviewer name
  const verifiedFontSize = Math.round(opts.fontSize * 0.34); // verified label
  const quoteLineH   = Math.round(quoteFontSize * 1.25);
  const attribLineH  = Math.round(attribFontSize * 1.4);
  const maxWidth = videoW * 0.82;
  const margin   = videoW * 0.09;
  const gap      = Math.round(opts.fontSize * 0.55); // space between quote and attribution

  // Measure quote lines
  ctx.font = `800 ${quoteFontSize}px Montserrat, sans-serif`;
  const quoteLines = wrapText(ctx, text, maxWidth);
  const quoteH = quoteLines.length * quoteLineH;

  // Measure attribution lines
  const hasAttrib = !!(opts.reviewerName || opts.verifiedLabel);
  let attribH = 0;
  if (hasAttrib) attribH = gap + attribLineH + (opts.verifiedLabel ? Math.round(verifiedFontSize * 1.4) : 0);

  const blockH = quoteH + attribH;

  // X alignment
  let x, align;
  if (opts.h === 'left')       { x = margin;          align = 'left'; }
  else if (opts.h === 'right') { x = videoW - margin; align = 'right'; }
  else                         { x = videoW / 2;      align = 'center'; }

  // Y start
  const vPad = videoH * 0.08;
  let y;
  if (opts.v === 'top')         y = vPad;
  else if (opts.v === 'bottom') y = videoH - vPad - blockH;
  else                          y = (videoH - blockH) / 2;

  // Shadow helper
  const applyShadow = () => {
    if (opts.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = Math.round(quoteFontSize * 0.4);
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }
  };
  const clearShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };

  ctx.textBaseline = 'top';
  ctx.textAlign = align;

  // Draw quote
  ctx.font = `800 ${quoteFontSize}px Montserrat, sans-serif`;
  ctx.fillStyle = opts.color;
  applyShadow();
  quoteLines.forEach((line, i) => ctx.fillText(line, x, y + i * quoteLineH));

  // Draw attribution block
  if (hasAttrib) {
    let ay = y + quoteH + gap;

    if (opts.reviewerName) {
      clearShadow();
      ctx.font = `700 ${attribFontSize}px "Libre Franklin", sans-serif`;
      ctx.fillStyle = opts.color;
      applyShadow();
      ctx.fillText(opts.reviewerName, x, ay);
      ay += attribLineH;
    }

    if (opts.verifiedLabel) {
      clearShadow();
      ctx.font = `700 ${verifiedFontSize}px "Libre Franklin", sans-serif`;
      ctx.fillStyle = opts.color === '#ffffff' ? 'rgba(255,255,255,0.75)' : opts.color === '#DC440A' ? 'rgba(220,68,10,0.75)' : 'rgba(51,63,76,0.65)';
      applyShadow();
      ctx.fillText(opts.verifiedLabel.toUpperCase(), x, ay);
    }
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export default function VideoAdTool() {
  const allReviews = loadReviews();
  const hasCSV = allReviews.length > 0;

  const [videoFile, setVideoFile]     = useState(null);
  const [videoUrl, setVideoUrl]       = useState(null);
  const [videoDims, setVideoDims]     = useState({ w: 1080, h: 1920 });
  const [productFilter, setProductFilter] = useState('all');
  const [selectedReview, setSelectedReview] = useState(null); // review object
  const [manualText, setManualText]   = useState('');         // fallback if no CSV
  const [fontSize, setFontSize]       = useState(72);
  const [colorId, setColorId]         = useState('white');
  const [positionId, setPositionId]   = useState('bc');
  const [shadow, setShadow]           = useState(true);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(true);
  const [ffmpegError, setFfmpegError] = useState('');
  const [exporting, setExporting]     = useState(false);
  const [exportMsg, setExportMsg]     = useState('');
  const [dragging, setDragging]       = useState(false);

  const ffmpegRef  = useRef(null);
  const videoRef   = useRef(null);
  const fileInputRef = useRef(null);

  // Load FFmpeg on mount
  useEffect(() => {
    (async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        setFfmpegError('SharedArrayBuffer unavailable — required security headers may be missing. Try a hard refresh or contact support.');
        setFfmpegLoading(false);
        return;
      }
      try {
        const ff = new FFmpeg();
        await ff.load({
          coreURL: '/ffmpeg/ffmpeg-core.js',
          wasmURL: '/ffmpeg/ffmpeg-core.wasm',
        });
        ffmpegRef.current = ff;
        setFfmpegReady(true);
      } catch (e) {
        console.error('FFmpeg load failed', e);
        setFfmpegError(`FFmpeg failed to load: ${e?.message || e}. Try refreshing.`);
      } finally {
        setFfmpegLoading(false);
      }
    })();
  }, []);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('video/')) { alert('Please upload a video file.'); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoFile(file);
    // Auto-detect product from filename
    const detected = detectProduct(file.name);
    setProductFilter(detected);
    // Auto-select first matching review
    const matches = allReviews.filter(r =>
      (detected === 'all' || r.handle === detected) && r.rating >= 4
    );
    setSelectedReview(matches[0] || null);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleVideoMeta = () => {
    if (videoRef.current)
      setVideoDims({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
  };

  // Filtered review list
  const filteredReviews = allReviews.filter(r =>
    r.rating >= 4 &&
    (productFilter === 'all' || r.handle === productFilter)
  );

  // The text that goes on the video
  const overlayText = hasCSV
    ? (selectedReview?.quote || '')
    : manualText;

  const products = [...new Set(allReviews.map(r => r.handle).filter(Boolean))].sort();

  const handleExport = useCallback(async () => {
    if (!videoFile || !overlayText.trim() || !ffmpegRef.current) return;
    setExporting(true);
    setExportMsg('Rendering text overlay…');
    try {
      const pos   = POSITIONS.find(p => p.id === positionId);
      const color = TEXT_COLORS.find(c => c.id === colorId).value;

      const overlayBlob = await renderOverlayPNG(overlayText, videoDims.w, videoDims.h, {
        fontSize, color, v: pos.v, h: pos.h, shadow,
        reviewerName: selectedReview?.nickname || null,
        verifiedLabel: selectedReview ? `Verified HOWL ${PRODUCT_NAMES[selectedReview.handle] || 'HOWL'} Customer` : null,
      });
      const overlayArr = new Uint8Array(await overlayBlob.arrayBuffer());

      setExportMsg('Writing files…');
      const ff = ffmpegRef.current;
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const inputName = `input.${ext}`;
      await ff.writeFile(inputName, await fetchFile(videoFile));
      await ff.writeFile('overlay.png', overlayArr);

      setExportMsg('Processing video…');
      await ff.exec([
        '-i', inputName,
        '-i', 'overlay.png',
        '-filter_complex', '[0:v][1:v]overlay=0:0',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'copy', '-movflags', '+faststart',
        '-y', 'output.mp4',
      ]);

      setExportMsg('Preparing download…');
      const data = await ff.readFile('output.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const a = document.createElement('a');
      const slug = selectedReview?.handle || 'howl';
      a.href = URL.createObjectURL(blob);
      a.download = `howl_${slug}_video_${Date.now()}.mp4`;
      a.click();

      await ff.deleteFile(inputName);
      await ff.deleteFile('overlay.png');
      await ff.deleteFile('output.mp4');
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed. Check console for details.');
    } finally {
      setExporting(false); setExportMsg('');
    }
  }, [videoFile, overlayText, fontSize, colorId, positionId, shadow, videoDims, selectedReview]);

  const pos   = POSITIONS.find(p => p.id === positionId);
  const color = TEXT_COLORS.find(c => c.id === colorId).value;
  const canExport = ffmpegReady && !!videoFile && !!overlayText.trim() && !exporting;

  // Live preview overlay
  const previewScale = 0.22; // rough scale for CSS overlay font
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
    maxWidth: '82%',
    color,
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 800,
    fontSize: `${fontSize * previewScale}px`,
    lineHeight: 1.25,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9)' : 'none',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>

      {/* ── Left panel ── */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {ffmpegLoading && (
          <div style={{ padding: '8px 20px', background: '#fef8f0', borderBottom: '1px solid #e0d9c4', fontSize: 9, color: '#DC440A', letterSpacing: 1, textTransform: 'uppercase' }}>
            Loading FFmpeg…
          </div>
        )}
        {ffmpegError && (
          <div style={{ padding: '10px 20px', background: '#fff0ee', borderBottom: '1px solid #f5c0b0', fontSize: 10, color: '#b03010', lineHeight: 1.5 }}>
            {ffmpegError}
          </div>
        )}

        {/* Scrollable controls */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Video upload */}
          <div>
            <div style={S.label}>Video</div>
            {videoFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff' }}>
                <span style={{ fontSize: 10, color: '#333F4C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{videoFile.name}</span>
                <button onClick={() => fileInputRef.current?.click()} style={S.link}>Replace</button>
              </div>
            ) : (
              <label
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ display: 'block', padding: '18px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
              >
                <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8a8270' }}>
                  {dragging ? 'Drop video here' : 'Upload MP4 / MOV / WebM'}
                </div>
                <div style={{ fontSize: 9, color: '#b0a898', marginTop: 4 }}>Product name in filename auto-selects reviews</div>
              </label>
            )}
            <input ref={fileInputRef} type="file" accept="video/*" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
          </div>

          {/* Review picker (CSV mode) */}
          {hasCSV ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Product filter */}
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

              {/* Review list */}
              <div>
                <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Review</span>
                  <span style={{ color: '#b0a898', fontWeight: 400 }}>{filteredReviews.length} available</span>
                </div>
                <div style={{ border: '1px solid #e0d9c4', borderRadius: 4, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                  {filteredReviews.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 10, color: '#8a8270' }}>No reviews for this product.</div>
                  ) : filteredReviews.map(r => {
                    const isActive = selectedReview?.id === r.id;
                    return (
                      <div key={r.id} onClick={() => setSelectedReview(r)} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #e0d9c4', background: isActive ? '#fef8f0' : '#fff', borderLeft: isActive ? `3px solid ${COLORS.flame}` : '3px solid transparent' }}>
                        <div style={{ fontSize: 9, color: COLORS.flame, marginBottom: 2 }}>{'★'.repeat(r.rating)} · {PRODUCT_NAMES[r.handle] || r.handle}</div>
                        <div style={{ fontSize: 10, color: '#333F4C', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{r.quote}</div>
                        <div style={{ fontSize: 9, color: '#8a8270', marginTop: 3 }}>{r.nickname}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Manual text fallback */
            <div>
              <div style={S.label}>
                Text
                <span style={{ color: '#b0a898', fontWeight: 400, marginLeft: 6 }}>— or upload CSV in Review Ads for review picker</span>
              </div>
              <textarea value={manualText} onChange={e => setManualText(e.target.value)} placeholder="Enter text to overlay…" rows={4} style={S.textarea} />
            </div>
          )}

          {/* Font size */}
          <div>
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
              <span>Font Size</span><span style={{ color: '#333F4C' }}>{fontSize}px</span>
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
                  border: `2px solid ${colorId === c.id ? c.value : '#e0d9c4'}`,
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
                  padding: '8px 0', border: `1px solid ${positionId === p.id ? '#DC440A' : '#e0d9c4'}`,
                  background: positionId === p.id ? '#fef8f0' : '#fff',
                  color: positionId === p.id ? '#DC440A' : '#8a8270',
                  fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', borderRadius: 4,
                }}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* Shadow */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={S.label}>Text Shadow</div>
            <button onClick={() => setShadow(s => !s)} style={{
              padding: '4px 12px', borderRadius: 20, border: `1px solid ${shadow ? '#DC440A' : '#e0d9c4'}`,
              background: shadow ? '#DC440A' : '#fff', color: shadow ? '#fff' : '#8a8270',
              fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
            }}>{shadow ? 'On' : 'Off'}</button>
          </div>
        </div>

        {/* Export — pinned to bottom */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #e0d9c4' }}>
          <button onClick={handleExport} disabled={!canExport} style={S.exportBtn(!canExport)}>
            {exporting ? exportMsg || 'Processing…'
              : ffmpegError ? 'FFmpeg unavailable'
              : ffmpegLoading ? 'Loading FFmpeg…'
              : !videoFile ? 'Upload a video'
              : !overlayText.trim() ? 'Select a review'
              : 'Export MP4'}
          </button>
        </div>
      </div>

      {/* ── Right: video preview ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', overflow: 'hidden' }}>
        {videoUrl ? (
          <div style={{ position: 'relative', maxHeight: '100%', maxWidth: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video ref={videoRef} src={videoUrl} onLoadedMetadata={handleVideoMeta} controls loop style={{ maxHeight: 'calc(100vh - 130px)', maxWidth: '100%', display: 'block' }} />
            {overlayText && (
              <div style={overlayStyle}>
                <div>{overlayText.toUpperCase()}</div>
                {selectedReview && (
                  <div style={{ marginTop: '0.5em' }}>
                    <div style={{ fontSize: '0.52em', opacity: 1 }}>{selectedReview.nickname}</div>
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
            {hasCSV && <><br /><span style={{ color: '#444', fontSize: 10 }}>Include "r1" or "r4" in the filename<br />to auto-filter reviews</span></>}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 6, fontWeight: 600, display: 'block' },
  link: { fontSize: 9, color: '#DC440A', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff', color: '#333F4C', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  filterBtn: (active) => ({ padding: '3px 10px', border: `1px solid ${active ? '#DC440A' : '#e0d9c4'}`, background: active ? '#fef8f0' : '#fff', color: active ? '#DC440A' : '#8a8270', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer', borderRadius: 3 }),
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#e0d9c4' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#a09880' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
};
