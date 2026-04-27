import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { PRODUCTS, ANGLES } from '../data';
import MetaTargetPicker from './MetaTargetPicker';
import CopyLibrary, { useCopyLibrary } from './CopyLibrary';

const LS_CONFIG = 'howl_ugc_config';

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const LAUNCH_STEPS = [
  { key: 'drive_download', label: 'Download' },
  { key: 'meta_upload',    label: 'Upload' },
  { key: 'meta_thumbnail', label: 'Thumbnail' },
  { key: 'meta_creative',  label: 'Creative' },
  { key: 'meta_ad',        label: 'Ad' },
  { key: 'drive_move',     label: 'File' },
  { key: 'db_log',         label: 'Log' },
];

function buildAdName({ creator, productId, angleId }) {
  const product = PRODUCTS.find(p => p.id === productId)?.name || productId || 'product';
  const angle = ANGLES.find(a => a.id === angleId)?.label || angleId || 'angle';
  const c = (creator || 'creator').trim().replace(/\s+/g, '-');
  return `HOWL | UGC | ${c} | ${product} | ${angle} | ${todayISO()}`;
}

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1200 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 8, display: 'block' },
  input: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  select: { background: '#1c2330', border: '1px solid #2a3441', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', width: '100%' },
  btn: (disabled) => ({
    padding: '9px 18px', background: disabled ? '#2a3441' : '#DC440A', border: 'none',
    color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  ghostBtn: { padding: '8px 14px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  card: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', padding: 14, display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr) auto', gap: 16, alignItems: 'center' },
  thumb: { width: 140, height: 140, objectFit: 'cover', borderRadius: 4, background: '#1c2330', display: 'block' },
  thumbPlaceholder: { width: 140, height: 140, borderRadius: 4, background: '#1c2330', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#6e7681', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 },
  fileMeta: { fontSize: 10, color: '#8b949e', marginBottom: 4 },
  fileName: { fontSize: 12, fontWeight: 600, color: '#f0f4f8', wordBreak: 'break-all' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 },
  status: (kind) => ({
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700,
    padding: '3px 8px', borderRadius: 3, display: 'inline-block',
    color: kind === 'pushing' ? '#DC440A' : kind === 'launched' ? '#3fb950' : kind === 'error' ? '#f85149' : '#8b949e',
    background: kind === 'pushing' ? 'rgba(220,68,10,0.15)' : kind === 'launched' ? 'rgba(63,185,80,0.15)' : kind === 'error' ? 'rgba(248,81,73,0.15)' : '#2a3441',
    border: `1px solid ${kind === 'pushing' ? 'rgba(220,68,10,0.4)' : kind === 'launched' ? 'rgba(63,185,80,0.4)' : kind === 'error' ? 'rgba(248,81,73,0.4)' : '#2a3441'}`,
  }),
  err: { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 10, borderRadius: 4, marginTop: 8 },
  empty: { border: '2px dashed #2a3441', borderRadius: 6, padding: '48px', textAlign: 'center', color: '#6e7681', fontSize: 11 },
  settings: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', padding: 16, marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
};

function LaunchTimeline({ steps, currentStep }) {
  return (
    <div style={{ marginTop: 12, padding: '14px 4px 8px', display: 'flex', alignItems: 'flex-start', gap: 0, position: 'relative' }}>
      {LAUNCH_STEPS.map((s, idx) => {
        const st = steps[s.key];
        const status = st?.status || 'idle';
        const isCurrent = currentStep === s.key && status !== 'done' && status !== 'error';
        const done = status === 'done';
        const err = status === 'error';
        const color = err ? '#f85149' : done ? '#3fb950' : isCurrent ? '#DC440A' : '#2a3441';
        const nextDone = steps[LAUNCH_STEPS[idx + 1]?.key]?.status === 'done';
        const lineColor = done ? (nextDone ? '#3fb950' : '#DC440A') : '#2a3441';
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
              <div
                style={{
                  width: 14, height: 14, borderRadius: '50%', background: color,
                  boxShadow: isCurrent ? `0 0 0 3px rgba(220,68,10,0.2), 0 0 12px rgba(220,68,10,0.5)` : 'none',
                  animation: isCurrent ? 'pulseDot 1.2s ease-in-out infinite' : 'none',
                  border: status === 'idle' ? '2px solid #2a3441' : 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: isCurrent ? '#f0f4f8' : err ? '#f85149' : done ? '#8b949e' : '#6e7681', fontWeight: isCurrent ? 700 : 500, whiteSpace: 'nowrap' }}>
                {s.label}
              </div>
              {st?.detail && (
                <div style={{ fontSize: 9, color: '#6e7681', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{st.detail}</div>
              )}
            </div>
            {idx < LAUNCH_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: lineColor, marginTop: 6, minWidth: 12, transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        );
      })}
      <style>{`@keyframes pulseDot { 0%,100% { transform: scale(1); } 50% { transform: scale(1.2); } }`}</style>
    </div>
  );
}

export default function UgcInboxTool() {
  const [config, setConfig] = useState(() => ls(LS_CONFIG, {
    pageId: '404789730317028',
    destUrl: '',
    adsetId: '',
    defaultCreator: '',
    defaultProduct: PRODUCTS[0]?.id || '',
    defaultAngle: ANGLES[0]?.id || '',
  }));
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [perFile, setPerFile] = useState({}); // fileId → { creator, productId, angleId, headline, primaryText, status, error, adId }
  const [focusedFileId, setFocusedFileId] = useState(null); // for "Use" action from library
  const library = useCopyLibrary();

  const updateConfig = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    lsSet(LS_CONFIG, next);
  };

  const updateFile = (fileId, patch) => {
    setPerFile(prev => ({ ...prev, [fileId]: { ...prev[fileId], ...patch } }));
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setGlobalError('');
    try {
      const r = await fetch('/api/drive/ugc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setFiles(d.files || []);
      // Seed per-file defaults for new files.
      // Creator auto-extracted: prefer top folder name, else filename prefix before "_".
      setPerFile(prev => {
        const next = { ...prev };
        for (const f of (d.files || [])) {
          if (!next[f.id]) {
            const topFolder = (f.folderPath || '').split(' / ')[0] || '';
            const filePrefix = (f.name || '').split(/[_\-\s]/)[0] || '';
            const autoCreator = topFolder || filePrefix || config.defaultCreator;
            next[f.id] = {
              creator: autoCreator,
              productId: config.defaultProduct,
              angleId: config.defaultAngle,
              headline: '',
              primaryText: '',
              status: 'pending',
            };
          }
        }
        return next;
      });
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setLoading(false);
    }
  }, [config.defaultCreator, config.defaultProduct, config.defaultAngle]);

  useEffect(() => { refresh(); }, []); // initial load

  const launch = async (file) => {
    const meta = perFile[file.id] || {};
    if (!config.adsetId.trim()) { setGlobalError('Ad set ID required in settings.'); return; }
    if (!config.destUrl.trim()) { setGlobalError('Destination URL required in settings.'); return; }
    if (!meta.creator?.trim()) { updateFile(file.id, { status: 'error', error: 'Creator required' }); return; }
    if (!meta.headline?.trim() && !meta.primaryText?.trim()) { updateFile(file.id, { status: 'error', error: 'Headline or primary text required' }); return; }

    const adName = buildAdName({ creator: meta.creator, productId: meta.productId, angleId: meta.angleId });
    updateFile(file.id, { status: 'pushing', error: null });

    // Reset timeline
    updateFile(file.id, { status: 'pushing', error: null, steps: {}, currentStep: null });

    try {
      // Single server-side call — streams NDJSON progress per step.
      const r = await fetch('/api/drive/ugc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'launch_meta_ad',
          fileId: file.id,
          adsetId: config.adsetId.trim(),
          pageId: config.pageId.trim(),
          destUrl: config.destUrl.trim(),
          adName,
          headline: meta.headline?.trim() || '',
          primaryText: meta.primaryText?.trim() || '',
          creator: meta.creator?.trim() || '',
          productId: meta.productId || '',
          angleId: meta.angleId || '',
        }),
      });

      if (!r.body) throw new Error('No response stream');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalEvent = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.done) { finalEvent = evt; continue; }
            if (evt.step) {
              setPerFile(prev => {
                const f = prev[file.id] || {};
                const steps = { ...(f.steps || {}), [evt.step]: { status: evt.status, detail: evt.detail, error: evt.error } };
                return { ...prev, [file.id]: { ...f, steps, currentStep: evt.step } };
              });
            }
          } catch {}
        }
      }

      if (!finalEvent) throw new Error('Stream ended without completion');
      if (finalEvent.error) throw new Error(finalEvent.error);

      updateFile(file.id, { status: 'launched', adId: finalEvent.adId });
    } catch (err) {
      updateFile(file.id, { status: 'error', error: err.message });
    }
  };

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Launch</div>
          <div className="display-lg" style={{ color: '#f0f4f8' }}>UGC Inbox</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', marginTop: 6 }}>
            Files waiting in Drive — launch to Meta and we'll file them away.
          </div>
        </div>
        <button style={S.ghostBtn} onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <MetaTargetPicker
          selectedAdsetId={config.adsetId}
          onAdsetChange={(id) => updateConfig({ adsetId: id })}
        />
      </div>

      <CopyLibrary
        library={library}
        onUse={focusedFileId ? (v) => {
          updateFile(focusedFileId, { headline: v.headline || '', primaryText: v.primaryText || '' });
        } : null}
      />

      <div style={S.settings}>
        <div>
          <label style={S.label}>Destination URL</label>
          <input style={S.input} value={config.destUrl} onChange={e => updateConfig({ destUrl: e.target.value })} placeholder="https://howlcampfires.com/..." />
        </div>
        <div>
          <label style={S.label}>Page ID</label>
          <input style={S.input} value={config.pageId} onChange={e => updateConfig({ pageId: e.target.value })} />
        </div>
        <div>
          <label style={S.label}>Default Creator</label>
          <input style={S.input} value={config.defaultCreator} onChange={e => updateConfig({ defaultCreator: e.target.value })} placeholder="e.g. Austin" />
        </div>
      </div>

      {globalError && <div style={S.err}>{globalError}</div>}

      {!loading && files.length === 0 && (
        <div style={{ ...S.empty, padding: '72px 32px' }}>
          <div className="display-lg" style={{ color: '#f0f4f8', marginBottom: 10 }}>The camp is quiet.</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
            When your team drops assets in the Drive inbox, they'll appear here ready to launch.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {files.map(file => {
          const meta = perFile[file.id] || {};
          const status = meta.status || 'pending';
          const isVideo = (file.mimeType || '').startsWith('video/');
          const thumb = file.thumbnailLink;
          return (
            <div key={file.id} style={S.card}>
              <div>
                {isVideo ? (
                  <div style={S.thumbPlaceholder}>
                    <div style={{ fontSize: 24 }}>▶</div>
                    <div>Video</div>
                  </div>
                ) : thumb ? (
                  <img
                    src={thumb}
                    alt={file.name}
                    style={S.thumb}
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div style={S.thumbPlaceholder}>
                    <div>Image</div>
                  </div>
                )}
              </div>
              <div>
                <div style={S.fileName}>{file.name}</div>
                {file.folderPath && (
                  <div style={{ fontSize: 9, color: '#DC440A', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                    📁 {file.folderPath}
                  </div>
                )}
                <div style={S.fileMeta}>
                  {file.mimeType} · {(parseInt(file.size || 0) / 1024 / 1024).toFixed(2)} MB · {new Date(file.createdTime).toLocaleString()}
                </div>
                <div style={S.row}>
                  <div>
                    <label style={S.label}>Creator</label>
                    <input style={S.input} value={meta.creator || ''} onChange={e => updateFile(file.id, { creator: e.target.value })} placeholder="name" />
                  </div>
                  <div>
                    <label style={S.label}>Product</label>
                    <select style={S.select} value={meta.productId || ''} onChange={e => updateFile(file.id, { productId: e.target.value })}>
                      {PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>Angle</label>
                    <select style={S.select} value={meta.angleId || ''} onChange={e => updateFile(file.id, { angleId: e.target.value })}>
                      {ANGLES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                  <div>
                    <label style={S.label}>Headline</label>
                    <input
                      style={S.input}
                      value={meta.headline || ''}
                      placeholder="6 words max"
                      onFocus={() => setFocusedFileId(file.id)}
                      onChange={e => updateFile(file.id, { headline: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Primary Text</label>
                    <textarea
                      style={{ ...S.input, minHeight: 54, resize: 'vertical', fontFamily: 'inherit' }}
                      value={meta.primaryText || ''}
                      placeholder="2-3 sentences"
                      onFocus={() => setFocusedFileId(file.id)}
                      onChange={e => updateFile(file.id, { primaryText: e.target.value })}
                    />
                  </div>
                </div>
                {library.variants.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <label style={S.label}>Apply saved variant</label>
                    <select
                      style={S.select}
                      value=""
                      onChange={e => {
                        const v = library.variants.find(x => String(x.id) === e.target.value);
                        if (v) updateFile(file.id, { headline: v.headline || '', primaryText: v.primaryText || '' });
                      }}
                    >
                      <option value="">— Pick from {library.variants.length} saved variant{library.variants.length === 1 ? '' : 's'} —</option>
                      {library.variants.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.label || v.headline || v.primaryText.slice(0, 60)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ fontSize: 9, color: '#6e7681', marginTop: 8, fontFamily: 'monospace' }}>
                  → {buildAdName({ creator: meta.creator, productId: meta.productId, angleId: meta.angleId })}
                </div>
                {(status === 'pushing' || status === 'error' || status === 'launched') && (
                  <LaunchTimeline steps={meta.steps || {}} currentStep={meta.currentStep} />
                )}
                {meta.error && <div style={S.err}>{meta.error}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                <span style={S.status(status)}>{status === 'launched' ? '✓ Launched' : status}</span>
                <button
                  style={S.btn(status === 'pushing' || status === 'launched')}
                  disabled={status === 'pushing' || status === 'launched'}
                  onClick={() => launch(file)}
                >
                  {status === 'pushing' ? 'Pushing…' : status === 'launched' ? 'Launched ✓' : 'Launch'}
                </button>
                {status === 'launched' && meta.adId && (
                  <a
                    href={`https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=${(import.meta.env.VITE_META_AD_ACCOUNT_ID || '3139414606311974').replace('act_','')}&selected_ad_ids=${meta.adId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 9, color: '#3fb950', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}
                  >
                    View in Meta →
                  </a>
                )}
                {status === 'launched' && meta.adId && (
                  <div style={{ fontSize: 9, color: '#6e7681', fontFamily: 'monospace' }}>{meta.adId}</div>
                )}
                {file.webViewLink && (
                  <a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: '#8b949e', letterSpacing: 2, textTransform: 'uppercase' }}>Open in Drive</a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
