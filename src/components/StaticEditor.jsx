import { useState, useRef, useCallback, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { FORMATS } from '../brand';
import OverlayTemplate from '../templates/OverlayTemplate';
import SplitTemplate from '../templates/SplitTemplate';
import EditorialTemplate from '../templates/EditorialTemplate';

const TEMPLATES = [
  { id: 'overlay', label: 'Overlay', Component: OverlayTemplate },
  { id: 'split', label: 'Split', Component: SplitTemplate },
  { id: 'editorial', label: 'Editorial', Component: EditorialTemplate },
];

const DEFAULT_POSITION = { vertical: 'bottom', horizontal: 'left' };

function processImageFile(file, onAddImage) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File must be under 10MB'); return; }
  if (!file.type.startsWith('image/')) { alert('Please upload a JPEG or PNG image'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 2160;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      onAddImage(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

export default function StaticEditor({ variation, savedImages, onAddImage, onRemoveSavedImage, onClose }) {
  const [templateId, setTemplateId] = useState('overlay');
  const [formatKey, setFormatKey] = useState('square');
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [headline, setHeadline] = useState(variation.headline);

  const [selectedIds, setSelectedIds] = useState(() =>
    savedImages.length > 0 ? new Set([savedImages[0].id]) : new Set()
  );
  const [previewId, setPreviewId] = useState(() =>
    savedImages.length > 0 ? savedImages[0].id : null
  );

  const fileInputRef = useRef(null);
  const captureRefs = useRef({});

  // Auto-select newly added images (uploaded from within this editor)
  const prevLengthRef = useRef(savedImages.length);
  useEffect(() => {
    if (savedImages.length > prevLengthRef.current && savedImages.length > 0) {
      const newest = savedImages[0];
      setSelectedIds(prev => new Set([...prev, newest.id]));
      setPreviewId(newest.id);
    }
    prevLengthRef.current = savedImages.length;
  }, [savedImages]);

  const template = TEMPLATES.find((t) => t.id === templateId);
  const format = FORMATS[formatKey];
  const TemplateComponent = template.Component;

  const previewImage = savedImages.find(img => img.id === previewId);
  const selectedImages = savedImages.filter(img => selectedIds.has(img.id));
  const activeVariation = { ...variation, headline };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    setPreviewId(id);
  };

  const handleFileSelect = (e) => {
    processImageFile(e.target.files?.[0], onAddImage);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    processImageFile(e.dataTransfer.files?.[0], onAddImage);
  };

  const handleExport = useCallback(async () => {
    if (selectedImages.length === 0) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const product = (variation.product || 'howl').toLowerCase().replace(/\s+/g, '-');
      for (const img of selectedImages) {
        const el = captureRefs.current[img.id];
        if (!el) continue;
        // Warm font cache
        await toPng(el, { width: format.width, height: format.height, pixelRatio: 1 });
        const dataUrl = await toPng(el, { width: format.width, height: format.height, pixelRatio: 1 });
        const link = document.createElement('a');
        link.download = `howl_${product}_${templateId}_${format.label.replace(':', 'x')}_${img.id}.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [selectedImages, format, templateId, variation]);

  const maxPreviewH = typeof window !== 'undefined' ? window.innerHeight - 100 : 700;
  const maxPreviewW = typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.55, 600) : 500;
  const scaleByH = maxPreviewH / format.height;
  const scaleByW = maxPreviewW / format.width;
  const previewScale = Math.min(scaleByH, scaleByW, 0.5);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(51,63,76,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#F9F3DF', border: '1px solid #e0d9c4', borderRadius: 8,
        display: 'flex', maxHeight: 'calc(100vh - 40px)', overflow: 'hidden',
      }}>

        {/* Left: Controls */}
        <div style={{
          width: 260, padding: 24, display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', borderRight: '1px solid #e0d9c4',
          flexShrink: 0, overflowY: 'auto',
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#8a8270', marginBottom: 20 }}>
              Static Ad
            </div>

            {/* Template */}
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>Template</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => setTemplateId(t.id)} style={{
                  padding: '8px 14px', border: `1px solid ${templateId === t.id ? '#DC440A' : '#e0d9c4'}`,
                  background: templateId === t.id ? '#fef8f0' : '#fff',
                  color: templateId === t.id ? '#333F4C' : '#8a8270',
                  fontFamily: 'inherit', fontSize: 10, letterSpacing: 1,
                  textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4, textAlign: 'left',
                }}>{t.label}</button>
              ))}
            </div>

            {/* Format */}
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>Format</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {Object.entries(FORMATS).map(([key, f]) => (
                <button key={key} onClick={() => setFormatKey(key)} style={{
                  padding: '6px 12px', border: `1px solid ${formatKey === key ? '#DC440A' : '#e0d9c4'}`,
                  background: formatKey === key ? '#fef8f0' : '#fff',
                  color: formatKey === key ? '#333F4C' : '#8a8270',
                  fontFamily: 'inherit', fontSize: 10, cursor: 'pointer', borderRadius: 4, flex: 1, textAlign: 'center',
                }}>{f.label}</button>
              ))}
            </div>

            {/* Editable copy */}
            <div style={{ fontSize: 9, color: '#8a8270', marginBottom: 6 }}>
              <strong style={{ color: '#333F4C' }}>{variation.product}</strong> · {variation.angle}
            </div>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 6 }}>Headline</div>
            <textarea
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', marginBottom: 4,
                border: '1px solid #e0d9c4', borderRadius: 4,
                background: '#fff', color: '#333F4C',
                fontFamily: 'inherit', fontSize: 11, lineHeight: 1.5,
                resize: 'vertical', outline: 'none',
              }}
            />
            <button
              onClick={() => setHeadline(variation.headline)}
              style={{
                background: 'none', border: 'none', padding: 0,
                fontSize: 8, color: '#8a8270', cursor: 'pointer',
                letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16,
              }}
            >Reset to AI copy</button>

            {/* Image picker */}
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>
              Images {selectedImages.length > 0 && <span style={{ color: '#DC440A' }}>({selectedImages.length} selected)</span>}
            </div>

            {savedImages.length === 0 ? (
              <div style={{ fontSize: 10, color: '#8a8270', marginBottom: 12 }}>No saved images yet — upload one below.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {savedImages.map((img) => {
                  const isSelected = selectedIds.has(img.id);
                  const isPreviewing = previewId === img.id;
                  return (
                    <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        onClick={() => toggleSelect(img.id)}
                        style={{
                          width: 64, height: 64, borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
                          border: isSelected ? '2px solid #DC440A' : '2px solid #e0d9c4',
                          outline: isPreviewing && isSelected ? '2px solid #DC440A' : 'none',
                          outlineOffset: 2,
                          opacity: isSelected ? 1 : 0.5,
                          transition: 'opacity 0.15s, border-color 0.15s',
                        }}
                      >
                        <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveSavedImage(img.id); }}
                        style={{
                          position: 'absolute', top: 2, right: 2, width: 14, height: 14,
                          background: 'rgba(51,63,76,0.75)', border: 'none', borderRadius: 2,
                          color: '#fff', fontSize: 9, cursor: 'pointer', padding: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Upload new image */}
            <label
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              style={{
                display: 'block', padding: '8px 10px', border: `1px dashed ${dragging ? '#DC440A' : '#c0b89a'}`,
                borderRadius: 4, cursor: 'pointer', textAlign: 'center',
                background: dragging ? '#fef8f0' : 'transparent', marginBottom: 4,
              }}
            >
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={handleFileSelect} style={{ display: 'none' }} />
              <div style={{ fontSize: 9, color: dragging ? '#DC440A' : '#8a8270' }}>
                {dragging ? 'Drop to upload' : '+ Upload image'}
              </div>
            </label>
            <div style={{ fontSize: 8, color: '#aaa', marginBottom: 0 }}>JPEG/PNG · max 10MB · saves to library</div>
          </div>

          {/* Bottom buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
            <button
              onClick={handleExport}
              disabled={exporting || selectedImages.length === 0}
              style={{
                padding: '12px 16px',
                background: (exporting || selectedImages.length === 0) ? '#e0d9c4' : '#DC440A',
                border: 'none',
                color: (exporting || selectedImages.length === 0) ? '#a09880' : '#fff',
                fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2,
                textTransform: 'uppercase',
                cursor: (exporting || selectedImages.length === 0) ? 'not-allowed' : 'pointer',
                borderRadius: 4,
              }}
            >
              {exporting
                ? 'Exporting...'
                : selectedImages.length > 1
                  ? `Download ${selectedImages.length} PNGs`
                  : 'Download PNG'}
            </button>
            <button onClick={onClose} style={{
              padding: '10px 16px', background: 'none', border: '1px solid #e0d9c4',
              color: '#8a8270', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2,
              textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4,
            }}>Close</button>
          </div>
        </div>

        {/* Right: Preview */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f0ead4' }}>
          {previewImage ? (
            <div style={{
              width: format.width * previewScale, height: format.height * previewScale,
              overflow: 'hidden', borderRadius: 4, boxShadow: '0 4px 24px rgba(51,63,76,0.15)',
            }}>
              <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: format.width, height: format.height }}>
                <TemplateComponent
                  variation={activeVariation}
                  photoUrl={previewImage.url}
                  format={formatKey}
                  dimensions={format}
                  textPosition={previewImage.textPosition || DEFAULT_POSITION}
                />
              </div>
            </div>
          ) : (
            <div style={{ width: 280, textAlign: 'center', color: '#8a8270', fontSize: 11 }}>
              Upload or select an image to preview
            </div>
          )}
        </div>
      </div>

      {/* Hidden capture divs — one per selected image */}
      <div style={{ position: 'fixed', left: -99999, top: 0 }}>
        {selectedImages.map(img => (
          <div key={img.id} ref={el => { captureRefs.current[img.id] = el; }} style={{ width: format.width, height: format.height }}>
            <TemplateComponent
              variation={activeVariation}
              photoUrl={img.url}
              format={formatKey}
              dimensions={format}
              textPosition={img.textPosition || DEFAULT_POSITION}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
