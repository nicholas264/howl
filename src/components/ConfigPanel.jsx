import { useState } from 'react';
import { PRODUCTS, ANGLES, AVATARS, COPY_COUNT_OPTIONS } from '../data';

export default function ConfigPanel({
  selectedProducts, toggleProduct,
  selectedAngles, toggleAngle,
  selectedAvatar, setSelectedAvatar,
  copyCount, setCopyCount,
  customContext, setCustomContext,
  productPhoto, onPhotoChange,
  savedImages, onRemoveSavedImage,
  loading, error, generate,
}) {
  const [dragging, setDragging] = useState(false);

  const processFile = (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('File must be under 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Please upload a JPEG or PNG image');
      return;
    }

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
        onPhotoChange(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e) => processFile(e.target.files?.[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragging(false);
  };

  return (
    <div className="body">
      {error && <div className="err">{error}</div>}

      <div className="sect">
        <div className="slbl">Products</div>
        <div className="chips">
          {PRODUCTS.map((p) => (
            <div key={p.id} className={`chip ${selectedProducts.includes(p.id) ? "on" : ""}`} onClick={() => toggleProduct(p.id)}>
              <strong>{p.name}</strong> — {p.price}
              <span className="chip-sub">{p.subtitle}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Creative Angles (from 938 reviews)</div>
        <div className="agrid">
          {ANGLES.map((a) => (
            <div key={a.id} className={`acard ${selectedAngles.includes(a.id) ? "on" : ""}`} onClick={() => toggleAngle(a.id)}>
              <div className="em">{a.icon}</div>
              <div className="nm">{a.label}</div>
              <div className="ds">{a.desc}</div>
              <div className="fn">{a.funnel}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Target Avatar (optional)</div>
        <div className="avgrid">
          <div className={`avcard ${selectedAvatar === null ? "on" : ""}`} onClick={() => setSelectedAvatar(null)}>
            All audiences
            <div className="avd">No specific persona targeting</div>
          </div>
          {AVATARS.map((a) => (
            <div key={a.id} className={`avcard ${selectedAvatar === a.id ? "on" : ""}`} onClick={() => setSelectedAvatar(a.id)}>
              {a.label}
              <div className="avd">{a.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Variations</div>
        <div className="chips">
          {COPY_COUNT_OPTIONS.map((n) => (
            <button key={n} className={`cntbtn ${copyCount === n ? "on" : ""}`} onClick={() => setCopyCount(n)}>{n}</button>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="slbl">Product Photo (optional — for static ad export)</div>
        {productPhoto ? (
          <div className="photo-upload has-photo">
            <img src={productPhoto} alt="Product" className="photo-preview" />
            <br />
            <button className="photo-remove" onClick={() => onPhotoChange(null)}>Remove Photo</button>
          </div>
        ) : (
          <label
            className={`photo-upload ${dragging ? 'dragging' : ''}`}
            style={{ display: 'block' }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input type="file" accept="image/jpeg,image/png" onChange={handleFileSelect} style={{ display: 'none' }} />
            <div style={{ fontSize: 11, color: dragging ? '#d94f2b' : '#555' }}>
              {dragging ? 'Drop image here' : 'Drag & drop product photo here, or click to browse'}
            </div>
            <div style={{ fontSize: 9, color: '#333', marginTop: 4 }}>JPEG/PNG, max 10MB</div>
          </label>
        )}

        {savedImages && savedImages.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#8a8270', marginBottom: 8 }}>
              Saved Images
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {savedImages.map((img) => (
                <div
                  key={img.id}
                  style={{
                    position: 'relative',
                    width: 72,
                    height: 72,
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: productPhoto === img.url ? '2px solid #DC440A' : '2px solid #e0d9c4',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onClick={() => onPhotoChange(img.url)}
                  title="Click to use this image"
                >
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveSavedImage(img.id); }}
                    title="Remove from library"
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 16,
                      height: 16,
                      background: 'rgba(51,63,76,0.75)',
                      border: 'none',
                      borderRadius: 2,
                      color: '#fff',
                      fontSize: 9,
                      lineHeight: '16px',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sect">
        <div className="slbl">Additional Context (optional)</div>
        <textarea className="ta" placeholder="e.g. We're running a Memorial Day sale... Focus on the R4 MKii upgrade... Target ski bums in Colorado..." value={customContext} onChange={(e) => setCustomContext(e.target.value)} />
      </div>

      <button className="gobtn" onClick={generate} disabled={loading || selectedProducts.length === 0 || selectedAngles.length === 0}>
        {loading ? "Generating..." : `Generate ${copyCount} Variations`}
      </button>
      {loading && <div className="ldg"><span className="spin" /> Claude is writing your ad copy using real customer language...</div>}
    </div>
  );
}
