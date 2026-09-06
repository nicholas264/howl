import { claimWork, finishWork } from './work-controls.js';
import { reserveOperationBudget } from './operation-budget.js';
import { checkRateLimit } from './rate-limit.js';
import { digest } from './operation-journal.js';

const DAILY_DEFAULTS={generation:500,transcription:100,render:100,analysis:150};
export async function reservePaidWork(sql,kind,actorId,{ttlSeconds=330,hourlyLimit=null}={}) {
  if(!Object.hasOwn(DAILY_DEFAULTS,kind))throw new Error('Unknown paid work kind');
  if(hourlyLimit){
    const rate=await checkRateLimit(sql,{route:`paid-work:${kind}`,key:digest(actorId),limit:hourlyLimit,windowSeconds:3600});
    if(!rate.allowed)throw Object.assign(new Error('Hourly work limit reached'),{statusCode:429});
  }
  const id=await claimWork(sql,kind,actorId,{ttlSeconds});
  if(!id)return null;
  try {
    const configured=Number(process.env[`HOWL_DAILY_${kind.toUpperCase()}_LIMIT`]);
    await reserveOperationBudget(sql,`paid-work:${kind}`,id,Number.isSafeInteger(configured)&&configured>0?configured:DAILY_DEFAULTS[kind]);
    return id;
  } catch(error){await finishWork(sql,id,kind,error.statusCode||503);throw error;}
}
