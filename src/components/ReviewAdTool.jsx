import { useState, useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { FORMATS } from '../brand';
import UGCTemplate from '../templates/UGCTemplate';

const SCALE_BASE = 0.42;

export default function ReviewAdTool() {
  const [quote, setQuote] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [formatKey, setFormatKey] = useState('square');
  const [exporting, setExporting] = useState(false);

  const captureRef = useRef(null);
  const format = FORMATS[formatKey];

  const maxPreviewH = typeof window !== 'undefined' ? window.innerHeight - 160 : 700;
  const maxPreviewW = typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.55, 560) : 500;
  const scaleByH = maxPreviewH / format.height;
  const scaleByW = maxPreviewW / format.width;
  const previewScale = Math.min(scaleByH, scaleByW, SCALE_BASE);

  const variation = { headline: quote || 'Paste a review to get started.' };
  const attribution = reviewer.trim() ? reviewer.trim() : undefined;

  const handleExport = useCallback(async () => {
    if (!quote.trim() || !captureRef.current) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const el = captureRef.current;
      await toPng(el, { width: format.width, height: format.height, pixelRatio: 1 });
      const dataUrl = await toPng(el, { width: format.width, height: format.height, pixelRatio: 1 });
      const link = document.createElement('a');
      link.download = `howl_review_${format.label.replace(':', 'x')}_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [quote, format]);

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 100px)' }}>

      {/* Left: Controls */}
      <div style={{
        width: 300, flexShrink: 0, padding: 32,
        borderRight: '1px solid #e0d9c4',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>

        <div>
          <div style={labelStyle}>Review Quote</div>
          <textarea
            value={quote}
            onChange={e => setQuote(e.target.value)}
            placeholder="Paste a customer review here..."
            rows={7}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px',
              border: '1px solid #e0d9c4', borderRadius: 4,
              background: '#fff', color: '#333F4C',
              fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5,
              resize: 'vertical', outline: 'none',
            }}
          />
        </div>

        <div>
          <div style={labelStyle}>Reviewer Name <span style={{ color: '#b0a898', fontWeight: 400 }}>(optional)</span></div>
          <input
            type="text"
            value={reviewer}
            onChange={e => setReviewer(e.target.value)}
            placeholder="e.g. Sarah M. — Amazon"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px',
              border: '1px solid #e0d9c4', borderRadius: 4,
              background: '#fff', color: '#333F4C',
              fontFamily: 'inherit', fontSize: 12, outline: 'none',
            }}
          />
        </div>

        <div>
          <div style={labelStyle}>Format</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(FORMATS).map(([key, f]) => (
              <button key={key} onClick={() => setFormatKey(key)} style={{
                flex: 1, padding: '8px 0',
                border: `1px solid ${formatKey === key ? '#DC440A' : '#e0d9c4'}`,
                background: formatKey === key ? '#fef8f0' : '#fff',
                color: formatKey === key ? '#DC440A' : '#8a8270',
                fontFamily: 'inherit', fontSize: 11, letterSpacing: 1,
                textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4,
              }}>{f.label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <button
            onClick={handleExport}
            disabled={exporting || !quote.trim()}
            style={{
              width: '100%', padding: '13px 0',
              background: (exporting || !quote.trim()) ? '#e0d9c4' : '#DC440A',
              border: 'none', borderRadius: 4,
              color: (exporting || !quote.trim()) ? '#a09880' : '#fff',
              fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
              letterSpacing: 2, textTransform: 'uppercase',
              cursor: (exporting || !quote.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? 'Exporting...' : 'Download PNG'}
          </button>
        </div>
      </div>

      {/* Right: Preview */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f0ead4', padding: 40,
      }}>
        <div style={{
          width: format.width * previewScale,
          height: format.height * previewScale,
          overflow: 'hidden', borderRadius: 4,
          boxShadow: '0 4px 32px rgba(51,63,76,0.18)',
        }}>
          <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: format.width, height: format.height }}>
            <UGCTemplate
              variation={variation}
              format={formatKey}
              dimensions={format}
              attribution={attribution}
            />
          </div>
        </div>
      </div>

      {/* Hidden capture div */}
      <div style={{ position: 'fixed', left: -99999, top: 0 }}>
        <div ref={captureRef} style={{ width: format.width, height: format.height }}>
          <UGCTemplate
            variation={variation}
            format={formatKey}
            dimensions={format}
            attribution={attribution}
          />
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
  color: '#8a8270', marginBottom: 8, fontWeight: 600,
};
