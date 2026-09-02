// Reads the HOWL projections sheet via the Sheets API and returns structured
// monthly forecast data. Caches the parsed result in the forecast_cache table.
//
// REQUIREMENTS:
//   1. The Google Sheet must be shared with the howl-drive-uploader service
//      account (Viewer access is enough).
//   2. Either the request body must include { sheetId } or
//      dashboard_settings.forecastSheetId must be set.
import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';
import { getGoogleAccessToken } from './_lib/gcp-auth.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const DEFAULT_SHEET_NAME = '615 Sales Plan $13M';
const LEGACY_DEFAULT_SHEET_NAME = 'P&L Monthly';

// Map of forecast row labels (case-insensitive, trimmed) to output field names.
// Supports both the old P&L Monthly tab and the 6/15 Sales Plan workbook tabs.
const ROW_MAP = {
  'dtc revenue':                'dtcRevenue',
  'core - dtc rev':             'dtcRevenue',
  'total dtc rev':              'dtcRevenue',
  'retail revenue':             'retailRevenue',
  'core - ret rev':             'retailRevenue',
  'total retail rev':           'retailRevenue',
  'shipping revenue':           'shippingRevenue',
  'returns':                    'returns',
  'net revenue':                'netRevenue',
  'core - total rev':           'netRevenue',
  'cogs':                       'cogs',
  'payment processing (2.9%)':  'paymentProcessing',
  'shipping':                   'shippingCost',
  'total cogs':                 'totalCogs',
  'gross profit':               'grossProfit',
  'gross profit (%)':           'grossMarginPct',
  'customer acquisition cost':  'cac',
  'total selling expense':      'totalSellingExpense',
  'contribution profit':        'contributionProfit',
  'contribution margin (%)':    'contributionMarginPct',
  'total opex':                 'totalOpex',
  'ebitda':                     'ebitda',
  'ebitda margin (%)':          'ebitdaMarginPct',
  'net new customers':          'newCustomers',
  'units sold':                 'units',
  'core - units sold':          'units',
  'total units sold':           'units',
};

const MULTI_FIELD_ROW_MAP = {
  'total howl rev': ['totalRevenue', 'netRevenue'],
};

// Column-header parser: turns "January 2026" or "January" into "2026-01".
function parseMonthHeader(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (!m) return null;
  const monthIdx = ['january','february','march','april','may','june','july','august','september','october','november','december']
    .indexOf(m[1].toLowerCase());
  if (monthIdx < 0) return null;
  const year = m[2] || String(new Date().getFullYear());
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[$,\s]/g, '').replace(/%$/, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, 'analytics.read'))) return;
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      // Return cached forecast (if any) without hitting Sheets — fast path for dashboard mounts.
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS forecast_cache (
            key        TEXT PRIMARY KEY,
            value      JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `;
        const rows = await sql`SELECT value, updated_at FROM forecast_cache WHERE key = 'pnl_monthly'`;
        if (!rows[0]) return res.json({ forecast: null });
        if (rows[0].value?.sheetName === LEGACY_DEFAULT_SHEET_NAME) {
          return res.json({ forecast: null, updatedAt: rows[0].updated_at, staleForecastIgnored: true });
        }
        return res.json({ forecast: rows[0].value, updatedAt: rows[0].updated_at });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method !== 'POST') return res.status(405).end();

    const { action, sheetId: sheetIdInput, sheetName: sheetNameInput } = req.body || {};

    if (action !== 'refresh') {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    // Resolve sheet id: explicit body param, then dashboard_settings.forecastSheetId, then env.
    let sheetId = sheetIdInput;
    if (!sheetId) {
      try {
        const settingsRows = await sql`SELECT value FROM dashboard_settings WHERE key = 'cfo'`;
        sheetId = settingsRows[0]?.value?.forecastSheetId || null;
      } catch {}
    }
    if (!sheetId) sheetId = process.env.FORECAST_SHEET_ID || null;
    if (!sheetId) return res.status(400).json({ error: 'No forecast sheetId configured. Pass { sheetId } or set forecastSheetId in dashboard_settings.' });

    const sheetName = sheetNameInput || DEFAULT_SHEET_NAME;
    const range = `${sheetName}!A1:AC80`;

    const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const url = `${SHEETS_BASE}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: d.error?.message || `Sheets API ${r.status}`, detail: d });

    const values = d.values || [];
    if (values.length === 0) return res.status(400).json({ error: `Sheet "${sheetName}" returned no rows` });

    // Find the header row containing month headers. P&L Monthly uses
    // "January 2026"; the 6/15 sales plan tabs use bare month names.
    let headerRowIdx = -1;
    let monthCols = [];
    for (let i = 0; i < Math.min(values.length, 10); i++) {
      const row = values[i];
      const matched = [];
      for (let c = 1; c < row.length; c++) {
        const mk = parseMonthHeader(row[c]);
        if (mk) matched.push({ col: c, month: mk });
      }
      if (matched.length >= 3) { headerRowIdx = i; monthCols = matched; break; }
    }
    if (headerRowIdx < 0) return res.status(400).json({ error: `Could not locate month-header row in ${sheetName}` });

    // Walk the rest, collecting any row whose label (col 0) matches ROW_MAP.
    const months = monthCols.map(({ month }) => ({ month }));
    const monthIdxByCol = Object.fromEntries(monthCols.map(({ col }, i) => [col, i]));
    for (let r2 = headerRowIdx + 1; r2 < values.length; r2++) {
      const row = values[r2];
      const labelRaw = row[0];
      if (!labelRaw || typeof labelRaw !== 'string') continue;
      const label = labelRaw.trim().toLowerCase().replace(/\s+/g, ' ');
      const fields = MULTI_FIELD_ROW_MAP[label] || (ROW_MAP[label] ? [ROW_MAP[label]] : null);
      if (!fields) continue;
      for (const { col } of monthCols) {
        const idx = monthIdxByCol[col];
        const n = toNumber(row[col]);
        if (n != null) {
          for (const field of fields) months[idx][field] = n;
        }
      }
    }

    const forecast = { sheetId, sheetName, months, parsedAt: new Date().toISOString() };

    // Cache.
    await sql`
      INSERT INTO forecast_cache (key, value, updated_at)
      VALUES ('pnl_monthly', ${JSON.stringify(forecast)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;

    return res.json({ forecast });
  } catch (err) {
    console.error('Forecast error:', err);
    return res.status(500).json({ error: err.message });
  }
}
