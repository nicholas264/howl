import { neon } from '@neondatabase/serverless';
import { runMapMonitor } from './_lib/map-monitor.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.CRON_SECRET;
  const isAuthorized = expected
    ? req.headers.authorization === `Bearer ${expected}`
    : (req.headers['user-agent'] || '').toLowerCase().includes('vercel-cron');
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL not configured' });

  try {
    const result = await runMapMonitor({ sql: neon(process.env.DATABASE_URL), force: false });
    return res.json(result);
  } catch (err) {
    console.error('map monitor cron failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
