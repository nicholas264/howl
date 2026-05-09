import { useState, useRef, useCallback, useEffect } from 'react';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';
import { PRODUCTS } from '../data';
import { COLORS, FONTS, BRAND_FONT_FILES, canvasFont, cssLetterSpacing, pxLetterSpacing, loadBrandFonts } from '../brand';

async function fetchLayouts() {
  try {
    const r = await fetch('/api/db/callout-layouts');
    const data = await r.json();
    return r.ok ? (data.layouts || []) : [];
  } catch { return []; }
}

async function fetchSavedImages(productId) {
  try {
    const url = productId
      ? `/api/db/callout-images?product_id=${encodeURIComponent(productId)}`
      : '/api/db/callout-images';
    const r = await fetch(url);
    const data = await r.json();
    return r.ok ? (data.images || []) : [];
  } catch { return []; }
}

async function saveImageRecord({ url, product_id, file_name }) {
  try {
    const r = await fetch('/api/db/callout-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, product_id, file_name }),
    });
    const data = await r.json();
    return r.ok ? data.image : null;
  } catch { return null; }
}

async function deleteImageRecord(id) {
  try {
    await fetch(`/api/db/callout-images?id=${id}`, { method: 'DELETE' });
    return true;
  } catch { return false; }
}

async function fetchFeatureSpecs(productId) {
  try {
    const r = await fetch(`/api/db/callout-features?product_id=${encodeURIComponent(productId)}`);
    const data = await r.json();
    return r.ok ? (data.specs || []) : [];
  } catch { return []; }
}

async function fetchPlacements(imageId) {
  if (!imageId) return [];
  try {
    const r = await fetch(`/api/db/callout-placements?image_id=${imageId}`);
    const data = await r.json();
    return r.ok ? (data.placements || []) : [];
  } catch { return []; }
}

async function savePlacements(rows) {
  if (!rows.length) return [];
  try {
    const r = await fetch('/api/db/callout-placements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    const data = await r.json();
    return r.ok ? (data.placements || []) : [];
  } catch { return []; }
}

async function clearPlacements(imageId) {
  if (!imageId) return;
  try {
    await fetch(`/api/db/callout-placements?image_id=${imageId}`, { method: 'DELETE' });
  } catch {}
}

// Apply cached placements to a callouts array. Matches by heading == feature_name.
function applyPlacementsToCallouts(callouts, placements) {
  if (!placements.length) return callouts;
  return callouts.map(c => {
    const p = placements.find(pl => pl.feature_name.toLowerCase() === (c.heading || '').toLowerCase());
    if (!p) return c;
    return {
      ...c,
      anchorX: Number(p.anchor_x),
      anchorY: Number(p.anchor_y),
      side: p.side,
      textX: p.text_x == null ? undefined : Number(p.text_x),
      textY: p.text_y == null ? Number(p.anchor_y) : Number(p.text_y),
    };
  });
}

// Build placement rows from current callouts.
function calloutsToPlacementRows(callouts, imageId, source) {
  return callouts
    .filter(c => (c.heading || '').trim())
    .map(c => ({
      image_id: imageId,
      feature_name: c.heading.trim(),
      anchor_x: c.anchorX,
      anchor_y: c.anchorY,
      side: c.side,
      text_x: c.textX ?? null,
      text_y: c.textY ?? null,
      source,
    }));
}

async function saveFeatureSpecs(specs) {
  const r = await fetch('/api/db/callout-features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(specs),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'save failed');
  return data.specs || [];
}

// Anti-overlap layout solver. Groups callouts by side, sorts by anchor Y, then
// enforces a minimum vertical gap between text-block centers. If a side has too
// many callouts to fit at min spacing, distribute them evenly over the band.
// textY is the only field mutated; anchors are not touched.
function applyLayoutSolver(callouts) {
  const MIN_GAP = 0.14;   // normalized vertical distance between text centers
  const TOP = 0.10;
  const BOT = 0.92;

  const distribute = (list) => {
    if (!list.length) return [];
    const required = (list.length - 1) * MIN_GAP;
    if (BOT - TOP < required) {
      const step = (BOT - TOP) / Math.max(1, list.length - 1);
      return list.map((c, i) => ({ ...c, textY: TOP + step * i, textX: undefined }));
    }
    let prev = -Infinity;
    const placed = list.map((c, i) => {
      const desired = Math.max(TOP, Math.min(BOT, c.anchorY));
      const minY = i === 0 ? TOP : prev + MIN_GAP;
      const ty = Math.max(desired, minY);
      prev = ty;
      return { ...c, textY: ty, textX: undefined };
    });
    const last = placed[placed.length - 1];
    if (last.textY > BOT) {
      const shift = last.textY - BOT;
      placed.forEach(c => { c.textY = Math.max(TOP, c.textY - shift); });
    }
    return placed;
  };

  const left = callouts.filter(c => c.side !== 'right').sort((a, b) => a.anchorY - b.anchorY);
  const right = callouts.filter(c => c.side === 'right').sort((a, b) => a.anchorY - b.anchorY);
  const placedLeft = distribute(left);
  const placedRight = distribute(right);
  // Preserve original order so the right-panel UI stays stable.
  const byId = new Map([...placedLeft, ...placedRight].map(c => [c.id, c]));
  return callouts.map(c => byId.get(c.id) || c);
}

async function fetchLayout(id) {
  const r = await fetch(`/api/db/callout-layouts?id=${id}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Could not load layout');
  return data.layout;
}

async function uploadCalloutImage(blob, productId, token) {
  const fileName = `callout-${productId || 'img'}-${Date.now()}.jpg`;
  const blobRes = await upload(`callout-photos/${fileName}`, blob, {
    access: 'public',
    handleUploadUrl: '/api/blob/upload-token',
    clientPayload: token,
    contentType: blob.type || 'image/jpeg',
  });
  return blobRes.url;
}

let cachedFontCss = null;
async function getFontEmbedCss() {
  if (cachedFontCss) return cachedFontCss;
  const blocks = await Promise.all(BRAND_FONT_FILES.map(async f => {
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
  // Text block position — independent of anchor. textX undefined falls back
  // to the side-margin default; once the user drags the label it pins here.
  textX: undefined,
  textY: y ?? 0.5,
});

// Default text X for a given side (matches the legacy side-margin layout).
const defaultTextX = (side) => (side === 'left' ? 0.04 : 0.96);

async function renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts, titlePos = { x: 0.05, y: 0.04 } }) {
  const titleSize = format.w * 0.075;
  const subSize = format.w * 0.022;
  const headSize = format.w * 0.028;
  const bodySize = format.w * 0.020;

  await Promise.all([
    loadBrandFonts({ headline: titleSize, subHeadline: subSize, body: bodySize }),
    document.fonts.load(canvasFont('headline', headSize)),
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

  ctx.fillStyle = '#F9F3DF';
  ctx.textBaseline = 'top';

  // Title (draggable)
  const titleX = format.w * titlePos.x;
  const titleY = format.h * titlePos.y;
  ctx.font = canvasFont('headline', titleSize);
  ctx.letterSpacing = `${pxLetterSpacing('headline', titleSize)}px`;
  ctx.textAlign = 'left';
  ctx.fillText((title || '').toUpperCase(), titleX, titleY);

  if (subtitle) {
    ctx.font = canvasFont('subHeadline', subSize);
    ctx.letterSpacing = `${pxLetterSpacing('subHeadline', subSize)}px`;
    ctx.fillText(subtitle.toUpperCase(), titleX, titleY + titleSize * 1.05);
  }

  // Callouts
  const headLineH = headSize * 1.1;
  const bodyLineH = bodySize * 1.3;
  const maxBlockW = format.w * 0.28;
  const headSpacing = pxLetterSpacing('headline', headSize);
  const bodySpacing = pxLetterSpacing('body', bodySize);

  for (const c of callouts) {
    const isLeft = c.side === 'left';
    const ty = c.textY ?? c.anchorY;
    const textCenterY = ty * format.h;
    const ax = c.anchorX * format.w;
    const ay = c.anchorY * format.h;

    // Wrap heading + body using the SAME letterSpacing the renderer will use,
    // so measureText returns accurate widths.
    ctx.font = canvasFont('headline', headSize);
    ctx.letterSpacing = `${headSpacing}px`;
    const headLines = wrapText(ctx, (c.heading || '').toUpperCase(), maxBlockW);
    const headMaxW = Math.max(0, ...headLines.map(l => ctx.measureText(l).width));

    ctx.font = canvasFont('body', bodySize);
    ctx.letterSpacing = `${bodySpacing}px`;
    const bodyLines = wrapText(ctx, c.body || '', maxBlockW);
    const bodyMaxW = Math.max(0, ...bodyLines.map(l => ctx.measureText(l).width));

    const blockH = headLines.length * headLineH + (headLines.length && bodyLines.length ? 8 : 0) + bodyLines.length * bodyLineH;
    const blockTop = textCenterY - blockH / 2;

    // Anchor edge of text (where leader line starts)
    const widestW = Math.max(headMaxW, bodyMaxW);
    const tx = c.textX ?? defaultTextX(c.side);
    const xText = tx * format.w;
    ctx.textAlign = isLeft ? 'left' : 'right';

    ctx.font = canvasFont('headline', headSize);
    ctx.letterSpacing = `${headSpacing}px`;
    headLines.forEach((line, i) => ctx.fillText(line, xText, blockTop + i * headLineH));

    ctx.font = canvasFont('body', bodySize);
    ctx.letterSpacing = `${bodySpacing}px`;
    const bodyTop = blockTop + headLines.length * headLineH + (headLines.length && bodyLines.length ? 8 : 0);
    bodyLines.forEach((line, i) => ctx.fillText(line, xText, bodyTop + i * bodyLineH));

    // Leader line — start at the inner edge of the widest text line, end at the dot.
    const lineStartX = isLeft ? xText + widestW + format.w * 0.012 : xText - widestW - format.w * 0.012;
    ctx.strokeStyle = '#F9F3DF';
    ctx.lineWidth = Math.max(1, format.w / 900);
    ctx.letterSpacing = '0px';
    ctx.beginPath();
    ctx.moveTo(lineStartX, textCenterY);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // Anchor dot
    ctx.fillStyle = '#F9F3DF';
    ctx.beginPath();
    ctx.arc(ax, ay, format.w * 0.007, 0, Math.PI * 2);
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
  const { getToken } = useAuth();
  const [productId, setProductId] = useState('r4mkii');
  const product = PRODUCTS.find(p => p.id === productId) || PRODUCTS[0];
  const [format, setFormat] = useState(FORMATS[0]);
  const [imgUrl, setImgUrl] = useState(null);   // local preview URL OR persisted blob URL
  const [imgBlobUrl, setImgBlobUrl] = useState(null); // Vercel Blob URL once uploaded
  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState(null); // currently-loaded draft id (db row id), if any
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedImages, setSavedImages] = useState([]);
  const [bulkUploading, setBulkUploading] = useState(0); // count of in-flight uploads
  const [dragOver, setDragOver] = useState(false);
  const [textBoxSizes, setTextBoxSizes] = useState({}); // id -> { w, h } measured on the stage
  const [batchRendering, setBatchRendering] = useState(0); // count of in-flight bulk renders
  const [variations, setVariations] = useState([]); // [{ id, srcUrl, fileName, dataUrl }]
  const [autoPlacing, setAutoPlacing] = useState(false);
  const [featureSpecs, setFeatureSpecs] = useState([]);
  const [featureLibraryOpen, setFeatureLibraryOpen] = useState(false);
  const [currentImageId, setCurrentImageId] = useState(null); // callout_images.id of the active image (null = no library record)

  useEffect(() => { fetchLayouts().then(setDrafts); }, []);
  // Per-product image libraries — refetch whenever the active product changes.
  useEffect(() => { fetchSavedImages(productId).then(setSavedImages); }, [productId]);
  // Per-product feature spec library. On first load for a product, auto-seed
  // from PRODUCTS.features + FEATURE_COPY so the user has something to edit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await fetchFeatureSpecs(productId);
      if (cancelled) return;
      if (existing.length) {
        setFeatureSpecs(existing);
        return;
      }
      const seedProduct = PRODUCTS.find(p => p.id === productId);
      if (!seedProduct) return;
      const seeded = seedProduct.features.map(name => ({
        product_id: productId,
        feature_name: name,
        visual_description: '',
        typical_location: '',
        body_copy: FEATURE_COPY[name] || '',
      }));
      try {
        const saved = await saveFeatureSpecs(seeded);
        if (!cancelled) setFeatureSpecs(saved);
      } catch (err) {
        console.error('seed feature specs failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [productId]);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [callouts, setCallouts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [titlePos, setTitlePos] = useState({ x: 0.05, y: 0.04 });
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef(null);
  const draggingRef = useRef(null); // { id, type: 'anchor' }
  const skipNextProductInitRef = useRef(false);

  // Initialize from product (skipped when loading a draft)
  useEffect(() => {
    if (skipNextProductInitRef.current) {
      skipNextProductInitRef.current = false;
      return;
    }
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

  // Upload a single file to Blob and record it in the saved-images library.
  // Returns the blob URL on success, or null. `setActive` controls whether
  // this file becomes the currently-selected image on the stage.
  const uploadAndRecord = async (file, { setActive } = { setActive: false }) => {
    let resized;
    try {
      resized = await resizeImage(file, 2000);
    } catch (err) {
      console.error('Image resize failed, falling back to original:', err);
      resized = file;
    }
    let localUrl = null;
    if (setActive) {
      if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
      localUrl = URL.createObjectURL(resized);
      setImgUrl(localUrl);
      setImgBlobUrl(null);
    }
    try {
      const token = await getToken();
      const url = await uploadCalloutImage(resized, productId, token);
      const record = await saveImageRecord({ url, product_id: productId, file_name: file.name });
      if (record) setSavedImages(prev => [record, ...prev]);
      if (setActive) {
        setImgUrl(url);
        setImgBlobUrl(url);
        setCurrentImageId(record?.id || null);
        if (localUrl) URL.revokeObjectURL(localUrl);
      }
      return url;
    } catch (err) {
      console.error('Image upload failed:', err);
      return null;
    }
  };

  const handleFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    if (files.length === 1) {
      await uploadAndRecord(files[0], { setActive: true });
      return;
    }
    setBulkUploading(files.length);
    let first = true;
    for (const f of files) {
      await uploadAndRecord(f, { setActive: first });
      first = false;
      setBulkUploading(n => n - 1);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    if (files.length === 1) {
      await uploadAndRecord(files[0], { setActive: true });
      return;
    }
    setBulkUploading(files.length);
    let first = true;
    for (const f of files) {
      await uploadAndRecord(f, { setActive: first });
      first = false;
      setBulkUploading(n => n - 1);
    }
  };

  const pickSavedImage = async (img) => {
    if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
    setImgUrl(img.url);
    setImgBlobUrl(img.url);
    setCurrentImageId(img.id);
    // Apply cached placements (vision result or manual override) to the
    // current callouts, so re-opening this image shows the same layout.
    const cached = await fetchPlacements(img.id);
    if (cached.length) {
      setCallouts(prev => applyPlacementsToCallouts(prev, cached));
    }
  };

  const removeSavedImage = async (img) => {
    if (!confirm('Delete this image from the library?')) return;
    const ok = await deleteImageRecord(img.id);
    if (!ok) return;
    setSavedImages(prev => prev.filter(i => i.id !== img.id));
    if (imgBlobUrl === img.url) {
      setImgUrl(null);
      setImgBlobUrl(null);
    }
  };

  const saveDraft = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      const payload = {
        product_id: productId,
        format: format.id,
        title,
        subtitle,
        title_pos: titlePos,
        callouts,
        image_url: imgBlobUrl,
      };
      let saved;
      if (draftId) {
        const r = await fetch(`/api/db/callout-layouts?id=${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Save failed');
        saved = data.layout;
      } else {
        const r = await fetch('/api/db/callout-layouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Save failed');
        saved = data.layout;
        setDraftId(saved.id);
      }
      setDrafts(await fetchLayouts());
      return saved;
    } catch (err) {
      console.error('saveDraft failed', err);
      alert('Save failed: ' + err.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const loadDraft = async (id) => {
    try {
      const d = await fetchLayout(id);
      if (!d) return;
      skipNextProductInitRef.current = true;
      setProductId(d.product_id);
      setFormat(FORMATS.find(f => f.id === d.format) || FORMATS[0]);
      setTitle(d.title || '');
      setSubtitle(d.subtitle || '');
      setTitlePos(d.title_pos || { x: 0.05, y: 0.04 });
      setCallouts(d.callouts || []);
      if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
      if (d.image_url) {
        setImgUrl(d.image_url);
        setImgBlobUrl(d.image_url);
      } else {
        setImgUrl(null);
        setImgBlobUrl(null);
      }
      setDraftId(d.id);
    } catch (err) {
      console.error('loadDraft failed', err);
      alert('Load failed: ' + err.message);
    }
  };

  const deleteDraft = async (id) => {
    try {
      await fetch(`/api/db/callout-layouts?id=${id}`, { method: 'DELETE' });
      setDrafts(prev => prev.filter(d => d.id !== id));
      if (draftId === id) setDraftId(null);
    } catch (err) {
      console.error('deleteDraft failed', err);
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
    if (type === 'title') {
      setTitlePos({
        x: Math.max(0.02, Math.min(0.95, x)),
        y: Math.max(0.01, Math.min(0.95, y)),
      });
      return;
    }
    setCallouts(prev => prev.map(c => {
      if (c.id !== id) return c;
      const clampedY = Math.max(0.05, Math.min(0.95, y));
      if (type === 'anchor') {
        return { ...c, anchorX: Math.max(0.02, Math.min(0.98, x)), anchorY: clampedY };
      }
      if (type === 'label') {
        const clampedX = Math.max(0.02, Math.min(0.98, x));
        // Auto-flip text alignment when the user drags across the midline,
        // so the leader line still attaches to the inner edge of the text.
        const nextSide = clampedX < 0.5 ? 'left' : 'right';
        return { ...c, textX: clampedX, textY: clampedY, side: nextSide };
      }
      return c;
    }));
  }, []);

  const stopDrag = useCallback(() => {
    const drag = draggingRef.current;
    draggingRef.current = null;
    // Persist manual override for the dragged callout so it sticks across
    // re-renders. Title drags aren't per-feature, so skip those.
    if (drag && drag.type !== 'title' && currentImageId) {
      const c = callouts.find(cc => cc.id === drag.id);
      if (c && (c.heading || '').trim()) {
        savePlacements([{
          image_id: currentImageId,
          feature_name: c.heading.trim(),
          anchor_x: c.anchorX,
          anchor_y: c.anchorY,
          side: c.side,
          text_x: c.textX ?? null,
          text_y: c.textY ?? null,
          source: 'manual',
        }]);
      }
    }
  }, [callouts, currentImageId]);

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
      const canvas = await renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts, titlePos });
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

  // Ask Claude vision where each feature lives in `srcUrl` and return a fresh
  // callouts array seeded with those anchors. Falls back to the existing
  // callouts if the call fails. Re-uses the body copy from the current
  // callouts (matched by heading) so user edits aren't lost.
  // Run vision (or use cached placements when complete) to position the
  // callouts on `srcUrl`. When `imageId` is supplied, results are cached and
  // re-used. `forceVision` skips the cache and re-runs Claude.
  const placeCalloutsWithVision = async (srcUrl, imageId = null, { forceVision = false } = {}) => {
    const features = callouts.map(c => c.heading || '').filter(Boolean);
    if (!features.length) return callouts;

    // Cache hit path: if every requested feature has a cached placement,
    // skip the vision call entirely.
    if (imageId && !forceVision) {
      const cached = await fetchPlacements(imageId);
      if (cached.length) {
        const cachedNames = new Set(cached.map(c => c.feature_name.toLowerCase()));
        const allCovered = features.every(f => cachedNames.has(f.toLowerCase()));
        if (allCovered) {
          return applyPlacementsToCallouts(callouts, cached);
        }
      }
    }

    const r = await fetch('/api/callout-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: srcUrl, productId, productName: product.name, features }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'vision failed');
    const placements = data.placements || [];
    if (!placements.length) return callouts;
    const merged = callouts.map(c => {
      const p = placements.find(pl => pl.feature.toLowerCase() === (c.heading || '').toLowerCase());
      if (!p) return c;
      return {
        ...c,
        anchorX: p.anchorX,
        anchorY: p.anchorY,
        side: p.side,
        textX: undefined,
        textY: p.anchorY,
      };
    });
    const solved = applyLayoutSolver(merged);
    // Cache the result so subsequent renders are deterministic and free.
    if (imageId) {
      savePlacements(calloutsToPlacementRows(solved, imageId, 'vision'));
    }
    return solved;
  };

  const autoPlace = async ({ forceVision = false } = {}) => {
    if (!imgBlobUrl) {
      alert('Save the image first (it needs a public URL).');
      return;
    }
    setAutoPlacing(true);
    try {
      if (forceVision && currentImageId) await clearPlacements(currentImageId);
      const next = await placeCalloutsWithVision(imgBlobUrl, currentImageId, { forceVision });
      setCallouts(next);
    } catch (err) {
      console.error('autoPlace failed', err);
      alert('Auto-place failed: ' + err.message);
    } finally {
      setAutoPlacing(false);
    }
  };

  // Render one callout PNG per saved image. Each render uses Claude vision
  // to pick anchors for THIS image (so callouts actually point at the right
  // feature, not at the same coordinates from the active layout). Results
  // land in a preview gallery — nothing is downloaded automatically.
  const renderBatch = async ({ withVision = true } = {}) => {
    if (!savedImages.length) return;
    setBatchRendering(savedImages.length);
    setVariations([]);
    const out = [];
    try {
      for (let i = 0; i < savedImages.length; i++) {
        const img = savedImages[i];
        try {
          const calloutsForImg = withVision
            ? await placeCalloutsWithVision(img.url, img.id).catch(() => callouts)
            : callouts;
          const canvas = await renderCalloutCanvas({
            imgUrl: img.url, format, title, subtitle, callouts: calloutsForImg, titlePos,
          });
          const dataUrl = canvas.toDataURL('image/png');
          out.push({
            id: `var-${img.id}-${Date.now()}`,
            srcUrl: img.url,
            fileName: img.file_name || `img-${img.id}`,
            dataUrl,
            callouts: calloutsForImg,
          });
          setVariations([...out]);
        } catch (err) {
          console.error('Batch render failed for', img.file_name, err);
        }
        setBatchRendering(savedImages.length - (i + 1));
      }
    } finally {
      setBatchRendering(0);
    }
  };

  const downloadVariation = (v) => {
    const a = document.createElement('a');
    a.href = v.dataUrl;
    const base = (v.fileName || 'img').replace(/\.[^/.]+$/, '');
    a.download = `howl_callout_${product.id}_${base}.png`;
    a.click();
  };

  const downloadAllVariations = async () => {
    for (const v of variations) {
      downloadVariation(v);
      await new Promise(r => setTimeout(r, 150));
    }
  };

  const useVariationAsBase = (v) => {
    if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
    setImgUrl(v.srcUrl);
    setImgBlobUrl(v.srcUrl);
    setCallouts(v.callouts);
  };

  const sendToCart = async () => {
    if (!onAddToCart) return;
    setExporting(true);
    try {
      const canvas = await renderCalloutCanvas({ imgUrl, format, title, subtitle, callouts, titlePos });
      const dataUrl = canvas.toDataURL('image/png');
      // auto-save the editor state so it can be re-opened later
      await saveDraft();
      onAddToCart({
        id: Date.now(),
        type: 'image',
        kind: 'callout-ad',
        calloutDraftId: draftId || `draft-${Date.now()}`,
        squareUrl: dataUrl,
        url: dataUrl,
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
                crossOrigin="anonymous"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}

            {/* Title block — draggable */}
            <div
              onMouseDown={(e) => { e.stopPropagation(); draggingRef.current = { id: '__title', type: 'title' }; }}
              style={{
                position: 'absolute',
                top: `${titlePos.y * 100}%`,
                left: `${titlePos.x * 100}%`,
                right: 'auto',
                color: '#F9F3DF', textAlign: 'left', cursor: 'grab',
              }}>
              <div style={{
                fontFamily: FONTS.headline.family, fontWeight: FONTS.headline.weight,
                fontSize: stageDisplayWidth * 0.075, letterSpacing: cssLetterSpacing('headline'),
                lineHeight: 1, textTransform: 'uppercase',
              }}>{title}</div>
              {subtitle && (
                <div style={{
                  fontFamily: FONTS.subHeadline.family, fontWeight: FONTS.subHeadline.weight,
                  fontSize: stageDisplayWidth * 0.022, letterSpacing: cssLetterSpacing('subHeadline'),
                  marginTop: 6, textTransform: 'uppercase',
                }}>{subtitle}</div>
              )}
            </div>

            {/* SVG leader lines — start at the inner edge of the rendered text
                block (measured on mount/resize) so the line never crosses the
                text. Falls back to the textX anchor while measurement is pending. */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {callouts.map(c => {
                const ax = c.anchorX * stageDisplayWidth;
                const ay = c.anchorY * stageDisplayHeight;
                const tx = c.textX ?? defaultTextX(c.side);
                const boxX = tx * stageDisplayWidth;
                const boxY = (c.textY ?? c.anchorY) * stageDisplayHeight;
                const isLeft = c.side === 'left';
                const measured = textBoxSizes[c.id]?.w || 0;
                // Left-anchored block grows rightward — line starts at right edge.
                // Right-anchored block grows leftward — line starts at left edge.
                const lineStartX = isLeft ? boxX + measured : boxX - measured;
                return (
                  <line
                    key={c.id}
                    x1={lineStartX} y1={boxY} x2={ax} y2={ay}
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

            {/* Callout text blocks — drag to move freely (X + Y) */}
            {callouts.map(c => {
              const isLeft = c.side === 'left';
              const tx = c.textX ?? defaultTextX(c.side);
              const ty = c.textY ?? c.anchorY;
              return (
                <div
                  key={`label-${c.id}`}
                  ref={(el) => {
                    if (!el) return;
                    const w = el.offsetWidth;
                    const h = el.offsetHeight;
                    setTextBoxSizes(prev => {
                      const cur = prev[c.id];
                      if (cur && cur.w === w && cur.h === h) return prev;
                      return { ...prev, [c.id]: { w, h } };
                    });
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    draggingRef.current = { id: c.id, type: 'label' };
                    setSelectedId(c.id);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${tx * 100}%`,
                    top: `${ty * 100}%`,
                    // Anchor by inner edge: left side grows rightward, right
                    // side grows leftward. Both centered vertically on textY.
                    transform: isLeft ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
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
                    fontFamily: FONTS.headline.family, fontWeight: FONTS.headline.weight,
                    fontSize: stageDisplayWidth * 0.028, letterSpacing: cssLetterSpacing('headline'),
                    textTransform: 'uppercase', lineHeight: 1.05,
                  }}>{c.heading}</div>
                  <div style={{
                    fontFamily: FONTS.body.family, fontWeight: FONTS.body.weight,
                    fontSize: stageDisplayWidth * 0.020, marginTop: 4, lineHeight: 1.3,
                    letterSpacing: cssLetterSpacing('body'),
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

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={exportPng} disabled={!imgUrl || exporting} style={primaryBtn}>
              {exporting ? 'Rendering…' : 'Download PNG'}
            </button>
            {onAddToCart && (
              <button onClick={sendToCart} disabled={!imgUrl || exporting} style={secondaryBtn}>
                Send to Cart
              </button>
            )}
            <button
              onClick={() => autoPlace()}
              disabled={!imgBlobUrl || autoPlacing}
              style={secondaryBtn}
              title="Use Claude vision (or cached placement) to position each callout's anchor"
            >
              {autoPlacing ? 'Placing…' : 'Auto-place callouts'}
            </button>
            {currentImageId && (
              <button
                onClick={() => autoPlace({ forceVision: true })}
                disabled={!imgBlobUrl || autoPlacing}
                style={secondaryBtn}
                title="Discard cached placements for this image and re-run Claude vision from scratch"
              >
                Re-run vision
              </button>
            )}
            <button
              onClick={() => setCallouts(prev => applyLayoutSolver(prev))}
              style={secondaryBtn}
              title="Spread overlapping text blocks vertically without changing anchors"
            >
              Tidy layout
            </button>
            <button
              onClick={() => setFeatureLibraryOpen(true)}
              style={secondaryBtn}
              title="Edit per-feature visual description, location, and body copy used by auto-place"
            >
              Feature library
            </button>
            {savedImages.length > 0 && (
              <button
                onClick={() => renderBatch({ withVision: true })}
                disabled={batchRendering > 0 || exporting}
                style={secondaryBtn}
                title="Render the current layout against every saved image, using vision to place each one"
              >
                {batchRendering > 0 ? `Rendering ${batchRendering}…` : `Render variations (${savedImages.length})`}
              </button>
            )}
          </div>

          {variations.length > 0 && (
            <div style={{ marginTop: 18, borderTop: '1px solid #2a3441', paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e' }}>
                  Variations ({variations.length})
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={downloadAllVariations} style={chipOff}>Download all</button>
                  <button onClick={() => setVariations([])} style={{ ...chipOff, color: '#f85149' }}>Clear</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {variations.map(v => (
                  <div key={v.id} style={{ background: '#0d1117', border: '1px solid #2a3441', borderRadius: 6, overflow: 'hidden' }}>
                    <img
                      src={v.dataUrl}
                      alt={v.fileName}
                      style={{ width: '100%', display: 'block', aspectRatio: `${format.w} / ${format.h}`, objectFit: 'cover' }}
                    />
                    <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 10, color: '#8b949e', wordBreak: 'break-all' }}>{v.fileName}</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button onClick={() => downloadVariation(v)} style={chipOff}>Download</button>
                        <button onClick={() => useVariationAsBase(v)} style={chipOff}>Edit</button>
                        {onAddToCart && (
                          <button
                            onClick={() => onAddToCart({
                              id: Date.now() + Math.random(),
                              type: 'image',
                              kind: 'callout-ad',
                              squareUrl: v.dataUrl,
                              url: v.dataUrl,
                              name: `${product.name} callout · ${v.fileName}`,
                              product: product.id,
                              createdAt: Date.now(),
                            })}
                            style={chipOff}
                          >Cart</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Row label="Saved layouts">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={draftId || ''}
                onChange={(e) => { if (e.target.value) loadDraft(e.target.value); else setDraftId(null); }}
                style={{ ...input, flex: 1 }}
              >
                <option value="">— New layout —</option>
                {drafts.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.title || PRODUCTS.find(p => p.id === d.product_id)?.name || `Layout ${d.id}`} · {new Date(d.updated_at).toLocaleString()}
                  </option>
                ))}
              </select>
              <button onClick={saveDraft} style={chipOff}>{draftId ? 'Update' : 'Save'}</button>
              {draftId && (
                <button onClick={() => deleteDraft(draftId)} style={{ ...chipOff, color: '#f85149' }}>Delete</button>
              )}
            </div>
          </Row>

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
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              style={{
                border: `1px dashed ${dragOver ? COLORS.flame : '#2a3441'}`,
                background: dragOver ? '#1f2630' : '#0d1117',
                borderRadius: 6,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <input type="file" accept="image/*" multiple onChange={handleFile} style={{ fontSize: 12 }} />
              <div style={{ fontSize: 11, color: '#6e7681' }}>
                Drag & drop image(s) here for bulk upload. First file becomes the active stage image; the rest go straight to the library.
                {bulkUploading > 0 && <span style={{ marginLeft: 6, color: COLORS.flame }}>Uploading {bulkUploading}…</span>}
              </div>
            </div>
            {savedImages.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 6 }}>
                  Saved images ({savedImages.length})
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
                  gap: 6,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}>
                  {savedImages.map(img => {
                    const active = imgBlobUrl === img.url;
                    return (
                      <div
                        key={img.id}
                        style={{ position: 'relative', aspectRatio: '1 / 1' }}
                      >
                        <img
                          src={img.url}
                          alt={img.file_name || ''}
                          crossOrigin="anonymous"
                          onClick={() => pickSavedImage(img)}
                          title={img.file_name || ''}
                          style={{
                            width: '100%', height: '100%', objectFit: 'cover',
                            borderRadius: 4, cursor: 'pointer',
                            border: `2px solid ${active ? COLORS.flame : 'transparent'}`,
                          }}
                        />
                        <button
                          onClick={() => removeSavedImage(img)}
                          title="Delete from library"
                          style={{
                            position: 'absolute', top: 2, right: 2,
                            width: 18, height: 18, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.7)', color: '#fff',
                            border: 0, cursor: 'pointer', fontSize: 11, lineHeight: 1,
                            padding: 0,
                          }}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
              Drag the cream dot to anchor the leader line to a feature. Drag the text block freely to position the callout anywhere on the canvas — the line follows. Crossing the centerline auto-flips the text alignment.
            </div>
          </div>
        </div>
      </div>

      {featureLibraryOpen && (
        <FeatureLibraryModal
          productId={productId}
          productName={product.name}
          specs={featureSpecs}
          onClose={() => setFeatureLibraryOpen(false)}
          onSaved={(saved) => {
            setFeatureSpecs(saved);
            // Pull updated body copy into any active callout whose heading matches.
            setCallouts(prev => prev.map(c => {
              const s = saved.find(sp => sp.feature_name.toLowerCase() === (c.heading || '').toLowerCase());
              if (!s || !s.body_copy) return c;
              return { ...c, body: s.body_copy };
            }));
          }}
        />
      )}
    </div>
  );
}

function FeatureLibraryModal({ productId, productName, specs, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => specs.map(s => ({ ...s })));
  const [saving, setSaving] = useState(false);

  const update = (i, patch) => setDraft(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const remove = async (i) => {
    const s = draft[i];
    if (s.id) {
      await fetch(`/api/db/callout-features?id=${s.id}`, { method: 'DELETE' });
    }
    setDraft(prev => prev.filter((_, idx) => idx !== i));
  };
  const add = () => setDraft(prev => [...prev, { product_id: productId, feature_name: '', visual_description: '', typical_location: '', body_copy: '' }]);

  const save = async () => {
    setSaving(true);
    try {
      const valid = draft.filter(s => s.feature_name.trim()).map(s => ({
        ...s,
        product_id: productId,
        feature_name: s.feature_name.trim(),
      }));
      const saved = await saveFeatureSpecs(valid);
      onSaved(saved);
      onClose();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d1117', border: '1px solid #2a3441', borderRadius: 8,
          width: '100%', maxWidth: 820, maxHeight: '85vh', overflow: 'auto', padding: 22,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Feature library — {productName}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: '#8b949e', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ color: '#8b949e', fontSize: 12, marginTop: 0 }}>
          These specs ground the auto-place vision call. The more precise your visual description and typical location, the more accurately Claude lands the dot. Body copy auto-fills new callouts and updates existing ones with a matching heading.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          {draft.map((s, i) => (
            <div key={s.id || `new-${i}`} style={{ background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  value={s.feature_name}
                  onChange={(e) => update(i, { feature_name: e.target.value })}
                  placeholder="Feature name (e.g. A-Flame Burner)"
                  style={{ ...input, fontWeight: 600 }}
                />
                <button onClick={() => remove(i)} style={{ ...chipOff, color: '#f85149' }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 4 }}>Visual description</div>
                  <textarea
                    value={s.visual_description || ''}
                    onChange={(e) => update(i, { visual_description: e.target.value })}
                    placeholder="What this feature looks like in the photo. e.g. The wide brass burner ring with cross-hatched holes at the bottom-center of the firepit."
                    rows={3}
                    style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 4 }}>Typical location</div>
                  <textarea
                    value={s.typical_location || ''}
                    onChange={(e) => update(i, { typical_location: e.target.value })}
                    placeholder="Where on the product it usually appears. e.g. Bottom-center, just under the flame."
                    rows={3}
                    style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 4 }}>Body copy</div>
                <textarea
                  value={s.body_copy || ''}
                  onChange={(e) => update(i, { body_copy: e.target.value })}
                  placeholder="Short benefit statement shown on the ad."
                  rows={2}
                  style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <button onClick={add} style={chipOff}>+ Add feature</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={chipOff}>Cancel</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save library'}</button>
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
