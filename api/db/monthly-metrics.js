import { upsertMonthlySnapshot } from '../_lib/monthly-metrics.js';
import { requirePermission } from '../_lib/app-access.js';

export function createMonthlyMetricsHandler(authorize = requirePermission) {
return async function handler(req, res) {
  const access = await authorize(req, res, req.method === 'GET' ? 'analytics.read' : 'analytics.write');
  if (!access) return;
  const {sql} = access;
  try {

    if (req.method === 'GET') {
      const rows = await sql`SELECT month, shopify, shopify_dealer, meta, google, klaviyo, updated_at FROM monthly_metrics ORDER BY month ASC`;
      return res.json({ rows });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Bulk upsert: { snapshots: [{month, shopify?, shopify_dealer?, meta?}, ...] }
      if (action === 'snapshot') {
        const { snapshots } = req.body || {};
        if (!Array.isArray(snapshots)) return res.status(400).json({ error: 'snapshots[] required' });
        if (snapshots.length > 120 || snapshots.some(s => !s || typeof s !== 'object' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s.month || ''))) return res.status(400).json({error:'Provide up to 120 snapshots with YYYY-MM months'});
        let upserted = 0;
        for (const snapshot of snapshots) {await upsertMonthlySnapshot(sql,snapshot);upserted++;}
        return res.json({ upserted });
      }

      if (action === 'delete') {
        const { month } = req.body || {};
        if (!month) return res.status(400).json({ error: 'month required' });
        await sql`DELETE FROM monthly_metrics WHERE month = ${month}`;
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

}
export default createMonthlyMetricsHandler();
