import { useState, useRef, useCallback, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { PRODUCTS } from '../data';
import { COLORS } from '../brand';

const BRAND_FONTS = [
  { family: 'Montserrat',     weight: 800, url: '/fonts/montserrat-800.woff2' },
  { family: 'Libre Franklin', weight: 700, url: '/fonts/libre-franklin-700.woff2' },
  { family: 'Source Sans 3',  weight: 400, url: '/fonts/source-sans-3-400.woff2' },
];

let cachedFontCss = null;
async function getFontEmbedCss() {
  if (cachedFontCss) return cachedFontCss;
  const blocks = await Promise.all(BRAND_FONTS.map(async f => {
    const res = await fetch(f.url);
    const buf = await res.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: normal; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
  }));
  cachedFontCss = blocks.join('\n');
  return cachedFontCss;
}

const FORMATS = [
  { id: 'square', label: '4:5',  w: 1080, h: 1350 },
  { id: 'story',  label: '9:16', w: 1080, h: 1920 },
];

const DEFAULT_CALLOUT = (heading, body, side, x, y) => ({
  id: cryptoId(),
  heading: heading || 'FEATURE NAME',
  body: body || 'Short benefit statement.',
  side: side || 'left',
  anchorX: x ?? 0.5,
  anchorY: y ?? 0.5,
  textY: y ?? 0.5, // text block vertical position — independent of anchor
});

// Render the entire callout ad to a canvas — bypasses html-to-image entirely.
async function renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts }) {
  await Promise.all([
    document.fonts.load('800 80px Montserrat'),
    document.fonts.load('700 24px "Libre Franklin"'),
    document.fonts.load('400 22px "Source Sans 3"'),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = format.w;
  canvas.height = format.h;
  const ctx = canvas.getContext('2d');

  // Background fallback
  ctx.fillStyle = '#1a1612';
  ctx.fillRect(0, 0, format.w, format.h);

  // Product image cover-fit
  if (imgUrl) {
    const img = await loadImg(imgUrl);
    const imgAR = img.naturalWidth / img.naturalHeight;
    const canAR = format.w / format.h;
    let sx, sy, sw, sh;
    if (imgAR > canAR) { sh = img.naturalHeight; sw = sh * canAR; sx = (img.naturalWidth - sw) / 2; sy = 0; }
    else { sw = img.naturalWidth; sh = sw / canAR; sx = 0; sy = (img.naturalHeight - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, format.w, format.h);
  }

  // Title block (top-left, ~5% margin, ~4% from top)
  const margin = format.w * 0.05;
  const titleSize = format.w * 0.075;
  const subSize = format.w * 0.022;
  ctx.fillStyle = '#F9F3DF';
  ctx.textBaseline = 'top';
  ctx.font = `800 ${titleSize}px Montserrat, sans-serif`;
  drawSpacedText(ctx, (title || '').toUpperCase(), margin, format.h * 0.04, 0.02);
  if (subtitle) {
    ctx.font = `700 ${subSize}px "Libre Franklin", sans-serif`;
    drawSpacedText(ctx, subtitle.toUpperCase(), margin, format.h * 0.04 + titleSize * 1.05, 0.08);
  }

  // Callouts
  const headSize = format.w * 0.028;
  const bodySize = format.w * 0.020;
  const headLineH = headSize * 1.05;
  const bodyLineH = bodySize * 1.3;
  const maxBlockW = format.w * 0.28;

  for (const c of callouts) {
    const isLeft = c.side === 'left';
    const ty = c.textY ?? c.anchorY;
    const textCenterY = ty * format.h;
    const ax = c.anchorX * format.w;
    const ay = c.anchorY * format.h;

    // Wrap heading + body
    ctx.font = `800 ${headSize}px Montserrat, sans-serif`;
    const headLines = wrapText(ctx, (c.heading || '').toUpperCase(), maxBlockW);
    ctx.font = `400 ${bodySize}px "Source Sans 3", sans-serif`;
    const bodyLines = wrapText(ctx, c.body || '', maxBlockW);

    const blockH = headLines.length * headLineH + 8 + bodyLines.length * bodyLineH;
    const blockTop = textCenterY - blockH / 2;
    const xLeft = isLeft ? format.w * 0.03 : format.w * 0.97 - maxBlockW;
    const xRight = isLeft ? format.w * 0.03 + maxBlockW : format.w * 0.97;

    ctx.fillStyle = '#F9F3DF';
    ctx.textBaseline = 'top';
    ctx.textAlign = isLeft ? 'left' : 'right';
    const headX = isLeft ? xLeft : xRight;

    ctx.font = `800 ${headSize}px Montserrat, sans-serif`;
    headLines.forEach((line, i) => {
      drawSpacedText(ctx, line, headX, blockTop + i * headLineH, 0.04, ctx.textAlign);
    });

    ctx.font = `400 ${bodySize}px "Source Sans 3", sans-serif`;
    const bodyTop = blockTop + headLines.length * headLineH + 8;
    bodyLines.forEach((line, i) => {
      ctx.fillText(line, headX, bodyTop + i * bodyLineH);
    });

    // Leader line — from inner edge of the text block at textCenterY → anchor dot
    const lineStartX = isLeft ? xLeft + maxBlockW * 0.42 : xRight - maxBlockW * 0.42;
    ctx.strokeStyle = '#F9F3DF';
    ctx.lineWidth = Math.max(1, format.w / 720);
    ctx.beginPath();
    ctx.moveTo(lineStartX, textCenterY);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // Anchor dot
    ctx.fillStyle = '#F9F3DF';
    ctx.beginPath();
    ctx.arc(ax, ay, format.w * 0.008, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image failed to load'));
    i.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = (text || '').split(' ');
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

function drawSpacedText(ctx, text, x, y, letterSpacingEm, align) {
  const size = parseFloat(ctx.font);
  const ls = size * letterSpacingEm;
  const chars = [...text];
  if (align === 'right') {
    let totalW = 0;
    for (const ch of chars) totalW += ctx.measureText(ch).width + ls;
    let cx = x - totalW + ls;
    for (const ch of chars) {
      ctx.textAlign = 'left';
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + ls;
    }
  } else {
    ctx.textAlign = 'left';
    let cx = x;
    for (const ch of chars) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + ls;
    }
  }
}

async function resizeImage(file, maxEdge) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (longEdge <= maxEdge) {
      const blob = await fetch(url).then(r => r.blob());
      return blob;
    }
    const scale = maxEdge / longEdge;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cryptoId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`;
}

const FEATURE_COPY = {
  'A-Flame Burner': 'The brightest, cleanest, most weather-resistant flame ever created',
  'FlexDome Windscreen': 'Holds the flame steady in 30mph gusts',
  'Gullwing Legs': 'Fold in for a shoebox-sized footprint',
  'PressBrake Frame': 'Built in the USA. Use it and abuse it',
  'Tank-Stabilizing Design': 'Locks onto a 20lb tank — no tipping',
  'BarCoal® Radiant Heater': 'Thigh-melting heat, no matter what nature throws at you',
  'EchoHeat Reflector Shields': 'Keeps the ground cool so you can use it in a burn ban',
  'Jackknife Folding Legs': 'Pack-down small, deploy in seconds',
};

const PRESET_ANCHORS = [
  { side: 'left',  x: 0.18, y: 0.30 },
  { side: 'right', x: 0.78, y: 0.32 },
  { side: 'left',  x: 0.20, y: 0.62 },
  { side: 'right', x: 0.80, y: 0.65 },
  { side: 'left',  x: 0.25, y: 0.85 },
  { side: 'right', x: 0.75, y: 0.85 },
];

export default function CalloutAdTool({ onAddToCart }) {
  const [productId, setProductId] = useState('r4mkii');
  const product = PRODUCTS.find(p => p.id === productId) || PRODUCTS[0];
  const [format, setFormat] = useState(FORMATS[0]);
  const [imgUrl, setImgUrl] = useState(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [callouts, setCallouts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef(null);
  const draggingRef = useRef(null); // { id, type: 'anchor' }

  // Initialize from product
  useEffect(() => {
    setTitle(`THE ${product.name.toUpperCase()}`);
    setSubtitle(product.tagline.toUpperCase());
    const features = product.features.slice(0, 4);
    setCallouts(features.map((f, i) => DEFAULT_CALLOUT(
      f.toUpperCase(),
      FEATURE_COPY[f] || 'Add a benefit statement here.',
      PRESET_ANCHORS[i].side,
      PRESET_ANCHORS[i].x,
      PRESET_ANCHORS[i].y,
    )));
  }, [productId]);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    try {
      const resized = await resizeImage(f, 2000); // long-edge cap
      setImgUrl(URL.createObjectURL(resized));
    } catch (err) {
      console.error('Image resize failed, falling back to original:', err);
      setImgUrl(URL.createObjectURL(f));
    }
  };

  const updateCallout = (id, patch) => {
    setCallouts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };
  const removeCallout = (id) => {
    setCallouts(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const addCallout = () => {
    const idx = callouts.length % PRESET_ANCHORS.length;
    const preset = PRESET_ANCHORS[idx];
    const newC = DEFAULT_CALLOUT('NEW FEATURE', 'Short benefit', preset.side, preset.x, preset.y);
    setCallouts(prev => [...prev, newC]);
    setSelectedId(newC.id);
  };

  const handleStageMouseMove = useCallback((e) => {
    if (!draggingRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const { id, type } = draggingRef.current;
    setCallouts(prev => prev.map(c => {
      if (c.id !== id) return c;
      const clampedY = Math.max(0.05, Math.min(0.95, y));
      if (type === 'anchor') {
        return { ...c, anchorX: Math.max(0.02, Math.min(0.98, x)), anchorY: clampedY };
      }
      if (type === 'label') {
        return { ...c, textY: clampedY };
      }
      return c;
    }));
  }, []);

  const stopDrag = useCallback(() => { draggingRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleStageMouseMove);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', handleStageMouseMove);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [handleStageMouseMove, stopDrag]);

  const exportPng = async () => {
    setExporting(true);
    try {
      const canvas = await renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `howl_callout_${product.id}_${Date.now()}.png`;
      a.click();
    } catch (err) {
      console.error('Callout export error:', err);
      alert('Export failed: ' + (err?.message || JSON.stringify(err)));
    } finally {
      setExporting(false);
    }
  };

  const sendToCart = async () => {
    if (!onAddToCart) return;
    setExporting(true);
    try {
      const canvas = await renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts });
      const dataUrl = canvas.toDataURL('image/png');
      onAddToCart({
        id: Date.now(),
        type: 'image',
        kind: 'callout-ad',
        dataUrl,
        name: `${product.name} callout · ${new Date().toLocaleString()}`,
        product: product.id,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  // Stage display height for editing — keep aspect ratio of selected format.
  const stageDisplayWidth = 480;
  const stageDisplayHeight = stageDisplayWidth * (format.h / format.w);

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Callout Ads</h1>
      <p style={{ color: '#8b949e', marginTop: 0, fontSize: 13 }}>
        Product photo + title + leader-line callouts. Drag the dots onto the feature you're calling out.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '520px 1fr', gap: 24, marginTop: 16 }}>
        {/* LEFT — stage */}
        <div>
          <div
            ref={stageRef}
            style={{
              position: 'relative',
              width: stageDisplayWidth,
              height: stageDisplayHeight,
              background: '#1a1612',
              overflow: 'hidden',
              borderRadius: 4,
              fontFamily: "'Montserrat', sans-serif",
              userSelect: 'none',
            }}
            onClick={() => setSelectedId(null)}
          >
            {imgUrl && (
              <img
                src={imgUrl}
                alt=""
                draggable={false}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}

            {/* Title block */}
            <div style={{
              position: 'absolute', top: '4%', left: '5%', right: '5%',
              color: '#F9F3DF', textAlign: 'left', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'Montserrat', sans-serif", fontWeight: 800,
                fontSize: stageDisplayWidth * 0.075, letterSpacing: '0.02em',
                lineHeight: 1, textTransform: 'uppercase',
              }}>{title}</div>
              {subtitle && (
                <div style={{
                  fontFamily: "'Libre Franklin', sans-serif", fontWeight: 700,
                  fontSize: stageDisplayWidth * 0.022, letterSpacing: '0.08em',
                  marginTop: 6, textTransform: 'uppercase',
                }}>{subtitle}</div>
              )}
            </div>

            {/* SVG leader lines */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {callouts.map(c => {
                const ax = c.anchorX * stageDisplayWidth;
                const ay = c.anchorY * stageDisplayHeight;
                // Box edge anchor near callout text — uses textY so line can be diagonal
                const boxX = c.side === 'left' ? stageDisplayWidth * 0.32 : stageDisplayWidth * 0.68;
                const boxY = (c.textY ?? c.anchorY) * stageDisplayHeight;
                return (
                  <line
                    key={c.id}
                    x1={boxX} y1={boxY} x2={ax} y2={ay}
                    stroke="#F9F3DF" strokeWidth={1}
                  />
                );
              })}
            </svg>

            {/* Anchor dots */}
            {callouts.map(c => (
              <div
                key={`dot-${c.id}`}
                onMouseDown={(e) => { e.stopPropagation(); draggingRef.current = { id: c.id, type: 'anchor' }; setSelectedId(c.id); }}
                style={{
                  position: 'absolute',
                  left: `${c.anchorX * 100}%`,
                  top: `${c.anchorY * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 10, height: 10, borderRadius: '50%',
                  background: '#F9F3DF',
                  border: selectedId === c.id ? '2px solid #DC440A' : '2px solid transparent',
                  cursor: 'grab', zIndex: 3,
                }}
              />
            ))}

            {/* Callout text blocks — drag to move vertically */}
            {callouts.map(c => {
              const isLeft = c.side === 'left';
              const xPct = isLeft ? 3 : 97;
              const ty = c.textY ?? c.anchorY;
              return (
                <div
                  key={`label-${c.id}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    draggingRef.current = { id: c.id, type: 'label' };
                    setSelectedId(c.id);
                  }}
                  style={{
                    position: 'absolute',
                    [isLeft ? 'left' : 'right']: `${isLeft ? xPct : 100 - xPct}%`,
                    top: `${ty * 100}%`,
                    transform: 'translateY(-50%)',
                    maxWidth: '28%',
                    color: '#F9F3DF',
                    textAlign: isLeft ? 'left' : 'right',
                    cursor: 'grab',
                    outline: selectedId === c.id ? `1px dashed ${COLORS.flame}` : 'none',
                    outlineOffset: 4,
                    padding: 2,
                  }}
                >
                  <div style={{
                    fontFamily: "'Montserrat', sans-serif", fontWeight: 800,
                    fontSize: stageDisplayWidth * 0.028, letterSpacing: '0.04em',
                    textTransform: 'uppercase', lineHeight: 1.05,
                  }}>{c.heading}</div>
                  <div style={{
                    fontFamily: "'Source Sans 3', sans-serif", fontWeight: 400,
                    fontSize: stageDisplayWidth * 0.020, marginTop: 4, lineHeight: 1.3,
                  }}>{c.body}</div>
                </div>
              );
            })}

            {!imgUrl && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#6e7681', fontSize: 12, pointerEvents: 'none',
              }}>Upload a product image →</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={exportPng} disabled={!imgUrl || exporting} style={primaryBtn}>
              {exporting ? 'Rendering…' : 'Download PNG'}
            </button>
            {onAddToCart && (
              <button onClick={sendToCart} disabled={!imgUrl || exporting} style={secondaryBtn}>
                Send to Cart
              </button>
            )}
          </div>
        </div>

        {/* RIGHT — controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Row label="Product">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} style={input}>
              {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name} — {p.tagline}</option>)}
            </select>
          </Row>

          <Row label="Format">
            <div style={{ display: 'flex', gap: 6 }}>
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f)}
                  style={format.id === f.id ? chipOn : chipOff}
                >{f.label}</button>
              ))}
            </div>
          </Row>

          <Row label="Product image">
            <input type="file" accept="image/*" onChange={handleFile} style={{ fontSize: 12 }} />
          </Row>

          <Row label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
          </Row>
          <Row label="Subtitle">
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} style={input} />
          </Row>

          <div style={{ borderTop: '1px solid #2a3441', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e' }}>Callouts</div>
              <button onClick={addCallout} style={chipOff}>+ Add</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {callouts.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    background: selectedId === c.id ? '#1f2630' : '#161b22',
                    border: '1px solid #2a3441',
                    borderRadius: 6, padding: 10, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#6e7681' }}>#{i + 1}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateCallout(c.id, { side: c.side === 'left' ? 'right' : 'left' }); }}
                      style={chipOff}
                    >{c.side === 'left' ? '← Left' : 'Right →'}</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeCallout(c.id); }}
                      style={{ ...chipOff, marginLeft: 'auto', color: '#f85149' }}
                    >Remove</button>
                  </div>
                  <input
                    value={c.heading}
                    onChange={(e) => updateCallout(c.id, { heading: e.target.value })}
                    placeholder="HEADING"
                    style={{ ...input, fontWeight: 600 }}
                  />
                  <textarea
                    value={c.body}
                    onChange={(e) => updateCallout(c.id, { body: e.target.value })}
                    placeholder="Short benefit"
                    rows={2}
                    style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#6e7681', marginTop: 8, lineHeight: 1.5 }}>
              Drag the cream dot to anchor the leader line to a feature. Drag the text block itself to move the callout up or down — the line goes diagonal automatically. Use the Left/Right button to flip a callout to the other side.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const input = {
  width: '100%', background: '#0d1117', border: '1px solid #2a3441',
  color: '#f0f4f8', padding: '8px 10px', borderRadius: 4, fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
};
const chipBase = {
  background: 'transparent', color: '#f0f4f8', border: '1px solid #2a3441',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
};
const chipOff = chipBase;
const chipOn = { ...chipBase, background: COLORS.flame, borderColor: COLORS.flame, color: '#fff' };
const primaryBtn = {
  background: COLORS.flame, color: '#fff', border: 0, padding: '10px 16px',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const secondaryBtn = {
  background: 'transparent', color: '#f0f4f8', border: '1px solid #2a3441',
  padding: '10px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
};
