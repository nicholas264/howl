import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { hash, uuid, crmError } from './_lib/crm.js';
import { intakeData, intakeOpportunity } from './_lib/dealer-intake.js';
import { checkRateLimit, rateLimitKey, sendRateLimited } from './_lib/rate-limit.js';
const ORIGINS=new Set(['https://welcometothecampfire.io']);
export function createDealerIntakeHandler({getSql=()=>neon(process.env.DATABASE_URL),limit=checkRateLimit,now=()=>new Date()}={}) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
  const origin=req.headers?.origin;
  if(!ORIGINS.has(origin))return res.status(403).json({error:'Please submit through the HOWL dealer inquiry form.'});
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(process.env.DEALER_INTAKE_ENABLED==='false')return res.status(503).json({error:'Dealer inquiries are temporarily unavailable. Please try again later.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'Send form data as JSON.'});
  try {
   if(Buffer.byteLength(JSON.stringify(req.body??{}))>16000)throw crmError('Your inquiry is too long.',413);
   if(req.body?.fax)return res.status(200).json({ok:true});
   if(!uuid(req.body?.requestId))throw crmError('Refresh the form and try again.');
   const data=intakeData(req.body);const fingerprint=hash(data);const sql=getSql();
   const rate=await limit(sql,{route:'dealer-intake:ip',key:rateLimitKey(req),limit:12,windowSeconds:3600});if(!rate.allowed)return sendRateLimited(res,rate);
   const [existing]=await sql`SELECT id,fingerprint FROM crm_intake_submissions WHERE id=${req.body.requestId} OR fingerprint=${fingerprint} ORDER BY (id=${req.body.requestId}) DESC LIMIT 1`;
   if(existing){if(existing.id===req.body.requestId&&existing.fingerprint!==fingerprint)throw crmError('This submission has already been received. Refresh to start another inquiry.',409);return res.status(200).json({ok:true});}
   const emailRate=await limit(sql,{route:'dealer-intake:email',key:hash(data.email),limit:5,windowSeconds:86400});if(!emailRate.allowed)return sendRateLimited(res,emailRate);
   const globalRate=await limit(sql,{route:'dealer-intake:total',key:'all',limit:500,windowSeconds:86400});if(!globalRate.allowed)return sendRateLimited(res,globalRate);
   const opportunity=intakeOpportunity(data,now());const id=randomUUID();const activityId=randomUUID();
   // One transaction: reserve the unique inquiry, then create its opportunity and audit.
   // Deferred FK permits the reservation to precede the opportunity in this statement.
   const saved=await sql`WITH reservation AS (
     INSERT INTO crm_intake_submissions(id,fingerprint,opportunity_id) VALUES(${req.body.requestId},${fingerprint},${id}) ON CONFLICT DO NOTHING RETURNING opportunity_id
    ), opportunity AS (
     INSERT INTO crm_opportunities(id,data,created_by) SELECT opportunity_id,${JSON.stringify(opportunity)}::jsonb,'public:dealer-intake' FROM reservation RETURNING id
    ) INSERT INTO crm_activity(id,opportunity_id,actor_id,kind,detail,request_id,request_hash)
      SELECT ${activityId},id,'public:dealer-intake','create',${JSON.stringify({after:opportunity,by:'Campfire dealer intake',source:'campfire_dealer_intake'})}::jsonb,${req.body.requestId},${fingerprint} FROM opportunity RETURNING id`;
   if(!saved.length){const [retry]=await sql`SELECT fingerprint FROM crm_intake_submissions WHERE id=${req.body.requestId} OR fingerprint=${fingerprint} ORDER BY (id=${req.body.requestId}) DESC LIMIT 1`;if(!retry||retry.fingerprint!==fingerprint)throw crmError('Submission could not be confirmed. Please retry.',409);}
   return res.status(200).json({ok:true});
  }catch(error){const status=error.statusCode||503;if(status>=500)console.error('Dealer intake failed',{code:error.code||'unknown'});return res.status(status).json({error:status>=500?'We could not confirm your inquiry. Your details are still here; please try again.':error.message});}
 };
}
export default createDealerIntakeHandler();
