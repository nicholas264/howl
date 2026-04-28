import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';

const DEFAULTS = {
  grossMarginPct: 60,        // % of net revenue retained after COGS — fallback when Shopify unitCost is missing
  paymentFeePct: 2.9,        // payment processor %
  paymentFeeFixed: 0.30,     // per-order processor fixed
  shippingCostPerOrder: 8,   // outbound fulfillment cost
  fulfillmentCostPerOrder: 3, // pick/pack labor
  monthlyOpex: 50000,        // fallback monthly opex when no per-month override is set
  googleSpend: {},           // YYYY-MM → dollar spend (manual until we wire the Google Ads API)
  opexByMonth: {},           // YYYY-MM → dollar opex from P&L; falls back to monthlyOpex
  revenueAddByMonth: {},     // YYYY-MM → additional revenue (dealer store, historical pre-window months) added on top of Shopify primary
  ordersAddByMonth: {},      // YYYY-MM → additional orders for the same months (drives correct fees/ship/pick)
  newCustomersAddByMonth: {},      // YYYY-MM → additional new customers for pre-window months
  returningCustomersAddByMonth: {}, // YYYY-MM → additional returning customers for pre-window months
  cfoStartMonth: '2026-03',  // CFO View hides months before this (Shopify only returns last 60d so we snapshot history)
  forecastSheetId: '1uzteHW4sWB6Q49Rt7pOFzmIMD_s0Dxec0lQwgTfFHRI', // HOWL '26-'27 Projections sheet
  forecastSheetName: 'P&L Monthly',
};

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  const sql = neon(process.env.DATABASE_URL);
  try {
    if (req.method === 'GET') {
      try {
        await ensureTable(sql);
        const rows = await sql`SELECT value FROM dashboard_settings WHERE key = 'cfo'`;
        const value = rows[0]?.value || {};
        return res.json({ settings: { ...DEFAULTS, ...value } });
      } catch (err) {
        // Never block the dashboard on settings — fall back to defaults.
        return res.json({ settings: DEFAULTS, _warning: err.message });
      }
    }
    if (req.method === 'POST') {
      await ensureTable(sql);
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
