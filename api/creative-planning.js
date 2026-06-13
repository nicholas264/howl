import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function monthRange(value) {
  const input = /^\d{4}-\d{2}$/.test(value || '') ? value : new Date().toISOString().slice(0, 7);
  const start = new Date(`${input}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { month: input, start: start.toISOString(), end: end.toISOString() };
}

function number(value) {
  return Number(value || 0);
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const range = monthRange(req.query?.month);
    const [deliverables, engagements] = await Promise.all([
      sql`
        SELECT
          d.id, d.title, d.status, d.due_at, d.expected_asset_count,
          d.received_asset_count, d.approved_asset_count,
          d.completed_asset_count, d.shipped_asset_count,
          d.received_at, d.approved_at, d.completed_at, d.shipped_at,
          d.engagement_id, c.id AS creator_id, c.name AS creator_name,
          COALESCE(e.engagement_type, 'unassigned') AS engagement_type
        FROM creator_deliverables d
        JOIN creators c ON c.id = d.creator_id
        LEFT JOIN creator_engagements e ON e.id = d.engagement_id
        WHERE d.due_at >= ${range.start}
          AND d.due_at < ${range.end}
          AND d.status <> 'cancelled'
        ORDER BY d.due_at ASC, c.name ASC
      `,
      sql`
        SELECT
          e.id, e.creator_id, c.name AS creator_name, e.engagement_type,
          e.status, e.approval_date, e.starts_on, e.ends_on,
          e.asset_commitment, e.commitment_period, e.cadence
        FROM creator_engagements e
        JOIN creators c ON c.id = e.creator_id
        WHERE e.status IN ('approved', 'active')
          AND e.asset_commitment IS NOT NULL
          AND e.asset_commitment > 0
          AND (
            (
              e.commitment_period = 'monthly'
              AND e.engagement_type = 'retainer'
              AND COALESCE(e.starts_on, e.approval_date, ${range.start}::date) < ${range.end}::date
              AND COALESCE(e.ends_on, ${range.end}::date) >= ${range.start}::date
            )
            OR (
              e.commitment_period = 'total'
              AND COALESCE(e.approval_date, e.starts_on, e.created_at::date) >= ${range.start}::date
              AND COALESCE(e.approval_date, e.starts_on, e.created_at::date) < ${range.end}::date
            )
          )
        ORDER BY c.name ASC
      `,
    ]);

    const scheduledByEngagement = new Map();
    for (const item of deliverables) {
      if (!item.engagement_id) continue;
      scheduledByEngagement.set(
        String(item.engagement_id),
        (scheduledByEngagement.get(String(item.engagement_id)) || 0) + number(item.expected_asset_count),
      );
    }

    const commitments = engagements.map(item => {
      const committed = number(item.asset_commitment);
      const scheduled = scheduledByEngagement.get(String(item.id)) || 0;
      return {
        ...item,
        asset_commitment: committed,
        scheduled_assets: scheduled,
        unscheduled_assets: Math.max(committed - scheduled, 0),
      };
    });

    const summary = {
      committed: commitments.reduce((sum, item) => sum + item.asset_commitment, 0),
      scheduled: deliverables.reduce((sum, item) => sum + number(item.expected_asset_count), 0),
      received: deliverables.reduce((sum, item) => sum + number(item.received_asset_count), 0),
      approved: deliverables.reduce((sum, item) => sum + number(item.approved_asset_count), 0),
      completed: deliverables.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
      shipped: deliverables.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
      unscheduled: commitments.reduce((sum, item) => sum + item.unscheduled_assets, 0),
      overdue: deliverables.reduce((sum, item) => (
        new Date(item.due_at).getTime() < Date.now()
          ? sum + Math.max(number(item.expected_asset_count) - number(item.completed_asset_count), 0)
          : sum
      ), 0),
    };
    summary.forecast = summary.scheduled + summary.unscheduled;

    const byType = ['retainer', 'one_off', 'unassigned'].map(type => {
      const typeDeliverables = deliverables.filter(item => item.engagement_type === type);
      const typeCommitments = commitments.filter(item => item.engagement_type === type);
      const scheduled = typeDeliverables.reduce((sum, item) => sum + number(item.expected_asset_count), 0);
      const unscheduled = typeCommitments.reduce((sum, item) => sum + item.unscheduled_assets, 0);
      return {
        type,
        committed: typeCommitments.reduce((sum, item) => sum + item.asset_commitment, 0),
        scheduled,
        unscheduled,
        forecast: scheduled + unscheduled,
        completed: typeDeliverables.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
        shipped: typeDeliverables.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
      };
    });

    const weeks = [];
    for (let cursor = new Date(range.start); cursor < new Date(range.end); cursor.setUTCDate(cursor.getUTCDate() + 7)) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(Math.min(
        weekStart.getTime() + 7 * 86400000,
        new Date(range.end).getTime(),
      ));
      const items = deliverables.filter(item => {
        const due = new Date(item.due_at).getTime();
        return due >= weekStart.getTime() && due < weekEnd.getTime();
      });
      weeks.push({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        expected: items.reduce((sum, item) => sum + number(item.expected_asset_count), 0),
        completed: items.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
        shipped: items.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
        deliverables: items.length,
      });
    }

    const risks = deliverables
      .filter(item => number(item.completed_asset_count) < number(item.expected_asset_count))
      .map(item => ({
        ...item,
        remaining: Math.max(number(item.expected_asset_count) - number(item.completed_asset_count), 0),
        risk: new Date(item.due_at).getTime() < Date.now()
          ? 'overdue'
          : new Date(item.due_at).getTime() < Date.now() + 7 * 86400000
            ? 'due_soon'
            : 'scheduled',
      }))
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

    return res.json({
      month: range.month,
      summary,
      by_type: byType,
      weeks,
      commitments,
      deliverables,
      risks,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
