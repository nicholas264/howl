import { requirePermission } from './_lib/app-access.js';
import { recoverMetaAd } from './_lib/operation-recovery.js';

export default async function handler(req,res) {
  if(req.method!=='POST')return res.status(405).end();
  const access=await requirePermission(req,res,'admin.users');if(!access)return;
  const {operation_key,step_key,provider_id,note}=req.body || {};
  if(![operation_key,step_key,provider_id,note].every(value=>typeof value==='string') || operation_key.length>100 || step_key.length>300 || provider_id.length>100 || note.trim().length<10 || note.length>2000)
    return res.status(400).json({error:'Operation, step, Meta ad ID, and a review note are required'});
  try {
    await recoverMetaAd(access.sql,{operationKey:operation_key,stepKey:step_key,providerId:provider_id.trim(),note:note.trim(),actorId:access.userId});
    return res.json({ok:true,message:'Provider receipt recovered. Retry the original launch request to complete its local bookkeeping.'});
  } catch(error){return res.status(409).json({error:error.message});}
}
