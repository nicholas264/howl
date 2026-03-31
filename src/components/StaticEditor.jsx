import { useState, useRef, useCallback } from 'react';
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

export default function StaticEditor({ variation, photoUrl, onClose }) {
  const [templateId, setTemplateId] = useState('overlay');
  const [formatKey, setFormatKey] = useState('square');
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef(null);

  const template = TEMPLATES.find((t) => t.id === templateId);
  const format = FORMATS[formatKey];
  const TemplateComponent = template.Component;

  const previewScale = 0.4;

  const handleExport = useCallback(async () => {
    if (!captureRef.current) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(captureRef.current, {
        width: format.width,
        height: format.height,
        pixelRatio: 1,
      });
      const link = document.createElement('a');
      const product = (variation.product || 'howl').toLowerCase().replace(/\s+/g, '-');
      link.download = `howl_${product}_${templateId}_${format.label.replace(':', 'x')}_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [format, templateId, variation]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#111',
        border: '1px solid #1e1e1e',
        maxWidth: 900,
        maxHeight: '95vh',
        width: '95vw',
        overflow: 'auto',
        padding: 28,
        position: 'relative',
      }}>
        {/* Close button */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 12, right: 16,
          background: 'none', border: 'none', color: '#555',
          fontSize: 20, cursor: 'pointer', fontFamily: 'inherit',
        }}>×</button>

        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#3a3a3a', marginBottom: 20 }}>
          Static Ad Generator
        </div>

        {/* Template selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTemplateId(t.id)}
              style={{
                padding: '8px 16px',
                border: `1px solid ${templateId === t.id ? '#d94f2b' : '#1e1e1e'}`,
                background: templateId === t.id ? '#1a0e0a' : '#0c0c0c',
                color: templateId === t.id ? '#f0e8de' : '#555',
                fontFamily: 'inherit',
                fontSize: 10,
                letterSpacing: 1,
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Format toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {Object.entries(FORMATS).map(([key, f]) => (
            <button
              key={key}
              onClick={() => setFormatKey(key)}
              style={{
                padding: '6px 14px',
                border: `1px solid ${formatKey === key ? '#d94f2b' : '#1e1e1e'}`,
                background: formatKey === key ? '#1a0e0a' : '#0c0c0c',
                color: formatKey === key ? '#f0e8de' : '#555',
                fontFamily: 'inherit',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              {f.label} ({f.width}×{f.height})
            </button>
          ))}
        </div>

        {/* Preview container */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 20,
          background: '#0a0a0a',
          padding: 20,
          border: '1px solid #1a1a1a',
          overflow: 'hidden',
        }}>
          <div style={{
            width: format.width * previewScale,
            height: format.height * previewScale,
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              transform: `scale(${previewScale})`,
              transformOrigin: 'top left',
              width: format.width,
              height: format.height,
            }}>
              <TemplateComponent
                variation={variation}
                photoUrl={photoUrl}
                format={formatKey}
                dimensions={format}
              />
            </div>
          </div>
        </div>

        {/* Copy info */}
        <div style={{ fontSize: 9, color: '#444', marginBottom: 16, lineHeight: 1.6 }}>
          <strong style={{ color: '#666' }}>{variation.product}</strong> · {variation.angle}<br />
          "{variation.headline}"
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            padding: '12px 28px',
            background: exporting ? '#1e1e1e' : '#d94f2b',
            border: 'none',
            color: exporting ? '#333' : '#fff',
            fontFamily: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: 'uppercase',
            cursor: exporting ? 'not-allowed' : 'pointer',
            width: '100%',
          }}
        >
          {exporting ? 'Exporting...' : `Download PNG (${format.width}×${format.height})`}
        </button>
      </div>

      {/* Hidden full-resolution capture div */}
      <div style={{
        position: 'fixed',
        left: -99999,
        top: 0,
      }}>
        <div ref={captureRef} style={{ width: format.width, height: format.height }}>
          <TemplateComponent
            variation={variation}
            photoUrl={photoUrl}
            format={formatKey}
            dimensions={format}
          />
        </div>
      </div>
    </div>
  );
}
