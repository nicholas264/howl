// Google Ads API integration.
// One endpoint, action-based, mirrors api/meta.js style.
//
// Actions:
//   GET  /api/google?action=auth                → 302 to Google OAuth consent
//   GET  /api/google?action=callback&code=...   → exchanges code, renders refresh_token for copy
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
//   GOOGLE_OAUTH_REDIRECT_URI      (e.g. https://howl-teal.vercel.app/api/google?action=callback)

import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';

const GOOGLE_ADS_API_VERSION = 'v20';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

function redirectUri() {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    || 'https://howl-teal.vercel.app/api/google?action=callback';
}

async function exchangeCodeForTokens(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`${d.error}: ${d.error_description || ''}`);
  return d; // { access_token, refresh_token, expires_in, ... }
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
  const root = payload?.error || {};
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
    headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
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

async function upsertMonthly(sql, monthsArr) {
  for (const m of monthsArr) {
    const existing = await sql`SELECT shopify, shopify_dealer, meta, google FROM monthly_metrics WHERE month = ${m.month}`;
    const prev = existing[0] || {};
    await sql`
      INSERT INTO monthly_metrics (month, shopify, shopify_dealer, meta, google, updated_at)
      VALUES (
        ${m.month},
        ${prev.shopify ? JSON.stringify(prev.shopify) : null}::jsonb,
        ${prev.shopify_dealer ? JSON.stringify(prev.shopify_dealer) : null}::jsonb,
        ${prev.meta ? JSON.stringify(prev.meta) : null}::jsonb,
        ${JSON.stringify({
          spend: m.spend, impressions: m.impressions, clicks: m.clicks,
          conversions: m.conversions, conversionValue: m.conversionValue,
          snapshotAt: new Date().toISOString(),
        })}::jsonb,
        now()
      )
      ON CONFLICT (month) DO UPDATE SET
        google     = EXCLUDED.google,
        updated_at = now()
    `;
  }
}

export default async function handler(req, res) {
  const action = (req.query?.action || req.body?.action || '').toString();

  // OAuth init — public (no Clerk), but leak-safe: reads only env vars.
  if (req.method === 'GET' && action === 'auth') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    return res.end();
  }

  // OAuth callback — public, renders refresh token for one-time copy.
  if (req.method === 'GET' && action === 'callback') {
    const code = req.query?.code;
    if (!code) return res.status(400).send('Missing ?code');
    try {
      const tokens = await exchangeCodeForTokens(String(code));
      res.setHeader('Content-Type', 'text/html');
      return res.end(`
        <html><body style="font-family:system-ui;padding:40px;background:#0d1117;color:#c9d1d9;">
          <h2 style="color:#DC440A;">Google Ads OAuth — Refresh Token</h2>
          <p>Copy this into Vercel env as <code>GOOGLE_ADS_REFRESH_TOKEN</code>, then redeploy.</p>
          <pre style="padding:14px;background:#161b22;border:1px solid #2a3441;border-radius:6px;word-break:break-all;white-space:pre-wrap;">${tokens.refresh_token || '(no refresh_token returned — make sure prompt=consent and access_type=offline)'}</pre>
          <p style="color:#8b949e;font-size:12px;">Access token (expires in ${tokens.expires_in}s, not needed long-term):</p>
          <pre style="padding:10px;background:#161b22;border:1px solid #2a3441;border-radius:6px;word-break:break-all;white-space:pre-wrap;font-size:11px;color:#6e7681;">${tokens.access_token}</pre>
        </body></html>
      `);
    } catch (err) {
      return res.status(500).send(`OAuth exchange failed: ${err.message}`);
    }
  }

  // Everything else requires Clerk auth.
  if (!(await requirePermission(req, res, 'analytics.read'))) return;

  if (req.method !== 'POST') return res.status(405).end();

  if (action === 'get_monthly') {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (!customerId) return res.status(500).json({ error: 'GOOGLE_ADS_CUSTOMER_ID not set' });
    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) return res.status(500).json({ error: 'GOOGLE_ADS_DEVELOPER_TOKEN not set' });
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) return res.status(500).json({ error: 'GOOGLE_ADS_REFRESH_TOKEN not set — run /api/google?action=auth first' });

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
          AND segments.conversion_action_category = 'PURCHASE'
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
        byMonth[mk].spend += Number(m.costMicros || 0) / 1_000_000;
        byMonth[mk].impressions += Number(m.impressions || 0);
        byMonth[mk].clicks += Number(m.clicks || 0);
        byMonth[mk].conversions += Number(m.conversions || 0);
        byMonth[mk].conversionValue += Number(m.conversionsValue || 0);
      }
      const monthsArr = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

      // Upsert into monthly_metrics.
      try {
        if (process.env.DATABASE_URL && monthsArr.length) {
          const sql = neon(process.env.DATABASE_URL);
          await upsertMonthly(sql, monthsArr);
        }
      } catch (err) {
        console.error('google upsert failed:', err.message);
      }

      return res.json({ months: monthsArr, customerId });
    } catch (err) {
      const hint = /invalid_grant|expired|revoked|Refresh token exchange failed/i.test(err.message)
        ? 'Reconnect Google Ads with /api/google?action=auth, then update GOOGLE_ADS_REFRESH_TOKEN in Vercel.'
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
