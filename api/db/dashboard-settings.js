import { neon } from '@neondatabase/serverless';
import { requirePermission } from '../_lib/app-access.js';

const DEFAULTS = {
  grossMarginPct: 60,        // % of net revenue retained after COGS — fallback when Shopify unitCost is missing
  dealerWholesaleRetailPct: 70, // dealer/wholesale selling price as % of DTC retail; 70 means dealer keeps a 30% retail margin
  paymentFeePct: 2.9,        // payment processor %
  paymentFeeFixed: 0.30,     // per-order processor fixed
  shippingCostPerOrder: 8,   // outbound fulfillment cost
  fulfillmentCostPerOrder: 3, // pick/pack labor
  monthlyOpex: 50000,        // fallback monthly opex when no per-month override is set
  googleSpend: {},           // YYYY-MM → dollar spend (manual until we wire the Google Ads API)
  opexByMonth: {},           // YYYY-MM → dollar opex from P&L; falls back to monthlyOpex
  dealerRevenueByMonth: {},  // YYYY-MM → dealer revenue override; replaces an incomplete dealer snapshot for that month
  dealerOrdersByMonth: {},   // YYYY-MM → dealer order override
  offPlatformRevenueByMonth: {}, // YYYY-MM → revenue outside either Shopify store
  offPlatformOrdersByMonth: {},  // YYYY-MM → orders outside either Shopify store
  revenueAddByMonth: {},     // Legacy field retained for backwards-compatible settings reads; no longer included in totals
  ordersAddByMonth: {},      // Legacy field retained for backwards-compatible settings reads; no longer included in totals
  newCustomersAddByMonth: {},      // YYYY-MM → additional new customers for pre-window months
  returningCustomersAddByMonth: {}, // YYYY-MM → additional returning customers for pre-window months
  cfoStartMonth: '2026-01',  // Detailed table start; annual KPI rollup always uses the full current calendar year
  annualRevenueTargetBase: 13000000,
  annualRevenueTargetStretch: 15000000,
  annualRevenueCurveBase: [
    286002.327, 326854.894, 509399.839, 487593.84,
    598425.6439, 672240.6439, 1162449.05, 1263926.085,
    1373676.285, 1527816.515, 3260132.345, 994944.915,
  ], // 2026 Net Revenue seasonality from Updated 26' Forecast New Sales Assumptions (6)
  annualRevenueCurveStretch: [
    307279.9112, 471602.8484, 721536.7344, 738059.3916,
    735743.7212, 996673.7412, 861438.8592, 1224937.8,
    1537078.032, 1678832.376, 3792607.048, 1484514.324,
  ], // 2026 Net Revenue seasonality from HOWL '26-'27 Projections (4)
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
  if (!(await requirePermission(req, res, req.method === 'GET' ? 'analytics.read' : 'admin.users'))) return;
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
