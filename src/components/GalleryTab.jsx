import React, { useState } from 'react';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pushed', label: 'Pushed' },
  { value: 'error', label: 'Failed' },
];

const S = {
  wrap: { padding: '28px 36px', maxWidth: 1200 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e' },
  filters: { display: 'flex', gap: 6 },
  chip: (active) => ({
    padding: '6px 14px', borderRadius: 4, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#DC440A' : '#2a3441'}`,
    background: active ? 'rgba(220,68,10,0.15)' : '#1c2330',
    color: active ? '#DC440A' : '#8b949e',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 },
  card: { border: '1px solid #2a3441', borderRadius: 6, background: '#161b22', overflow: 'hidden' },
  thumb: { width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#1c2330' },
  info: { padding: '10px 12px' },
  name: { fontSize: 10, color: '#f0f4f8', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 },
  meta: { fontSize: 9, color: '#6e7681', marginBottom: 8 },
  badge: (status) => {
    if (status === 'pushed') return { background: 'rgba(63,185,80,0.15)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)' };
    if (status === 'error') return { background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.4)' };
    return { background: '#2a3441', color: '#8b949e', border: '1px solid #2a3441' };
  },
  badgeBase: { display: 'inline-block', padding: '3px 8px', borderRadius: 3, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 },
  empty: { border: '2px dashed #2a3441', borderRadius: 6, padding: '48px', textAlign: 'center', color: '#6e7681', fontSize: 11 },
  videoThumb: { width: '100%', aspectRatio: '1', background: '#1c2330', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #2a3441' },
  carouselThumb: { width: '100%', aspectRatio: '1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#1c2330', padding: 2 },
};

function statusLabel(status) {
  if (status === 'pushed') return 'Pushed';
  if (status === 'error') return 'Failed';
  return 'Draft';
}

function formatDate(id) {
  try {
    return new Date(id).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function typeLabel(item) {
  if (item.type === 'video') return 'Video';
  if (item.type === 'carousel') return `Carousel (${item.cards?.length || 0})`;
  if (item.storyUrl) return 'Static 1:1 + 9:16';
  return 'Static 1:1';
}

function getStatus(item) {
  return item.metaStatus || 'draft';
}

export default function GalleryTab({ cart }) {
  const [filter, setFilter] = useState('all');

  const filtered = cart.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'draft') return !item.metaStatus;
    return item.metaStatus === filter;
  });

  const counts = {
    all: cart.length,
    draft: cart.filter(i => !i.metaStatus).length,
    pushed: cart.filter(i => i.metaStatus === 'pushed').length,
    error: cart.filter(i => i.metaStatus === 'error').length,
  };

  return (
    <div style={S.wrap}>
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Launch</div>
        <div className="display-lg" style={{ color: '#f0f4f8' }}>Gallery</div>
        <div className="display-italic" style={{ fontSize: 14, color: '#8b949e', marginTop: 6 }}>
          Everything in your publish cart — drafts, pushed, and failures.
        </div>
      </div>
      <div style={S.header}>
        <span style={S.label}>{cart.length} creatives</span>
        <div style={S.filters}>
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)} style={S.chip(filter === f.value)}>
              {f.label} {counts[f.value] > 0 && `(${counts[f.value]})`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={S.empty}>
          {cart.length === 0
            ? 'No creatives yet. Create ads in Image Ads, Review Ads, or Video Ads, then add them to cart.'
            : `No ${filter === 'draft' ? 'draft' : filter === 'pushed' ? 'pushed' : 'failed'} creatives.`
          }
        </div>
      ) : (
        <div style={S.grid}>
          {filtered.map(item => {
            const status = getStatus(item);
            return (
              <div key={item.id} style={S.card}>
                {/* Thumbnail */}
                {item.type === 'video' ? (
                  <div style={S.videoThumb}>
                    <span style={{ fontSize: 28, color: '#6e7681' }}>&#9654;</span>
                    <span style={{ fontSize: 8, color: '#6e7681', letterSpacing: 2, marginTop: 6 }}>VIDEO</span>
                  </div>
                ) : item.type === 'carousel' && item.cards ? (
                  <div style={S.carouselThumb}>
                    {item.cards.slice(0, 4).map((card, i) => (
                      <img key={i} src={card.squareUrl || card.imageBase64} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 2 }} />
                    ))}
                  </div>
                ) : (
                  <img src={item.squareUrl || item.url} alt="" loading="lazy" style={S.thumb} />
                )}

                {/* Info */}
                <div style={S.info}>
                  <div style={S.name}>{item.name || 'Untitled'}</div>
                  <div style={S.meta}>
                    {typeLabel(item)} &middot; {formatDate(item.id)}
                  </div>
                  <span style={{ ...S.badgeBase, ...S.badge(status) }}>
                    {statusLabel(status)}
                  </span>
                  {item.metaPushedAt && status === 'pushed' && (
                    <span style={{ fontSize: 8, color: '#6e7681', marginLeft: 6 }}>
                      {formatDate(item.metaPushedAt)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
