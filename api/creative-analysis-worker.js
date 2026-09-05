import { processCreativeAnalysisQueue } from './_lib/meta/creative-analysis.js';
import { neon } from '@neondatabase/serverless';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.CRON_SECRET;
  const isAuthorized = expected
    ? req.headers.authorization === `Bearer ${expected}`
    : process.env.NODE_ENV !== 'production'
      && (req.headers['user-agent'] || '').toLowerCase().includes('vercel-cron');
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
    // Vercel can occasionally deliver a cron event more than once. Use an
    // hourly slot lock so backlog draining can run multiple times per day
    // without duplicate work for the same scheduled slot.
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS creative_analysis_cron_slots (
        run_key TEXT PRIMARY KEY,
        run_date DATE NOT NULL DEFAULT CURRENT_DATE,
        run_hour INTEGER,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        processed INTEGER NOT NULL DEFAULT 0
      )
    `;
    const [slot] = await sql`
      SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD-HH24') AS run_key,
             EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::int AS run_hour
    `;
    const claimed = await sql`
      INSERT INTO creative_analysis_cron_slots (run_key, run_date, run_hour)
      VALUES (${slot.run_key}, CURRENT_DATE, ${slot.run_hour})
      ON CONFLICT (run_key) DO UPDATE SET started_at = now()
      WHERE creative_analysis_cron_slots.completed_at IS NULL
        AND creative_analysis_cron_slots.started_at < now()-interval '10 minutes'
      RETURNING run_key
    `;
    if (!claimed.length) return res.status(200).json({ ok: true, skipped: 'already_ran_this_slot', runKey: slot.run_key });

    const batchSize = Math.max(1, Math.min(8, parseInt(process.env.CREATIVE_ANALYSIS_WORKER_BATCH_SIZE || '6', 10)));

    const out = await processCreativeAnalysisQueue({
      batchSize,
      ctx: {
        BASE: 'https://graph.facebook.com/v21.0',
        accessToken,
        adAccountId: `act_${rawId}`,
      },
    });
    await sql`
      UPDATE creative_analysis_cron_slots
      SET completed_at = now(),
          processed = ${out.body?.processed || 0}
      WHERE run_key = ${slot.run_key}
    `;
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('creative analysis worker failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
