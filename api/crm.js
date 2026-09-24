import { randomUUID } from 'node:crypto';
import { requirePermission, hasPermission } from './_lib/app-access.js';
import { opportunityData, crmError, uuid, hash, text } from './_lib/crm.js';

export function createCrmHandler({authorize=requirePermission}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    const access=await authorize(req,res,req.method==='GET'?'crm.read':'crm.write');if(!access)return;
    const {sql,userId}=access;
    try {
      if(req.method==='GET') {
        if(req.query?.id) {
          if(!uuid(req.query.id))throw crmError('Invalid opportunity.');
          const [opportunity]=await sql`SELECT * FROM crm_opportunities WHERE id=${req.query.id}`;
          if(!opportunity)throw crmError('Opportunity not found.',404);
          const activity=await sql`SELECT id,actor_id,kind,detail,created_at FROM crm_activity WHERE opportunity_id=${req.query.id} ORDER BY created_at DESC,id DESC`;
          return res.json({opportunity,activity});
        }
        const opportunities=await sql`SELECT * FROM crm_opportunities ORDER BY updated_at DESC,id LIMIT 5001`;
        if(opportunities.length>5000)throw crmError('The pipeline has exceeded this release’s 5,000-opportunity capacity. Ask an administrator to enable pagination.',503);
        return res.json({opportunities,canWrite:hasPermission(access,'crm.write'),canSend:hasPermission(access,'crm.send')});
      }
      const b=req.body||{};
      if(!uuid(b.requestId)||!uuid(b.id))throw crmError('A valid opportunity ID and request ID are required.');
      const requestHash=hash(b);
      const [receipt]=await sql`SELECT * FROM crm_activity WHERE request_id=${b.requestId}`;
      if(receipt) {
        if(receipt.actor_id!==userId||receipt.request_hash!==requestHash)throw crmError('This request ID was already used for a different change.',409);
        const [opportunity]=await sql`SELECT * FROM crm_opportunities WHERE id=${receipt.opportunity_id}`;
        return res.json({opportunity,replayed:true});
      }
      const [current]=await sql`SELECT * FROM crm_opportunities WHERE id=${b.id}`;
      if(!['create','save','stage','archive','restore','note'].includes(b.action))throw crmError('Unknown CRM action.');
      if(b.action==='create'&&current)throw crmError('Opportunity already exists. Refresh the pipeline.',409);
      if(b.action!=='create'&&!current)throw crmError('Opportunity not found.',404);
      if(current&&(!Number.isSafeInteger(b.revision)||b.revision!==current.revision))throw crmError('This opportunity changed. Reload it before saving; your form has been kept.',409);
      if(current?.archived&&!['restore'].includes(b.action))throw crmError('Restore the opportunity before making changes.');
      const data=b.action==='create'||b.action==='save'?opportunityData(b.data):b.action==='stage'?opportunityData({...current.data,stage:b.stage}):current.data;
      const archived=b.action==='archive'?true:b.action==='restore'?false:current?.archived||false;
      const detail=b.action==='note'?{note:text(b.note,'Activity note',10000,true)}:{before:current?{...current.data,archived:current.archived}:null,after:{...data,archived}};
      detail.by=access.user?.display_name||access.user?.email||access.email||userId;
      const activityId=randomUUID();let saved;
      if(b.action==='create') {
        saved=await sql`WITH changed AS (
          INSERT INTO crm_opportunities(id,data,created_by) VALUES(${b.id},${JSON.stringify(data)}::jsonb,${userId}) ON CONFLICT DO NOTHING RETURNING *
        ), audit AS (
          INSERT INTO crm_activity(id,opportunity_id,actor_id,kind,detail,request_id,request_hash)
          SELECT ${activityId},id,${userId},${b.action},${JSON.stringify(detail)}::jsonb,${b.requestId},${requestHash} FROM changed RETURNING id
        ) SELECT changed.* FROM changed JOIN audit ON true`;
      } else {
        saved=await sql`WITH changed AS (
          UPDATE crm_opportunities SET data=${JSON.stringify(data)}::jsonb,archived=${archived},revision=revision+1,updated_at=now()
          WHERE id=${b.id} AND revision=${b.revision} RETURNING *
        ), audit AS (
          INSERT INTO crm_activity(id,opportunity_id,actor_id,kind,detail,request_id,request_hash)
          SELECT ${activityId},id,${userId},${b.action},${JSON.stringify(detail)}::jsonb,${b.requestId},${requestHash} FROM changed RETURNING id
        ) SELECT changed.* FROM changed JOIN audit ON true`;
      }
      if(!saved.length)throw crmError('Another change was saved first. Reload the opportunity before retrying.',409);
      return res.json({opportunity:saved[0]});
    }catch(error) {
      if(!error.statusCode)console.error('CRM storage failed',{code:error.code||'unknown'});
      return res.status(error.statusCode||503).json({error:error.statusCode?error.message:'The change could not be confirmed. Refresh to check the saved record before retrying.'});
    }
  };
}
export default createCrmHandler();
