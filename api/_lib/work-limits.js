import { checkRateLimit, sendRateLimited } from './rate-limit.js';
import { digest } from './operation-journal.js';
import { finishWork } from './work-controls.js';
import { reservePaidWork } from './paid-work.js';
import { waitUntil } from '@vercel/functions';

const LIMITS = { generation: 120, transcription: 30, render: 20, analysis: 30 };
export async function checkWorkLimit(access, res, kind, {holdUntilCompletion=false} = {}) {
  const result = await checkRateLimit(access.sql, {
    route: `paid-work:${kind}`, key: digest(access.userId),
    limit: LIMITS[kind], windowSeconds: 3600,
  });
  if (!result.allowed) { sendRateLimited(res, result); return false; }
  let id;
  try { id=await reservePaidWork(access.sql,kind,access.userId,{ttlSeconds:holdUntilCompletion?1800:330}); }
  catch(error){res.status(error.statusCode||503).json({error:error.message});return false;}
  if(!id){
    res.setHeader('Retry-After','30');
    res.status(429).json({error:'Concurrent work limit reached. Wait for an existing job to finish before retrying.'});
    return false;
  }
  access.workId=id;
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
