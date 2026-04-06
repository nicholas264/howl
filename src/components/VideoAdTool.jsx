import { useState, useRef, useCallback, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { COLORS } from '../brand';

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

// Render text onto a transparent canvas, return PNG blob
async function renderOverlayPNG(text, videoW, videoH, opts) {
  await document.fonts.load(`800 ${opts.fontSize}px Montserrat`);

  const canvas = document.createElement('canvas');
  canvas.width = videoW;
  canvas.height = videoH;
  const ctx = canvas.getContext('2d');

  const fontSize = opts.fontSize;
  const lineHeight = Math.round(fontSize * 1.25);
  const maxWidth = videoW * 0.82;
  const margin = videoW * 0.09;

  ctx.font = `800 ${fontSize}px Montserrat, sans-serif`;
  ctx.textBaseline = 'top';

  // Word-wrap
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const blockH = lines.length * lineHeight;

  // Horizontal origin
  let x;
  if (opts.h === 'left')   { x = margin; ctx.textAlign = 'left'; }
  else if (opts.h === 'right') { x = videoW - margin; ctx.textAlign = 'right'; }
  else                     { x = videoW / 2;     ctx.textAlign = 'center'; }

  // Vertical origin
  const vPad = videoH * 0.08;
  let y;
  if (opts.v === 'top')    y = vPad;
  else if (opts.v === 'bottom') y = videoH - vPad - blockH;
  else                     y = (videoH - blockH) / 2;

  // Shadow / backdrop
  if (opts.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = Math.round(fontSize * 0.4);
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  ctx.fillStyle = opts.color;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export default function VideoAdTool() {
  const [videoFile, setVideoFile]   = useState(null);
  const [videoUrl, setVideoUrl]     = useState(null);
  const [videoDims, setVideoDims]   = useState({ w: 1080, h: 1920 });
  const [text, setText]             = useState('');
  const [fontSize, setFontSize]     = useState(72);
  const [colorId, setColorId]       = useState('white');
  const [positionId, setPositionId] = useState('bc');
  const [shadow, setShadow]         = useState(true);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [exporting, setExporting]   = useState(false);
  const [exportMsg, setExportMsg]   = useState('');
  const [dragging, setDragging]     = useState(false);

  const ffmpegRef  = useRef(null);
  const videoRef   = useRef(null);
  const fileInputRef = useRef(null);

  // Load FFmpeg once on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadingMsg('Loading FFmpeg…');
      try {
        const ff = new FFmpeg();
        ff.on('log', ({ message }) => console.log('[ffmpeg]', message));
        ff.on('progress', ({ progress }) => {
          if (exporting) setExportMsg(`Processing… ${Math.round(progress * 100)}%`);
        });
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        await ff.load({
          coreURL:  await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),
          wasmURL:  await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpegRef.current = ff;
        setFfmpegReady(true);
      } catch (e) {
        console.error('FFmpeg load failed', e);
        setLoadingMsg('Failed to load FFmpeg. Refresh and try again.');
        return;
      }
      setLoading(false);
      setLoadingMsg('');
    })();
  }, []);

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('video/')) {
      alert('Please upload a video file (MP4, MOV, WebM).');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  // Capture video native dimensions once metadata loads
  const handleVideoMeta = () => {
    if (videoRef.current) {
      setVideoDims({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
    }
  };

  const handleExport = useCallback(async () => {
    if (!videoFile || !text.trim() || !ffmpegRef.current) return;
    setExporting(true);
    setExportMsg('Rendering text overlay…');
    try {
      const pos = POSITIONS.find(p => p.id === positionId);
      const color = TEXT_COLORS.find(c => c.id === colorId).value;

      // 1. Render text to PNG
      const overlayBlob = await renderOverlayPNG(text, videoDims.w, videoDims.h, {
        fontSize, color, v: pos.v, h: pos.h, shadow,
      });
      const overlayArr = new Uint8Array(await overlayBlob.arrayBuffer());

      // 2. Write files to FFmpeg FS
      setExportMsg('Writing files…');
      const ff = ffmpegRef.current;
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const inputName = `input.${ext}`;
      await ff.writeFile(inputName, await fetchFile(videoFile));
      await ff.writeFile('overlay.png', overlayArr);

      // 3. Run FFmpeg — overlay PNG on video
      setExportMsg('Processing video…');
      await ff.exec([
        '-i', inputName,
        '-i', 'overlay.png',
        '-filter_complex', '[0:v][1:v]overlay=0:0',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y', 'output.mp4',
      ]);

      // 4. Download
      setExportMsg('Preparing download…');
      const data = await ff.readFile('output.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `howl_video_${Date.now()}.mp4`;
      a.click();

      // Cleanup FS
      await ff.deleteFile(inputName);
      await ff.deleteFile('overlay.png');
      await ff.deleteFile('output.mp4');
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed. Check console for details.');
    } finally {
      setExporting(false);
      setExportMsg('');
    }
  }, [videoFile, text, fontSize, colorId, positionId, shadow, videoDims]);

  const pos = POSITIONS.find(p => p.id === positionId);
  const color = TEXT_COLORS.find(c => c.id === colorId).value;
  const canExport = ffmpegReady && !!videoFile && !!text.trim() && !exporting;

  // CSS preview overlay positioning
  const overlayStyle = {
    position: 'absolute',
    left: pos.h === 'left' ? '9%' : pos.h === 'right' ? 'auto' : '50%',
    right: pos.h === 'right' ? '9%' : 'auto',
    top: pos.v === 'top' ? '8%' : pos.v === 'middle' ? '50%' : 'auto',
    bottom: pos.v === 'bottom' ? '8%' : 'auto',
    transform: [
      pos.h === 'center' ? 'translateX(-50%)' : '',
      pos.v === 'middle' ? 'translateY(-50%)' : '',
    ].filter(Boolean).join(' ') || 'none',
    textAlign: pos.h === 'left' ? 'left' : pos.h === 'right' ? 'right' : 'center',
    maxWidth: '82%',
    color,
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 800,
    fontSize: `${fontSize * 0.22}px`, // scale for preview
    lineHeight: 1.25,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textShadow: shadow ? '0 2px 8px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9)' : 'none',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 108px)' }}>

      {/* Left panel */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0d9c4', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* FFmpeg status */}
        {loading && (
          <div style={{ padding: '10px 20px', background: '#fef8f0', borderBottom: '1px solid #e0d9c4', fontSize: 9, color: '#DC440A', letterSpacing: 1, textTransform: 'uppercase' }}>
            {loadingMsg}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Upload */}
          <div>
            <div style={S.label}>Video</div>
            {videoFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff' }}>
                <span style={{ fontSize: 10, color: '#333F4C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{videoFile.name}</span>
                <button onClick={() => fileInputRef.current?.click()} style={{ fontSize: 9, color: '#DC440A', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 }}>Replace</button>
              </div>
            ) : (
              <label
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                style={{ display: 'block', padding: '20px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'center', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`, background: dragging ? '#fef8f0' : 'transparent' }}
              >
                <div style={{ fontSize: 10, color: dragging ? '#DC440A' : '#8a8270' }}>
                  {dragging ? 'Drop video here' : 'Upload MP4 / MOV / WebM'}
                </div>
              </label>
            )}
            <input ref={fileInputRef} type="file" accept="video/*" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
          </div>

          {/* Text */}
          <div>
            <div style={S.label}>Text</div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Enter text to overlay…"
              rows={4}
              style={S.textarea}
            />
          </div>

          {/* Font size */}
          <div>
            <div style={{ ...S.label, display: 'flex', justifyContent: 'space-between' }}>
              <span>Font Size</span>
              <span style={{ color: '#333F4C' }}>{fontSize}px</span>
            </div>
            <input
              type="range" min={32} max={160} step={4}
              value={fontSize}
              onChange={e => setFontSize(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#DC440A' }}
            />
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

        {/* Export */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: '1px solid #e0d9c4' }}>
          <button onClick={handleExport} disabled={!canExport} style={S.exportBtn(!canExport)}>
            {exporting ? exportMsg || 'Processing…' : !ffmpegReady ? 'Loading FFmpeg…' : !videoFile ? 'Upload a video' : 'Export MP4'}
          </button>
        </div>
      </div>

      {/* Right: video preview */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a', overflow: 'hidden' }}>
        {videoUrl ? (
          <div style={{ position: 'relative', maxHeight: '100%', maxWidth: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={videoRef}
              src={videoUrl}
              onLoadedMetadata={handleVideoMeta}
              controls
              loop
              style={{ maxHeight: 'calc(100vh - 130px)', maxWidth: '100%', display: 'block' }}
            />
            {text && (
              <div style={overlayStyle}>
                {text.toUpperCase()}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40 }}>
            Upload a video to preview
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8, fontWeight: 600 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e0d9c4', borderRadius: 4, background: '#fff', color: '#333F4C', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' },
  exportBtn: (disabled) => ({ width: '100%', padding: '12px 0', background: disabled ? '#e0d9c4' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#a09880' : '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer' }),
};
