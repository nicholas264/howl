import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';

const DEFAULTS = {
  grossMarginPct: 60,        // % of net revenue retained after COGS
  paymentFeePct: 2.9,        // payment processor %
  paymentFeeFixed: 0.30,     // per-order processor fixed
  shippingCostPerOrder: 8,   // outbound fulfillment cost
  fulfillmentCostPerOrder: 3, // pick/pack labor
  // ad spend pulled live from Meta
};

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  const sql = neon(process.env.DATABASE_URL);
  try {
    if (req.method === 'GET') {
      const rows = await sql`SELECT value FROM dashboard_settings WHERE key = 'cfo'`;
      const value = rows[0]?.value || {};
      return res.json({ settings: { ...DEFAULTS, ...value } });
    }
    if (req.method === 'POST') {
      const incoming = req.body?.settings || {};
      const merged = { ...DEFAULTS, ...incoming };
      await sql`
        INSERT INTO dashboard_settings (key, value, updated_at)
        VALUES ('cfo', ${JSON.stringify(merged)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
      return res.json({ settings: merged });
    }
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
