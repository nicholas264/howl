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
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f' },
  filters: { display: 'flex', gap: 6 },
  chip: (active) => ({
    padding: '6px 14px', borderRadius: 4, fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
    fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`,
    background: active ? 'rgba(220,68,10,0.15)' : '#f4f1ea',
    color: active ? '#d84a17' : '#77746f',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 },
  card: { border: '1px solid #dedbd3', borderRadius: 6, background: '#fff', overflow: 'hidden' },
  thumb: { width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f4f1ea' },
  info: { padding: '10px 12px' },
  name: { fontSize: 10, color: '#171717', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 },
  meta: { fontSize: 9, color: '#88857f', marginBottom: 8 },
  badge: (status) => {
    if (status === 'pushed') return { background: 'rgba(63,185,80,0.15)', color: '#256b35', border: '1px solid rgba(63,185,80,0.4)' };
    if (status === 'error') return { background: 'rgba(248,81,73,0.15)', color: '#b42318', border: '1px solid rgba(248,81,73,0.4)' };
    return { background: '#dedbd3', color: '#77746f', border: '1px solid #dedbd3' };
  },
  badgeBase: { display: 'inline-block', padding: '3px 8px', borderRadius: 3, fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 },
  empty: { border: '2px dashed #dedbd3', borderRadius: 6, padding: '48px', textAlign: 'center', color: '#88857f', fontSize: 11 },
  videoThumb: { width: '100%', aspectRatio: '1', background: '#f4f1ea', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #dedbd3' },
  carouselThumb: { width: '100%', aspectRatio: '1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#f4f1ea', padding: 2 },
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
        <div className="display-lg" style={{ color: '#171717' }}>Gallery</div>
        <div className="display-italic" style={{ fontSize: 14, color: '#77746f', marginTop: 6 }}>
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
                    <span style={{ fontSize: 28, color: '#88857f' }}>&#9654;</span>
                    <span style={{ fontSize: 8, color: '#88857f', letterSpacing: 2, marginTop: 6 }}>VIDEO</span>
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
                    <span style={{ fontSize: 8, color: '#88857f', marginLeft: 6 }}>
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
