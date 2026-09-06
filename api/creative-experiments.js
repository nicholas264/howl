import { requirePermission } from './_lib/app-access.js';
import { ensureExperiments,validateProtocol,experimentEvidence,bindExperimentAds } from './_lib/experiments.js';
import { ensureCreativeVariants } from './_lib/creative-variants.js';

export default async function handler(req,res) {
  const access=await requirePermission(req,res,req.method==='GET'?'analytics.read':'analytics.write');
  if (!access) return;
  const {sql}=access;
  try {
    await ensureExperiments(sql); await ensureCreativeVariants(sql);
    if (req.method==='GET') {
      const experiments=await sql`SELECT * FROM creative_experiments ORDER BY created_at DESC LIMIT 100`;
      const items=[];
      for (const experiment of experiments) items.push({...experiment,evidence:await experimentEvidence(sql,experiment)});
      return res.json({experiments:items});
    }
    if (req.method==='POST') {
      const {name,hypothesis,protocol}=req.body || {};
      if (typeof name!=='string' || !name.trim() || name.length>200 || typeof hypothesis!=='string' || hypothesis.trim().length<10 || hypothesis.length>2000) return res.status(400).json({error:'A name and a specific hypothesis are required'});
      const validated=await bindExperimentAds(sql,validateProtocol(protocol || {}));
      const [experiment]=await sql`INSERT INTO creative_experiments (name,hypothesis,protocol,created_by)
        VALUES (${name.trim()},${hypothesis.trim()},${JSON.stringify(validated)}::jsonb,${access.userId}) RETURNING *`;
      return res.status(201).json({experiment});
    }
    if (req.method==='PATCH') {
      const {id,selected_variant,reason}=req.body || {};
      const [experiment]=await sql`SELECT * FROM creative_experiments WHERE id=${Number(id)||0}`;
      if (!experiment) return res.status(404).json({error:'Experiment not found'});
      if (typeof reason!=='string' || reason.trim().length<10 || reason.length>2000) return res.status(400).json({error:'Record the reason for this decision'});
      const evidence=await experimentEvidence(sql,experiment);
      if (selected_variant && (!experiment.protocol.variants.includes(selected_variant) || !evidence.sufficient)) return res.status(409).json({error:'A variant can be selected only after the observation window and minimum evidence requirements are met'});
      const decision={selected_variant:selected_variant || null,reason:reason.trim(),evidence,causal_lift_proven:false};
      const [saved]=await sql`UPDATE creative_experiments SET status='decided',decision=${JSON.stringify(decision)}::jsonb,decided_by=${access.userId},decided_at=now()
        WHERE id=${experiment.id} AND status='running' RETURNING *`;
      return saved ? res.json({experiment:saved}) : res.status(409).json({error:'A decision has already been recorded'});
    }
    return res.status(405).end();
  } catch(error) {return res.status(req.method==='POST'?400:500).json({error:error.message});}
}
