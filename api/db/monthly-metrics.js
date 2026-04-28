import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_metrics (
      month      TEXT PRIMARY KEY,
      shopify    JSONB,
      meta       JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Lazy migration: add shopify_dealer column on existing tables.
  await sql`ALTER TABLE monthly_metrics ADD COLUMN IF NOT EXISTS shopify_dealer JSONB`;
}

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  const sql = neon(process.env.DATABASE_URL);
  try {
    await ensureTable(sql);

    if (req.method === 'GET') {
      const rows = await sql`SELECT month, shopify, shopify_dealer, meta, updated_at FROM monthly_metrics ORDER BY month ASC`;
      return res.json({ rows });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Bulk upsert: { snapshots: [{month, shopify?, shopify_dealer?, meta?}, ...] }
      if (action === 'snapshot') {
        const { snapshots } = req.body || {};
        if (!Array.isArray(snapshots)) return res.status(400).json({ error: 'snapshots[] required' });
        let upserted = 0;
        for (const s of snapshots) {
          if (!s.month) continue;
          // Merge with existing row so a partial push doesn't blow away other fields.
          const existing = await sql`SELECT shopify, shopify_dealer, meta FROM monthly_metrics WHERE month = ${s.month}`;
          const prevShopify = existing[0]?.shopify || null;
          const prevDealer = existing[0]?.shopify_dealer || null;
          const prevMeta = existing[0]?.meta || null;
          const nextShopify = s.shopify !== undefined ? s.shopify : prevShopify;
          const nextDealer = s.shopify_dealer !== undefined ? s.shopify_dealer : prevDealer;
          const nextMeta = s.meta !== undefined ? s.meta : prevMeta;
          await sql`
            INSERT INTO monthly_metrics (month, shopify, shopify_dealer, meta, updated_at)
            VALUES (
              ${s.month},
              ${nextShopify ? JSON.stringify(nextShopify) : null}::jsonb,
              ${nextDealer ? JSON.stringify(nextDealer) : null}::jsonb,
              ${nextMeta ? JSON.stringify(nextMeta) : null}::jsonb,
              now()
            )
            ON CONFLICT (month) DO UPDATE SET
              shopify        = EXCLUDED.shopify,
              shopify_dealer = EXCLUDED.shopify_dealer,
              meta           = EXCLUDED.meta,
              updated_at     = now()
          `;
          upserted++;
        }
        return res.json({ upserted });
      }

      if (action === 'delete') {
        const { month } = req.body || {};
        if (!month) return res.status(400).json({ error: 'month required' });
        await sql`DELETE FROM monthly_metrics WHERE month = ${month}`;
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
