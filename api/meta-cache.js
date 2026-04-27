// Meta read cache: pulls campaigns + their ad sets in ONE expanded request,
// stores in Postgres, serves from DB unless stale (>5 min) or force=1.
import { neon } from '@neondatabase/serverless';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TTL_SECONDS = 5 * 60;

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS meta_cache (
      key        TEXT PRIMARY KEY,
      payload    JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      usage      JSONB
    )
  `;
}

function parseUsageHeader(res) {
  const out = {};
  try {
    const adAcc = res.headers.get('x-ad-account-usage');
    if (adAcc) out.ad_account = JSON.parse(adAcc);
    const app = res.headers.get('x-app-usage');
    if (app) out.app = JSON.parse(app);
    const bus = res.headers.get('x-business-use-case-usage');
    if (bus) out.business = JSON.parse(bus);
  } catch {}
  return out;
}

import { requireAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  const sql = neon(process.env.DATABASE_URL);
  await ensureTable(sql);

  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  const adAccountId = `act_${rawId}`;
  if (!accessToken || !rawId) return res.status(500).json({ error: 'Meta not configured' });

  const { type = 'campaigns_with_adsets', force } = req.query || req.body || {};

  try {
    // Serve cached if fresh
    if (!force) {
      const rows = await sql`SELECT payload, fetched_at, usage FROM meta_cache WHERE key = ${type}`;
      if (rows[0]) {
        const ageSec = (Date.now() - new Date(rows[0].fetched_at).getTime()) / 1000;
        if (ageSec < TTL_SECONDS) {
          return res.json({ ...rows[0].payload, cached: true, ageSec: Math.round(ageSec), usage: rows[0].usage });
        }
      }
    }

    if (type === 'campaigns_with_adsets') {
      const activeFilter = encodeURIComponent(JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
      ]));
      // Field-expand adsets to avoid N+1 calls
      const fields = encodeURIComponent('id,name,status,effective_status,objective,adsets.limit(100){id,name,status,effective_status}');
      const url = `${GRAPH}/${adAccountId}/campaigns?fields=${fields}&filtering=${activeFilter}&limit=200&access_token=${accessToken}`;
      const r = await fetch(url);
      const usage = parseUsageHeader(r);
      const d = await r.json();
      if (d.error) {
        // Rate limited — return stale cache if we have any
        const stale = await sql`SELECT payload, fetched_at, usage FROM meta_cache WHERE key = ${type}`;
        if (stale[0]) {
          return res.json({ ...stale[0].payload, cached: true, stale: true, error: d.error.message, usage: stale[0].usage });
        }
        return res.status(400).json({ error: d.error.message, detail: d.error });
      }

      const payload = { campaigns: d.data || [] };
      await sql`
        INSERT INTO meta_cache (key, payload, fetched_at, usage)
        VALUES (${type}, ${payload}, now(), ${usage})
        ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now(), usage = EXCLUDED.usage
      `;
      return res.json({ ...payload, cached: false, usage });
    }

    return res.status(400).json({ error: `Unknown cache type: ${type}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
