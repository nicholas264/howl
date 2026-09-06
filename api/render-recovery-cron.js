import { neon } from '@neondatabase/serverless';
import { getRenderProgress } from '@remotion/lambda/client';
import { recoverRenders } from './_lib/render-recovery.js';
import { recoverExpiredWork } from './_lib/work-controls.js';

export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  try {
    const sql=neon(process.env.DATABASE_URL);
    await recoverExpiredWork(sql);
    const results = await recoverRenders(sql, getRenderProgress);
    return res.json({ ok: true, results });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
