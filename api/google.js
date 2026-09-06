import { upsertMonthlySnapshot } from './_lib/monthly-metrics.js';
// Google Ads API integration.
// One endpoint, action-based, mirrors api/meta.js style.
//
// Actions:
//   Legacy auth/callback actions return 410; credentials are managed outside this public API.
//   POST /api/google  body: {action:'get_monthly', months?: 14}
//                                               → searchStream by month, upsert into Neon
//
// Env required:
//   GOOGLE_ADS_CLIENT_ID
//   GOOGLE_ADS_CLIENT_SECRET
//   GOOGLE_ADS_DEVELOPER_TOKEN     (apply at HOWL's Ads → Tools → API Center)
//   GOOGLE_ADS_CUSTOMER_ID         (10-digit, dashes stripped — the account being queried)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID   (10-digit, dashes stripped — the manager (MCC) account that owns the dev token)
//   GOOGLE_ADS_REFRESH_TOKEN       (captured once via callback, pasted into Vercel env)

import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';

const GOOGLE_ADS_API_VERSION = 'v25';

function requiredEnv(keys) {
  return keys.filter(key => !process.env[key]);
}

function normalizeCustomerId(value) {
  return String(value || '').replace(/\D/g, '');
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`Refresh token exchange failed: ${d.error_description || d.error}`);
  return d.access_token;
}

function googleAdsErrorMessage(status, text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {}
  const root = (Array.isArray(payload) ? payload[0]?.error : payload?.error) || {};
  const details = Array.isArray(root.details) ? root.details : [];
  const googleAdsFailure = details.find(d => Array.isArray(d?.errors));
  const firstFailure = googleAdsFailure?.errors?.[0];
  const code = firstFailure?.errorCode
    ? Object.entries(firstFailure.errorCode).map(([k, v]) => `${k}.${v}`).join(', ')
    : root.status || `HTTP_${status}`;
  const message = firstFailure?.message || root.message || text.slice(0, 300);
  const requestId = details.find(d => d?.requestId)?.requestId || root.requestId || null;
  const location = firstFailure?.location?.fieldPathElements
    ?.map(part => part.fieldName)
    .filter(Boolean)
    .join('.');
  return [
    `Google Ads API ${status}: ${code}`,
    message,
    location ? `Field: ${location}` : '',
    requestId ? `Request ID: ${requestId}` : '',
  ].filter(Boolean).join(' · ');
}

async function searchStream(customerId, query, accessToken) {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(googleAdsErrorMessage(r.status, text));
  }
  // searchStream returns an array of response chunks.
  const chunks = JSON.parse(text);
  const rows = [];
  for (const chunk of chunks) {
    if (chunk.results) rows.push(...chunk.results);
  }
  return rows;
}

export default async function handler(req, res) {
  const action = (req.query?.action || req.body?.action || '').toString();

  if (['auth','callback'].includes(action)) {
    res.setHeader('Cache-Control','no-store');
    return res.status(410).json({error:'This legacy OAuth setup endpoint is retired. Contact the workspace administrator to configure Google Ads credentials securely.'});
  }

  // Everything else requires Clerk auth.
  if (!(await requirePermission(req, res, 'analytics.read'))) return;

  if (req.method !== 'POST') return res.status(405).end();

  if (action === 'get_monthly') {
    const missing = requiredEnv([
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_REFRESH_TOKEN',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_CUSTOMER_ID',
    ]);
    if (missing.length) {
      const reconnect = missing.includes('GOOGLE_ADS_REFRESH_TOKEN')
        ? ' Ask the workspace administrator to configure GOOGLE_ADS_REFRESH_TOKEN securely in Vercel.'
        : '';
      return res.status(500).json({ error: `Missing Google Ads env: ${missing.join(', ')}.${reconnect}` });
    }
    const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
    if (!customerId) return res.status(500).json({ error: 'GOOGLE_ADS_CUSTOMER_ID must contain digits' });

    try {
      const accessToken = await getAccessToken();
      const months = Math.min(Math.max(parseInt(req.body?.months ?? 14, 10) || 14, 1), 36);
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // Two queries:
      // 1) Spend/impr/clicks: NOT segmented by conversion action — counted once per month.
      // 2) Conversions/value: segmented by conversion_action_category, filtered to PURCHASE only.
      // Combining is necessary because adding segments.conversion_action_category to a single
      // query would multiply rows and inflate spend/impressions.
      const spendQuery = `
        SELECT
          segments.month,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks
        FROM customer
        WHERE segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'
      `.replace(/\s+/g, ' ').trim();

      const purchaseQuery = `
        SELECT
          segments.month,
          segments.conversion_action_category,
          metrics.conversions,
          metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'
          AND segments.conversion_action_category = PURCHASE
      `.replace(/\s+/g, ' ').trim();

      const [spendRows, purchaseRows] = await Promise.all([
        searchStream(customerId, spendQuery, accessToken),
        searchStream(customerId, purchaseQuery, accessToken),
      ]);
      const rows = [...spendRows, ...purchaseRows];

      // Aggregate (segments.month is YYYY-MM-01; collapse to YYYY-MM).
      const byMonth = {};
      for (const row of rows) {
        const monthRaw = row.segments?.month; // "2026-04-01"
        if (!monthRaw) continue;
        const mk = monthRaw.slice(0, 7);
        if (!byMonth[mk]) byMonth[mk] = { month: mk, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
        const m = row.metrics || {};
        byMonth[mk].spend += Number(m.costMicros ?? m.cost_micros ?? 0) / 1_000_000;
        byMonth[mk].impressions += Number(m.impressions || 0);
        byMonth[mk].clicks += Number(m.clicks || 0);
        byMonth[mk].conversions += Number(m.conversions || 0);
        byMonth[mk].conversionValue += Number(m.conversionsValue ?? m.conversions_value ?? 0);
      }
      const monthsArr = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

      if (!process.env.DATABASE_URL) {
        return res.status(500).json({ error: 'DATABASE_URL not set; Google data was fetched but cannot be pushed into the CFO dashboard.' });
      }
      if (monthsArr.length) {
        const sql = neon(process.env.DATABASE_URL);
        for (const m of monthsArr) await upsertMonthlySnapshot(sql,{month:m.month,google:{spend:m.spend,impressions:m.impressions,clicks:m.clicks,conversions:m.conversions,conversionValue:m.conversionValue,snapshotAt:new Date().toISOString()}});
      }

      return res.json({ months: monthsArr, customerId, persisted: true });
    } catch (err) {
      const hint = /invalid_grant|expired|revoked|Refresh token exchange failed/i.test(err.message)
        ? 'Ask the workspace administrator to refresh the Google Ads credential securely in Vercel.'
        : /CUSTOMER_NOT_FOUND|USER_PERMISSION_DENIED|login-customer-id|authorization/i.test(err.message)
          ? 'Check GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID, and that the refresh-token user can access the Ads account.'
          : /developer.?token|DEVELOPER_TOKEN|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(err.message)
            ? 'Check GOOGLE_ADS_DEVELOPER_TOKEN approval and that the OAuth token includes the adwords scope.'
            : null;
      return res.status(500).json({ error: hint ? `${err.message} · ${hint}` : err.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
