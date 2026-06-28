import { neon } from '@neondatabase/serverless';
import { ensureLooxReviewTables, normalizeLooxReviewPayload } from './_lib/loox-reviews.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function authorized(req) {
  const expected = process.env.LOOX_REVIEW_WEBHOOK_SECRET;
  if (!expected && process.env.NODE_ENV !== 'production') return true;
  if (!expected) return false;
  const headerSecret = req.headers['x-howl-loox-secret'];
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return headerSecret === expected || bearer === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  try {
    await ensureLooxReviewTables(sql);
    const review = normalizeLooxReviewPayload(req.body || {});
    const [row] = await sql`
      INSERT INTO loox_reviews (
        source_key, rating, author, email, body, product_handle, product_id,
        product_title, product_url, photo_url, order_id, review_date,
        ad_status, source_payload, last_seen_at
      )
      VALUES (
        ${review.sourceKey}, ${review.rating}, ${review.author}, ${review.email},
        ${review.body}, ${review.productHandle}, ${review.productId},
        ${review.productTitle}, ${review.productUrl}, ${review.photoUrl},
        ${review.orderId}, ${review.reviewDate}, ${review.adStatus},
        ${JSON.stringify(review.sourcePayload)}::jsonb, now()
      )
      ON CONFLICT (source_key) DO UPDATE
      SET rating = EXCLUDED.rating,
          author = EXCLUDED.author,
          email = EXCLUDED.email,
          body = EXCLUDED.body,
          product_handle = EXCLUDED.product_handle,
          product_id = EXCLUDED.product_id,
          product_title = EXCLUDED.product_title,
          product_url = EXCLUDED.product_url,
          photo_url = EXCLUDED.photo_url,
          order_id = EXCLUDED.order_id,
          review_date = EXCLUDED.review_date,
          source_payload = EXCLUDED.source_payload,
          last_seen_at = now(),
          updated_at = now()
      RETURNING id, rating, ad_status, created_at, updated_at
    `;
    return res.status(202).json({ ok: true, review: row });
  } catch (err) {
    console.error('loox-review ingest failed', err);
    return res.status(400).json({ error: err.message || 'Could not ingest review' });
  }
}
