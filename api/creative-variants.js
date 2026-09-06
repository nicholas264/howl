import { requirePermission } from './_lib/app-access.js';
import { ensureCreativeVariants, readCreativeVariants } from './_lib/creative-variants.js';

export default async function handler(req,res) {
  const access = await requirePermission(req,res,'analytics.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).end();
  try {
    await ensureCreativeVariants(access.sql);
    const days = Math.max(1,Math.min(365,parseInt(req.query?.days,10)||30));
    return res.json({variants:await readCreativeVariants(access.sql,days),days,
      basis:'Current creative definitions and ad-attributed daily metrics. Historical creative changes before ingestion are not reconstructed. Placement-level delivery and causal lift are not inferred.'});
  } catch(error) { return res.status(500).json({error:error.message}); }
}
