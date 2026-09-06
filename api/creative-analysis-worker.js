import { claimAnalysisCronSlot, completeAnalysisCronSlot } from './_lib/analysis-cron-slot.js';
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

    const slot = await claimAnalysisCronSlot(sql);
    if (!slot) return res.status(200).json({ok:true,skipped:'already_ran_this_slot'});

    const batchSize = Math.max(1, Math.min(8, parseInt(process.env.CREATIVE_ANALYSIS_WORKER_BATCH_SIZE || '6', 10)));

    const out = await processCreativeAnalysisQueue({
      batchSize,
      ctx: {
        BASE: 'https://graph.facebook.com/v21.0',
        accessToken,
        adAccountId: `act_${rawId}`,
      },
    });
    if (out.status < 400) await completeAnalysisCronSlot(sql,slot,out.body?.processed || 0);
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('creative analysis worker failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
