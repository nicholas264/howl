import crypto from 'node:crypto';

export async function ensureLooxReviewTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS loox_reviews (
      id             BIGSERIAL PRIMARY KEY,
      source_key     TEXT NOT NULL UNIQUE,
      rating         INTEGER NOT NULL DEFAULT 5,
      author         TEXT,
      email          TEXT,
      body           TEXT NOT NULL,
      edited_body    TEXT,
      product_handle TEXT,
      product_id     TEXT,
      product_title  TEXT,
      product_url    TEXT,
      photo_url      TEXT,
      order_id       TEXT,
      review_date    TIMESTAMPTZ,
      status         TEXT NOT NULL DEFAULT 'new',
      ad_status      TEXT NOT NULL DEFAULT 'queued',
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_loox_reviews_date ON loox_reviews(review_date DESC NULLS LAST, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loox_reviews_rating ON loox_reviews(rating)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loox_reviews_product_handle ON loox_reviews(product_handle)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_loox_reviews_ad_status ON loox_reviews(ad_status)`;
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function text(value, max = 5000) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max) || null;
}

function normalizeHandle(value) {
  const raw = text(value, 500);
  if (!raw) return null;
  let candidate = raw;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('products');
    candidate = idx >= 0 ? parts[idx + 1] || raw : parts[parts.length - 1] || raw;
  } catch {}
  return candidate
    .toLowerCase()
    .replace(/^the-howl-/, '')
    .replace(/^howl-/, '')
    .replace(/[^a-z0-9-]/g, '')
    || null;
}

function parseDate(value) {
  const raw = text(value, 100);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeLooxReviewPayload(payload = {}) {
  const review = payload.review || payload.data || payload;
  const body = text(firstValue(review, ['review_body', 'reviewBody', 'body', 'text', 'review', 'Review body']), 5000);
  if (!body) throw new Error('review body required');

  const rating = Math.max(1, Math.min(5, parseInt(firstValue(review, ['rating', 'Rating']) || '5', 10) || 5));
  const author = text(firstValue(review, ['author', 'Author', 'nickname', 'name', 'customer_name']), 240);
  const email = text(firstValue(review, ['email', 'Email', 'customer_email']), 320);
  const productUrl = text(firstValue(review, ['product_url', 'productUrl', 'Product URL']), 1000);
  const productHandle = normalizeHandle(firstValue(review, ['product_handle', 'productHandle', 'handle']) || productUrl);
  const productId = text(firstValue(review, ['product_id', 'productId', 'Product ID']), 240);
  const productTitle = text(firstValue(review, ['product_title', 'productTitle', 'Product title']), 500);
  const orderId = text(firstValue(review, ['order_id', 'orderId', 'Order ID']), 240);
  const photoUrl = text(firstValue(review, ['photo_url', 'photoUrl', 'Photo URL', 'image_url', 'imageUrl']), 1000);
  const reviewDate = parseDate(firstValue(review, ['review_date', 'reviewDate', 'date', 'created_at', 'createdAt', 'Review date']));
  const sourceId = text(firstValue(review, ['id', 'review_id', 'reviewId', 'loox_review_id']), 240);
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({ sourceId, orderId, productId, author, body, reviewDate }))
    .digest('hex')
    .slice(0, 32);
  const sourceKey = sourceId ? `loox:${sourceId}` : `loox:fingerprint:${fingerprint}`;

  return {
    sourceKey,
    rating,
    author,
    email,
    body,
    productHandle,
    productId,
    productTitle,
    productUrl,
    photoUrl,
    orderId,
    reviewDate,
    adStatus: rating === 5 ? 'queued' : 'hold',
    sourcePayload: payload,
  };
}

export function toReviewAdRow(row) {
  const handle = normalizeHandle(row.product_handle || row.product_url || row.product_title) || '';
  return {
    id: `loox_${row.id}`,
    looxId: row.id,
    source: 'loox',
    rating: Number(row.rating) || 5,
    quote: row.edited_body || row.body,
    originalQuote: row.body,
    nickname: row.author || 'Verified HOWL Customer',
    handle,
    productTitle: row.product_title || null,
    productUrl: row.product_url || null,
    photoUrl: row.photo_url || null,
    reviewDate: row.review_date || row.created_at,
    adStatus: row.ad_status || 'queued',
  };
}
