import {requirePermission} from './_lib/app-access.js';
import {validateDemandAssumptions} from '../src/lib/creative-demand.js';
export function createCreativeDemandHandler(authorize = requirePermission) {
  return async function handler(req,res) {
    if(!['GET','POST'].includes(req.method))return res.status(405).end();
    const access=await authorize(req,res,req.method==='POST'?'analytics.write':'analytics.read');
    if(!access)return;
    res.setHeader('Cache-Control','private, no-store');
    const {sql}=access;
    try {
      if(req.method==='POST') {
        let assumptions;try{assumptions=validateDemandAssumptions(req.body?.assumptions||{});}catch(error){return res.status(400).json({error:error.message});}
        await sql`INSERT INTO dashboard_settings (key,value,updated_at) VALUES ('creative_demand_assumptions',${JSON.stringify(assumptions)}::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
        return res.json({assumptions});
      }
      const rows=await sql`SELECT key,value,updated_at FROM dashboard_settings WHERE key IN ('creative_demand_history','creative_demand_assumptions')`;
      const history=rows.find(x=>x.key==='creative_demand_history');
      if(!history)return res.json({history:null,assumptions:null});
      return res.json({history:history.value,updatedAt:history.updated_at,assumptions:rows.find(x=>x.key==='creative_demand_assumptions')?.value??null});
    } catch(error) {
      console.error('Creative demand request failed',error?.code||'unknown');
      return res.status(500).json({error:'Creative demand data could not be loaded. Try again.'});
    }
  };
}
export default createCreativeDemandHandler();
