// Shared launcher components: Drive thumbnail proxy, profile avatar with
// fallback, Instagram account picker, Facebook page picker.
//
// All three originally lived in UgcInboxTool.jsx; lifted here so the new
// LauncherTool and the old tools can share one implementation.
import React, { useState, useEffect } from 'react';

const INPUT_STYLE = {
  background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717',
  fontFamily: 'inherit', fontSize: 11, padding: '8px 10px', borderRadius: 4,
  outline: 'none', width: '100%',
};

// Same-origin authenticated proxy for Drive thumbnails. The site sets
// COEP: require-corp, which blocks lh3.googleusercontent.com images, so we
// fetch via /api/drive/thumb (auth header injected by FetchInterceptor) and
// render the bytes through an object URL.
export function DriveThumb({ fileId, alt, style, fallback }) {
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

// Avatar that falls back to an initial-letter circle when the image fails
// (CDN blocked, missing pic, etc).
export function ProfileAvatar({ src, name, size = 24 }) {
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

export function PagePicker({ value, onChange }) {
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
        style={{ ...INPUT_STYLE, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', padding: '6px 10px' }}
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
                  key={p.id} type="button"
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

export function InstagramAccountPicker({ value, onChange }) {
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
        style={{ ...INPUT_STYLE, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer', padding: '6px 10px' }}
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
                  key={a.id} type="button"
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
