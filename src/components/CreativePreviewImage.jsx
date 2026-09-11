import React, { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';

// Share in-flight requests between a card and its detail dialog. Keep the cache
// bounded and short-lived because Meta poster URLs expire.
const requests = new Map();
let active = 0;
const waiting = [];
async function resolvePreview(groupKey) {
  const cached = requests.get(groupKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.promise;
  const promise = (async () => {
    if (active >= 3) await new Promise(resolve => waiting.push(resolve));
    active++;
    try {
      return await apiJson('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_creative_preview', groupKey }) }, 'Preview unavailable');
    } finally { active--; waiting.shift()?.(); }
  })();
  if (requests.size >= 500) requests.delete(requests.keys().next().value);
  requests.set(groupKey, { at: Date.now(), promise });
  return promise;
}

export default function CreativePreviewImage(props) {
  return <PreviewImage key={`${props.groupKey || ''}:${props.src || ''}`} {...props} />;
}

function PreviewImage({ groupKey, src, alt = '', className = '', loading = 'lazy' }) {
  const [resolved, setResolved] = useState(null);
  const [needsPreview, setNeedsPreview] = useState(!src);
  const [failed, setFailed] = useState(false);
  const [limited, setLimited] = useState(false);
  useEffect(() => {
    if (!needsPreview || !groupKey) return;
    let live = true;
    resolvePreview(groupKey).then(result => {
      if (live && result.previewUrl) { setResolved(result.previewUrl); setFailed(false); }
    }).catch(() => { if (live) setLimited(true); });
    return () => { live = false; };
  }, [needsPreview, groupKey]);
  const source = resolved || src;
  if (failed || !source) return <span className="ca-no-preview">{limited ? 'Preview unavailable' : 'Loading preview…'}</span>;
  return <img className={`${className}${limited ? ' ca-preview-limited' : ''}`} src={source} alt={alt} loading={loading}
    title={limited ? 'Only a low-resolution preview is available' : undefined}
    onLoad={event => {
      const small = Math.min(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight) < 320;
      if (small && !resolved) setNeedsPreview(true);
      setLimited(small);
    }}
    onError={() => { if (!resolved) { setFailed(true); setNeedsPreview(true); } else { setFailed(true); setLimited(true); } }} />;
}
