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

export default function StaticEditor({ variation, photoUrl, textPosition, onClose }) {
  const [templateId, setTemplateId] = useState('overlay');
  const [formatKey, setFormatKey] = useState('square');
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef(null);

  const template = TEMPLATES.find((t) => t.id === templateId);
  const format = FORMATS[formatKey];
  const TemplateComponent = template.Component;

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

  // Calculate preview scale to fit within viewport
  // Preview area: viewport height minus padding (80px top/bottom)
  // Preview should fit fully visible
  const maxPreviewH = typeof window !== 'undefined' ? window.innerHeight - 100 : 700;
  const maxPreviewW = typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.55, 600) : 500;
  const scaleByH = maxPreviewH / format.height;
  const scaleByW = maxPreviewW / format.width;
  const previewScale = Math.min(scaleByH, scaleByW, 0.5);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(51,63,76,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#F9F3DF',
        border: '1px solid #e0d9c4',
        borderRadius: 8,
        display: 'flex',
        maxHeight: 'calc(100vh - 40px)',
        overflow: 'hidden',
      }}>
        {/* Left: Controls */}
        <div style={{
          width: 240,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          borderRight: '1px solid #e0d9c4',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#8a8270', marginBottom: 20 }}>
              Static Ad
            </div>

            {/* Template selector */}
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>Template</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  style={{
                    padding: '8px 14px',
                    border: `1px solid ${templateId === t.id ? '#DC440A' : '#e0d9c4'}`,
                    background: templateId === t.id ? '#fef8f0' : '#fff',
                    color: templateId === t.id ? '#333F4C' : '#8a8270',
                    fontFamily: 'inherit',
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: 4,
                    textAlign: 'left',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Format toggle */}
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>Format</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {Object.entries(FORMATS).map(([key, f]) => (
                <button
                  key={key}
                  onClick={() => setFormatKey(key)}
                  style={{
                    padding: '6px 12px',
                    border: `1px solid ${formatKey === key ? '#DC440A' : '#e0d9c4'}`,
                    background: formatKey === key ? '#fef8f0' : '#fff',
                    color: formatKey === key ? '#333F4C' : '#8a8270',
                    fontFamily: 'inherit',
                    fontSize: 10,
                    cursor: 'pointer',
                    borderRadius: 4,
                    flex: 1,
                    textAlign: 'center',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Copy info */}
            <div style={{ fontSize: 9, color: '#8a8270', lineHeight: 1.6, marginBottom: 20 }}>
              <strong style={{ color: '#333F4C' }}>{variation.product}</strong> · {variation.angle}<br />
              <span style={{ color: '#333F4C' }}>"{variation.headline}"</span>
            </div>
          </div>

          {/* Bottom buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                padding: '12px 16px',
                background: exporting ? '#e0d9c4' : '#DC440A',
                border: 'none',
                color: exporting ? '#a09880' : '#fff',
                fontFamily: 'inherit',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
                cursor: exporting ? 'not-allowed' : 'pointer',
                borderRadius: 4,
              }}
            >
              {exporting ? 'Exporting...' : 'Download PNG'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px',
                background: 'none',
                border: '1px solid #e0d9c4',
                color: '#8a8270',
                fontFamily: 'inherit',
                fontSize: 10,
                letterSpacing: 2,
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Right: Preview */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f0ead4',
        }}>
          <div style={{
            width: format.width * previewScale,
            height: format.height * previewScale,
            overflow: 'hidden',
            borderRadius: 4,
            boxShadow: '0 4px 24px rgba(51,63,76,0.15)',
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
                textPosition={textPosition}
              />
            </div>
          </div>
        </div>
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
            textPosition={textPosition}
          />
        </div>
      </div>
    </div>
  );
}
