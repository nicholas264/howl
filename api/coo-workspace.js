import { requirePermission, hasPermission } from './_lib/app-access.js';
import { canAccessCoo } from '../src/lib/coo-access.js';
import { applyCooCommand } from './_lib/coo.js';
import { emptyWorkspace } from '../src/lib/coo.js';
export function createCooHandler({authorize=requirePermission, now=()=>new Date()}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
    const access=await authorize(req,res,req.method==='GET'?'analytics.read':'analytics.write');
    if(!access) return;
    if(!canAccessCoo(access)) return res.status(403).json({error:'The COO workspace is currently restricted to the owner.'});
    try {
      const {sql,userId}=access;
      const [row]=await sql`SELECT data, revision, updated_at, updated_by FROM coo_workspace WHERE id = 'company'`;
      if(req.method==='GET') return res.json({state:row?.data||emptyWorkspace(),revision:row?.revision||0,canWrite:hasPermission(access,'analytics.write'),updatedAt:row?.updated_at});
      const b=req.body;
      if(!b||!Number.isSafeInteger(b.revision)||b.revision<0) return res.status(400).json({error:'A valid workspace revision is required.'});
      if(b.revision!==(row?.revision||0)) return res.status(409).json({error:'Someone updated the workspace. Refresh before saving again. Your open form has been kept.'});
      let state;
      try {state=applyCooCommand(row?.data,b.command,userId,now());}
      catch(error){return res.status(400).json({error:error.message});}
      const data=JSON.stringify(state);
      if(Buffer.byteLength(data,'utf8')>2500000) return res.status(413).json({error:'Workspace history has reached its storage capacity. Your changes were not saved. Contact an administrator to extend history storage.'});
      let saved;
      if(!row) saved=await sql`INSERT INTO coo_workspace (id,data,updated_by) VALUES ('company',${data}::jsonb,${userId}) ON CONFLICT DO NOTHING RETURNING revision, updated_at`;
      else saved=await sql`UPDATE coo_workspace SET data=${data}::jsonb,revision=revision+1,updated_at=now(),updated_by=${userId} WHERE id='company' AND revision=${b.revision} RETURNING revision,updated_at`;
      if(!saved.length) return res.status(409).json({error:'Someone updated the workspace. Refresh before saving again. Your open form has been kept.'});
      return res.json({state,revision:saved[0].revision,updatedAt:saved[0].updated_at,canWrite:hasPermission(access,'analytics.write')});
    }catch(error){console.error('COO workspace storage failed:',error.code||'unknown');return res.status(503).json({error:'The COO workspace is unavailable. Changes have not been confirmed. Refresh to check whether your update saved before trying again.'});}
  };
}
export default createCooHandler();
