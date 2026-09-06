import { apiFetch as fetch } from '../lib/apiFetch.js';
import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { PRODUCTS, ANGLES } from '../data';

// Profile-picker dropdown for Facebook Pages the system-user token can see.
function PagePicker({ value, onChange }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/meta-pages');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'failed');
        setPages(data.pages || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const selected = pages.find(p => p.id === value);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...S.input, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', padding: '6px 10px' }}
      >
        {selected ? (
          <>
            <ProfileAvatar src={selected.picture_url} name={selected.name} />
            <span style={{ flex: 1 }}>{selected.name}</span>
          </>
        ) : (
          <span style={{ flex: 1, color: '#88857f' }}>
            {loading ? 'Loading Pages…' : error ? `Error: ${error}` : pages.length ? 'Select Facebook Page' : 'No Pages found'}
          </span>
        )}
        <span style={{ color: '#88857f', fontSize: 9 }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 51,
            background: '#fff', border: '1px solid #dedbd3', borderRadius: 4,
            maxHeight: 280, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {pages.length === 0 && (
              <div style={{ padding: 12, color: '#77746f', fontSize: 11 }}>
                {loading ? 'Loading…' : 'No Facebook Pages accessible to this token.'}
              </div>
            )}
            {pages.map(p => {
              const active = p.id === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onChange(p.id); setOpen(false); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
                    background: active ? '#1f2630' : 'transparent',
                    border: 0, color: '#171717', fontFamily: 'inherit', fontSize: 11,
                  }}
                >
                  <ProfileAvatar src={p.picture_url} name={p.name} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 9, color: '#88857f' }}>{p.username ? `@${p.username} · ` : ''}{p.id}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Shared avatar that falls back to an initial-letter circle when the image
// fails (CDN blocked, missing pic, etc).
function ProfileAvatar({ src, name, size = 24 }) {
  const [errored, setErrored] = useState(false);
  if (src && !errored) {
    return (
      <img
        src={src}
        alt={name || ''}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: '#dedbd3', color: '#171717',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 700,
    }}>{(name || '?').charAt(0).toUpperCase()}</div>
  );
}

// Profile-picker dropdown for Instagram business accounts the connected ad
// account / page tokens can see. Loads on mount; selecting a row sets the
// numeric IG user ID on the parent config.
function InstagramAccountPicker({ value, onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/meta-instagram-accounts');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'failed');
        setAccounts(data.accounts || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const selected = accounts.find(a => a.id === value);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          ...S.input,
          display: 'flex', alignItems: 'center', gap: 8,
          textAlign: 'left', cursor: 'pointer', padding: '6px 10px',
        }}
      >
        {selected ? (
          <>
            <ProfileAvatar src={selected.profile_pic_url} name={selected.username} />
            <span style={{ flex: 1 }}>@{selected.username || selected.id}</span>
          </>
        ) : (
          <span style={{ flex: 1, color: '#88857f' }}>
            {loading ? 'Loading IG accounts…' : error ? `Error: ${error}` : accounts.length ? 'Select Instagram account' : 'No IG accounts found'}
          </span>
        )}
        <span style={{ color: '#88857f', fontSize: 9 }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 51,
            background: '#fff', border: '1px solid #dedbd3', borderRadius: 4,
            maxHeight: 280, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {accounts.length === 0 && (
              <div style={{ padding: 12, color: '#77746f', fontSize: 11 }}>
                {loading ? 'Loading…' : 'No Instagram accounts linked to this ad account or page.'}
              </div>
            )}
            {accounts.map(a => {
              const active = a.id === value;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
                    background: active ? '#1f2630' : 'transparent',
                    border: 0, color: '#171717', fontFamily: 'inherit', fontSize: 11,
                  }}
                >
                  <ProfileAvatar src={a.profile_pic_url} name={a.username} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>@{a.username || '(no username)'}</div>
                    <div style={{ fontSize: 9, color: '#88857f' }}>{a.id} · {a.source}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Same-origin authenticated proxy for Drive thumbnails. The site sets
// COEP: require-corp, which blocks lh3.googleusercontent.com images, so we
// fetch via /api/drive/thumb (auth header injected by FetchInterceptor) and
// render the bytes through an object URL.
function DriveThumb({ fileId, alt, style, fallback }) {
  const [src, setSrc] = useState(null);
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const r = await fetch(`/api/drive/thumb?fileId=${encodeURIComponent(fileId)}&size=320`);
        if (!r.ok) throw new Error('thumb fetch failed');
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  if (errored || !src) return fallback || null;
  return <img src={src} alt={alt || ''} style={style} draggable={false} />;
}
import MetaTargetPicker from './MetaTargetPicker';
import CopyLibrary, { useCopyLibrary } from './CopyLibrary';
import LaunchTimeline from './LaunchTimeline';
import { ls, lsSet } from '../utils/localStorage';

const LS_CONFIG = 'howl_ugc_config';

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
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f', marginBottom: 8, display: 'block' },
  input: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none', width: '100%' },
  select: { background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717', fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', width: '100%' },
  btn: (disabled) => ({
    padding: '9px 18px', background: disabled ? '#dedbd3' : '#d84a17', border: 'none',
    color: disabled ? '#88857f' : '#fff', fontFamily: 'inherit', fontSize: 10,
    fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 4,
  }),
  ghostBtn: { padding: '8px 14px', background: 'none', border: '1px solid #dedbd3', color: '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  card: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', padding: 14, display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr) auto', gap: 16, alignItems: 'center' },
  thumb: { width: 140, height: 140, objectFit: 'cover', borderRadius: 4, background: '#f4f1ea', display: 'block' },
  thumbPlaceholder: { width: 140, height: 140, borderRadius: 4, background: '#f4f1ea', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#88857f', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 },
  fileMeta: { fontSize: 10, color: '#77746f', marginBottom: 4 },
  fileName: { fontSize: 12, fontWeight: 600, color: '#171717', wordBreak: 'break-all' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 },
  status: (kind) => ({
    fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700,
    padding: '3px 8px', borderRadius: 3, display: 'inline-block',
    color: kind === 'pushing' ? '#d84a17' : kind === 'launched' ? '#256b35' : kind === 'error' ? '#b42318' : '#77746f',
    background: kind === 'pushing' ? 'rgba(220,68,10,0.15)' : kind === 'launched' ? 'rgba(63,185,80,0.15)' : kind === 'error' ? 'rgba(248,81,73,0.15)' : '#dedbd3',
    border: `1px solid ${kind === 'pushing' ? 'rgba(220,68,10,0.4)' : kind === 'launched' ? 'rgba(63,185,80,0.4)' : kind === 'error' ? 'rgba(248,81,73,0.4)' : '#dedbd3'}`,
  }),
  err: { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#d84a17', fontSize: 10, borderRadius: 4, marginTop: 8 },
  empty: { border: '2px dashed #dedbd3', borderRadius: 6, padding: '48px', textAlign: 'center', color: '#88857f', fontSize: 11 },
  settings: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', padding: 16, marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
};

export default function UgcInboxTool() {
  const [config, setConfig] = useState(() => ls(LS_CONFIG, {
    pageId: import.meta.env.VITE_META_PAGE_ID || '',
    instagramUserId: import.meta.env.VITE_META_INSTAGRAM_USER_ID || '',
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
      // Server now returns `items` (with kind: 'single' | 'pair'). Fall back to legacy `files`.
      const incoming = d.items || (d.files || []).map(f => ({ kind: 'single', ...f }));
      setFiles(incoming);
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
      const isPair = file.kind === 'pair';
      const requestBody = {
        action: 'launch_meta_ad',
        adsetId: config.adsetId.trim(),
        pageId: config.pageId.trim(),
        instagramUserId: (config.instagramUserId || '').trim(),
        destUrl: config.destUrl.trim(),
        adName,
        headline: meta.headline?.trim() || '',
        primaryText: meta.primaryText?.trim() || '',
        creator: meta.creator?.trim() || '',
        productId: meta.productId || '',
        angleId: meta.angleId || '',
      };
      if (isPair) requestBody.pair = { feedFileId: file.feed.id, storyFileId: file.story.id };
      else requestBody.fileId = file.id;

      // Single server-side call — streams NDJSON progress per step.
      const r = await fetch('/api/drive/ugc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
              const m = evt.step.match(/^(drive_download|meta_upload|meta_thumbnail)_(feed|story)$/);
              const baseKey = m ? m[1] : evt.step;
              const role = m ? m[2] : null;
              setPerFile(prev => {
                const f = prev[file.id] || {};
                const cur = (f.steps || {})[baseKey] || {};
                let next;
                if (role) {
                  const roles = { ...(cur.roles || {}), [role]: { status: evt.status, detail: evt.detail } };
                  const statuses = Object.values(roles).map(r => r.status);
                  let combined;
                  if (statuses.includes('error')) combined = 'error';
                  else if (statuses.length === 2 && statuses.every(s => s === 'done')) combined = 'done';
                  else combined = statuses.find(s => s === 'progress' || s === 'start') || cur.status || 'start';
                  const detailStr = Object.entries(roles).map(([r, v]) => v.detail ? `${r[0]}:${v.detail}` : '').filter(Boolean).join(' / ');
                  next = { ...cur, roles, status: combined, detail: detailStr || cur.detail, error: evt.error || cur.error };
                } else {
                  next = { status: evt.status, detail: evt.detail, error: evt.error };
                }
                const steps = { ...(f.steps || {}), [baseKey]: next };
                return { ...prev, [file.id]: { ...f, steps, currentStep: baseKey } };
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
          <div className="display-lg" style={{ color: '#171717' }}>UGC Inbox</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#77746f', marginTop: 6 }}>
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
          <label style={S.label}>Facebook Page</label>
          <PagePicker value={config.pageId} onChange={(id) => updateConfig({ pageId: id })} />
        </div>
        <div>
          <label style={S.label}>Instagram Account</label>
          <InstagramAccountPicker
            value={config.instagramUserId || ''}
            onChange={(id) => updateConfig({ instagramUserId: id })}
          />
        </div>
        <div>
          <label style={S.label}>Default Creator</label>
          <input style={S.input} value={config.defaultCreator} onChange={e => updateConfig({ defaultCreator: e.target.value })} placeholder="e.g. Austin" />
        </div>
      </div>

      {globalError && <div style={S.err}>{globalError}</div>}

      {!loading && files.length === 0 && (
        <div style={{ ...S.empty, padding: '72px 32px' }}>
          <div className="display-lg" style={{ color: '#171717', marginBottom: 10 }}>The camp is quiet.</div>
          <div className="display-italic" style={{ fontSize: 14, color: '#77746f', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
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
                {file.kind === 'pair' ? (
                  <div style={{ position: 'relative', width: 140, height: 140 }}>
                    <DriveThumb
                      fileId={file.feed.id}
                      alt="feed"
                      style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, objectFit: 'cover', borderRadius: 4, border: '2px solid #fff', zIndex: 1 }}
                      fallback={<div style={{ position: 'absolute', top: 0, left: 0, width: 90, height: 90, borderRadius: 4, background: '#f4f1ea', border: '2px solid #fff', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#88857f', fontSize: 9, letterSpacing: 1 }}>1:1</div>}
                    />
                    <DriveThumb
                      fileId={file.story.id}
                      alt="story"
                      style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, objectFit: 'cover', borderRadius: 4, border: '2px solid #fff', zIndex: 2 }}
                      fallback={<div style={{ position: 'absolute', bottom: 0, right: 0, width: 60, height: 100, borderRadius: 4, background: '#f4f1ea', border: '2px solid #fff', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#88857f', fontSize: 9, letterSpacing: 1 }}>9:16</div>}
                    />
                  </div>
                ) : isVideo ? (
                  <DriveThumb
                    fileId={file.id}
                    alt={file.name}
                    style={S.thumb}
                    fallback={(
                      <div style={S.thumbPlaceholder}>
                        <div style={{ fontSize: 24 }}>▶</div>
                        <div>Video</div>
                      </div>
                    )}
                  />
                ) : thumb ? (
                  <DriveThumb
                    fileId={file.id}
                    alt={file.name}
                    style={S.thumb}
                    fallback={<div style={S.thumbPlaceholder}><div>Image</div></div>}
                  />
                ) : (
                  <div style={S.thumbPlaceholder}>
                    <div>Image</div>
                  </div>
                )}
              </div>
              <div>
                <div style={S.fileName}>
                  {file.kind === 'pair' ? (file.folderName || file.name) : file.name}
                  {file.kind === 'pair' && (
                    <span style={{ marginLeft: 10, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#256b35', fontWeight: 700, background: 'rgba(63,185,80,0.1)', padding: '2px 6px', borderRadius: 3, border: '1px solid rgba(63,185,80,0.4)' }}>
                      1:1 + 9:16 Paired
                    </span>
                  )}
                </div>
                {file.folderPath && (
                  <div style={{ fontSize: 9, color: '#d84a17', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                    📁 {file.folderPath}
                  </div>
                )}
                <div style={S.fileMeta}>
                  {file.kind === 'pair'
                    ? `${file.feed.mimeType} · ${file.feed.name} + ${file.story.name}`
                    : `${file.mimeType} · ${(parseInt(file.size || 0) / 1024 / 1024).toFixed(2)} MB · ${new Date(file.createdTime).toLocaleString()}`
                  }
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
                <div style={{ fontSize: 9, color: '#88857f', marginTop: 8, fontFamily: 'monospace' }}>
                  → {buildAdName({ creator: meta.creator, productId: meta.productId, angleId: meta.angleId })}
                </div>
                {(status === 'pushing' || status === 'error' || status === 'launched') && (
                  <LaunchTimeline stepDefs={LAUNCH_STEPS} steps={meta.steps || {}} currentStep={meta.currentStep} />
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
                    href={`https://adsmanager.facebook.com/adsmanager/manage/ads/edit?act=${(import.meta.env.VITE_META_AD_ACCOUNT_ID || '').replace('act_','')}&selected_ad_ids=${meta.adId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 9, color: '#256b35', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}
                  >
                    View in Meta →
                  </a>
                )}
                {status === 'launched' && meta.adId && (
                  <div style={{ fontSize: 9, color: '#88857f', fontFamily: 'monospace' }}>{meta.adId}</div>
                )}
                {file.webViewLink && (
                  <a href={file.webViewLink} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: '#77746f', letterSpacing: 2, textTransform: 'uppercase' }}>Open in Drive</a>
                )}
                {status !== 'launched' && status !== 'pushing' && (
                  <button
                    onClick={async () => {
                      const label = file.kind === 'pair' ? `pair "${file.folderName || file.name}" (both files)` : `"${file.name}"`;
                      if (!confirm(`Hide ${label} from the inbox? File stays in Drive.`)) return;
                      const idsToDelete = file.kind === 'pair' ? [file.feed.id, file.story.id] : [file.id];
                      try {
                        for (const fid of idsToDelete) {
                          const r = await fetch('/api/drive/ugc', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'delete', fileId: fid }),
                          });
                          const d = await r.json();
                          if (d.error) throw new Error(d.error);
                        }
                        setFiles(prev => prev.filter(f => f.id !== file.id));
                        setPerFile(prev => { const next = { ...prev }; delete next[file.id]; return next; });
                      } catch (err) {
                        updateFile(file.id, { error: `Delete failed: ${err.message}` });
                      }
                    }}
                    style={{ fontSize: 9, color: '#b42318', letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, fontWeight: 600 }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
