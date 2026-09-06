import { checkRateLimit, sendRateLimited } from './rate-limit.js';
import { digest } from './operation-journal.js';
import { claimWork, finishWork } from './work-controls.js';
import { waitUntil } from '@vercel/functions';
import { reserveOperationBudget } from './operation-budget.js';

const LIMITS = { generation: 120, transcription: 30, render: 20, analysis: 30 };
export async function checkWorkLimit(access, res, kind, {holdUntilCompletion=false} = {}) {
  const result = await checkRateLimit(access.sql, {
    route: `paid-work:${kind}`, key: digest(access.userId),
    limit: LIMITS[kind], windowSeconds: 3600,
  });
  if (!result.allowed) { sendRateLimited(res, result); return false; }
  const id=await claimWork(access.sql,kind,access.userId,{ttlSeconds:holdUntilCompletion?1800:330});
  if (!id) {
    res.setHeader('Retry-After','30');
    res.status(429).json({error:'Concurrent work limit reached. Wait for an existing job to finish before retrying.'});
    return false;
  }
  access.workId=id;
  try {
    const defaults={generation:500,transcription:100,render:100,analysis:150};
    const configured=Number(process.env[`HOWL_DAILY_${kind.toUpperCase()}_LIMIT`]);
    await reserveOperationBudget(access.sql,`paid-work:${kind}`,id,Number.isSafeInteger(configured)&&configured>0?configured:defaults[kind]);
  } catch(error) {
    await finishWork(access.sql,id,kind,error.statusCode || 503);
    res.status(error.statusCode || 503).json({error:error.message});return false;
  }
  let finished=false;
  const finish=()=>{
    if (finished) return;
    finished=true;
    const pending=finishWork(access.sql,id,kind,res.statusCode || 200).catch(error=>console.error('Work lease release failed',error.message));
    try {waitUntil(pending);} catch { /* local HTTP runtimes remain alive */ }
  };
  if (!holdUntilCompletion) res.once?.('finish',finish);
  return true;
}
