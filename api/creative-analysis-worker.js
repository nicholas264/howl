import { processCreativeAnalysisQueue } from './_lib/meta/creative-analysis.js';
import { neon } from '@neondatabase/serverless';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.CRON_SECRET;
  const isAuthorized = expected
    ? req.headers.authorization === `Bearer ${expected}`
    : (req.headers['user-agent'] || '').toLowerCase().includes('vercel-cron');
  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken || !rawId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID not configured' });
  }

  try {
    // Vercel can occasionally deliver a cron event more than once. The daily
    // lock keeps this expensive worker idempotent even without CRON_SECRET.
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS creative_analysis_cron_runs (
        run_date DATE PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const claimed = await sql`
      INSERT INTO creative_analysis_cron_runs (run_date)
      VALUES (CURRENT_DATE)
      ON CONFLICT (run_date) DO NOTHING
      RETURNING run_date
    `;
    if (!claimed.length) return res.status(200).json({ ok: true, skipped: 'already_ran_today' });

    const out = await processCreativeAnalysisQueue({
      batchSize: 3,
      ctx: {
        BASE: 'https://graph.facebook.com/v21.0',
        accessToken,
        adAccountId: `act_${rawId}`,
      },
    });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('creative analysis worker failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
