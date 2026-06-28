import { neon } from '@neondatabase/serverless';
import { requirePermission } from '../_lib/app-access.js';
import { ensureLooxReviewTables, toReviewAdRow } from '../_lib/loox-reviews.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function cleanText(value, max = 5000) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value).trim().slice(0, max) || null;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'assets.read' : 'assets.write');
  if (!access) return;
  const sql = neon(process.env.DATABASE_URL);

  try {
    await ensureLooxReviewTables(sql);

    if (req.method === 'GET') {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '300', 10) || 300, 1), 1000);
      const rating = parseInt(req.query.rating || '0', 10) || 0;
      const product = cleanText(req.query.product, 120);
      const rows = await sql`
        SELECT *
        FROM loox_reviews
        WHERE (${rating} = 0 OR rating = ${rating})
          AND (${product || null}::text IS NULL OR product_handle = ${product})
        ORDER BY COALESCE(review_date, created_at) DESC, id DESC
        LIMIT ${limit}
      `;
      return res.json({ reviews: rows.map(toReviewAdRow) });
    }

    if (req.method === 'PATCH') {
      const rawId = String(req.body?.id || req.query.id || '').replace(/^loox_/, '');
      const id = parseInt(rawId, 10);
      if (!id) return res.status(400).json({ error: 'id required' });
      const editedBody = cleanText(req.body?.quote ?? req.body?.edited_body, 5000);
      const author = cleanText(req.body?.nickname ?? req.body?.author, 240);
      const adStatus = cleanText(req.body?.ad_status, 80);
      const [row] = await sql`
        UPDATE loox_reviews
        SET edited_body = COALESCE(${editedBody}, edited_body),
            author = COALESCE(${author}, author),
            ad_status = COALESCE(${adStatus}, ad_status),
            updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json({ review: toReviewAdRow(row) });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('loox-reviews api failed', err);
    return res.status(500).json({ error: err.message || 'Loox reviews failed' });
  }
}
