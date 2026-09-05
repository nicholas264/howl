import { neon } from '@neondatabase/serverless';
import { syncCreativeAnalytics } from './_lib/meta/sync.js';

export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID || !process.env.DATABASE_URL) return res.status(503).json({ error: 'Creative sync is not configured' });
  try {
    const result = await syncCreativeAnalytics({
      sql: neon(process.env.DATABASE_URL), accessToken: process.env.META_ACCESS_TOKEN,
      adAccountId: `act_${process.env.META_AD_ACCOUNT_ID.replace(/^act_/, '')}`,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
