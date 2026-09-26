import { requirePermission, hasPermission } from './_lib/app-access.js';
import { canAccessOrganization } from '../src/lib/organization.js';
import { applyOrganizationCommand } from './_lib/organization.js';
import { acquireConnection,releaseConnection } from './_lib/finance.js';
import { fetchQuickBooksPeople,matchQuickBooksPerson,importQuickBooksPeople } from './_lib/organization-quickbooks.js';
const emptyWorkspace=()=>({people:[],history:[]});
export function createOrganizationHandler({authorize=requirePermission, now=()=>new Date(),env=process.env,fetcher=fetch,acquire=acquireConnection,release=releaseConnection,fetchPeople=fetchQuickBooksPeople}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
    const access=await authorize(req,res,req.method==='GET'?'admin.users':'admin.users');
    if(!access) return;
    if(!canAccessOrganization(access)) return res.status(403).json({error:'The Organization chart is currently restricted to the owner.'});
    try {
      const {sql,userId}=access;
      const [row]=await sql`SELECT data, revision, updated_at, updated_by FROM organization_workspace WHERE id = 'company'`;
      if(req.method==='GET'&&req.query?.source==='quickbooks'){
        const c=await acquire(sql,env,fetcher);
        try{const candidates=await fetchPeople(c,env,fetcher);return res.json({candidates:candidates.map(p=>({...p,status:matchQuickBooksPerson(row?.data?.people||[],p).status}))});}
        finally{await release(sql,c.version);}
      }
      if(req.method==='GET') return res.json({state:row?.data||emptyWorkspace(),revision:row?.revision||0,canWrite:hasPermission(access,'admin.users'),updatedAt:row?.updated_at});
      const b=req.body;
      if(!b||!Number.isSafeInteger(b.revision)||b.revision<0) return res.status(400).json({error:'A valid workspace revision is required.'});
      if(b.revision!==(row?.revision||0)) return res.status(409).json({error:'Someone updated the workspace. Refresh before saving again. Your open form has been kept.'});
      let state,summary,connectionVersion=null;
      try {
        if(b.command?.action==='import-quickbooks'){
          const c=await acquire(sql,env,fetcher);
          try{
            connectionVersion=c.version;
            const candidates=await fetchPeople(c,env,fetcher);
            const [connected]=await sql`SELECT version FROM finance_connection WHERE id='company' AND version=${c.version}`;
            if(!connected)throw new Error('QuickBooks connection changed. Reload the roster.');
            ({state,summary}=importQuickBooksPeople(row?.data,candidates,b.command.selections,userId,now()));
          }finally{await release(sql,c.version);}
        }else state=applyOrganizationCommand(row?.data,b.command,userId,now());
      }
      catch(error){return res.status(400).json({error:error.message});}
      const data=JSON.stringify(state);
      if(Buffer.byteLength(data,'utf8')>2500000) return res.status(413).json({error:'Workspace history has reached its storage capacity. Your changes were not saved. Contact an administrator to extend history storage.'});
      let saved;
      if(connectionVersion&&!row) saved=await sql`INSERT INTO organization_workspace (id,data,updated_by) SELECT 'company',${data}::jsonb,${userId} WHERE EXISTS(SELECT 1 FROM finance_connection WHERE id='company' AND version=${connectionVersion}) ON CONFLICT DO NOTHING RETURNING revision, updated_at`;
      else if(connectionVersion) saved=await sql`UPDATE organization_workspace SET data=${data}::jsonb,revision=revision+1,updated_at=now(),updated_by=${userId} WHERE id='company' AND revision=${b.revision} AND EXISTS(SELECT 1 FROM finance_connection WHERE id='company' AND version=${connectionVersion}) RETURNING revision,updated_at`;
      else if(!row) saved=await sql`INSERT INTO organization_workspace (id,data,updated_by) VALUES ('company',${data}::jsonb,${userId}) ON CONFLICT DO NOTHING RETURNING revision, updated_at`;
      else saved=await sql`UPDATE organization_workspace SET data=${data}::jsonb,revision=revision+1,updated_at=now(),updated_by=${userId} WHERE id='company' AND revision=${b.revision} RETURNING revision,updated_at`;
      if(!saved.length) return res.status(409).json({error:'Someone updated the workspace. Refresh before saving again. Your open form has been kept.'});
      return res.json({state,summary,revision:saved[0].revision,updatedAt:saved[0].updated_at,canWrite:hasPermission(access,'admin.users')});
    }catch(error){console.error('Organization chart storage failed:',error.code||'unknown');return res.status(503).json({error:req.method==='GET'&&req.query?.source==='quickbooks'&&!error.code?error.message:'The Organization chart is unavailable. Changes have not been confirmed. Refresh to check whether your update saved before trying again.'});}
  };
}
export default createOrganizationHandler();
