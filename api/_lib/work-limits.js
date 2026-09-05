import { checkRateLimit, sendRateLimited } from './rate-limit.js';
import { digest } from './operation-journal.js';

const LIMITS = { generation: 120, transcription: 30, render: 20, analysis: 30 };
export async function checkWorkLimit(access, res, kind) {
  const result = await checkRateLimit(access.sql, {
    route: `paid-work:${kind}`, key: digest(access.userId),
    limit: LIMITS[kind], windowSeconds: 3600,
  });
  if (!result.allowed) { sendRateLimited(res, result); return false; }
  return true;
}
