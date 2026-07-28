import { requirePermission } from './_lib/app-access.js';
import { auditDealerWebsites, getMapMonitorSummary, resolveDealerWebsites, runMapMonitor, saveMapSettings, sendMapMonitorTestAlert } from './_lib/map-monitor.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'analytics.read' : 'admin.users';
  const access = await requirePermission(req, res, permission);
  if (!access) return;

  try {
    if (req.method === 'GET') {
      return res.json(await getMapMonitorSummary(access.sql));
    }
    if (req.method === 'POST') {
      const action = req.body?.action || 'run';
      if (action === 'settings') {
        const settings = await saveMapSettings(access.sql, req.body?.settings || {});
        return res.json({ ok: true, settings });
      }
      if (action === 'run') {
        return res.json(await runMapMonitor({ sql: access.sql, force: true }));
      }
      if (action === 'resolve') {
        return res.json(await resolveDealerWebsites({ sql: access.sql, limit: Math.min(Number(req.body?.limit || 20), 30) }));
      }
      if (action === 'audit') {
        return res.json(await auditDealerWebsites({ sql: access.sql, limit: req.body?.limit || 120 }));
      }
      if (action === 'test_alert') {
        return res.json(await sendMapMonitorTestAlert({ sql: access.sql }));
      }
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
