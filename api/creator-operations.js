import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const items = await sql`
      WITH creator_state AS (
        SELECT
          c.id, c.name, c.email, c.avatar_url, c.stage, c.status, c.updated_at,
          follow_up.next_follow_up_at,
          overdue.due_at AS overdue_due_at,
          overdue.title AS overdue_title,
          agreement.sent_at AS agreement_sent_at,
          agreement.expires_at AS agreement_expires_at,
          submission.expires_at AS submission_expires_at,
          EXISTS (
            SELECT 1 FROM creator_outreach o
            WHERE o.creator_id = c.id
              AND o.direction = 'outbound'
              AND o.status IN ('sent', 'follow_up', 'replied', 'closed')
          ) AS has_sent_outreach,
          EXISTS (
            SELECT 1 FROM creator_outreach o
            WHERE o.creator_id = c.id
              AND (
                o.direction = 'inbound' OR o.replied_at IS NOT NULL
                OR o.status = 'replied' OR o.outcome IN ('interested', 'contracted')
              )
          ) OR c.stage IN ('interested', 'briefing', 'producing', 'active') AS has_interest,
          EXISTS (
            SELECT 1 FROM creator_engagements e
            WHERE e.creator_id = c.id AND e.status = 'draft'
          ) AS has_draft_engagement,
          EXISTS (
            SELECT 1 FROM creator_engagements e
            WHERE e.creator_id = c.id AND e.status IN ('approved', 'active')
          ) AS has_live_engagement,
          EXISTS (
            SELECT 1 FROM creator_agreements a
            WHERE a.creator_id = c.id AND a.status = 'accepted'
          ) AS has_accepted_agreement,
          EXISTS (
            SELECT 1 FROM creator_agreements a
            WHERE a.creator_id = c.id AND a.status = 'sent'
          ) AS has_sent_agreement,
          EXISTS (
            SELECT 1 FROM creator_briefs b WHERE b.creator_id = c.id
          ) AS has_brief,
          EXISTS (
            SELECT 1 FROM creator_deliverables d
            WHERE d.creator_id = c.id AND d.status <> 'cancelled'
          ) AS has_deliverable,
          EXISTS (
            SELECT 1 FROM creator_submission_links l
            WHERE l.creator_id = c.id AND l.status = 'active' AND l.expires_at > now()
          ) AS has_active_submission,
          EXISTS (
            SELECT 1 FROM creator_deliverables d
            WHERE d.creator_id = c.id
              AND (
                d.received_asset_count > 0
                OR d.status IN ('received', 'editing', 'edited', 'approved', 'complete', 'launched')
              )
          ) AS has_received,
          EXISTS (
            SELECT 1 FROM creator_deliverables d
            WHERE d.creator_id = c.id
              AND (d.completed_asset_count > 0 OR d.status IN ('complete', 'launched'))
          ) AS has_completed,
          EXISTS (
            SELECT 1 FROM creator_deliverables d
            WHERE d.creator_id = c.id
              AND (d.shipped_asset_count > 0 OR d.status = 'launched')
          ) OR EXISTS (
            SELECT 1 FROM launch_history l
            WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)
          ) AS has_launched
        FROM creators c
        LEFT JOIN LATERAL (
          SELECT min(o.next_follow_up_at) AS next_follow_up_at
          FROM creator_outreach o
          WHERE o.creator_id = c.id
            AND o.next_follow_up_at IS NOT NULL
            AND o.replied_at IS NULL AND o.outcome IS NULL
            AND o.status IN ('sent', 'follow_up')
        ) follow_up ON true
        LEFT JOIN LATERAL (
          SELECT d.title, d.due_at
          FROM creator_deliverables d
          WHERE d.creator_id = c.id
            AND d.due_at < now()
            AND d.status NOT IN ('complete', 'launched', 'cancelled')
            AND d.completed_asset_count < d.expected_asset_count
          ORDER BY d.due_at ASC LIMIT 1
        ) overdue ON true
        LEFT JOIN LATERAL (
          SELECT a.sent_at, a.expires_at
          FROM creator_agreements a
          WHERE a.creator_id = c.id AND a.status = 'sent'
          ORDER BY a.sent_at DESC NULLS LAST LIMIT 1
        ) agreement ON true
        LEFT JOIN LATERAL (
          SELECT l.expires_at
          FROM creator_submission_links l
          WHERE l.creator_id = c.id AND l.status = 'active' AND l.expires_at > now()
          ORDER BY l.created_at DESC LIMIT 1
        ) submission ON true
        WHERE c.status <> 'inactive' AND c.stage <> 'alumni'
      ),
      classified AS (
        SELECT *,
          CASE
            WHEN email IS NULL THEN 'add_contact'
            WHEN NOT has_sent_outreach AND NOT has_interest THEN 'start_outreach'
            WHEN next_follow_up_at <= now() THEN 'follow_up'
            WHEN has_sent_outreach AND NOT has_interest THEN 'await_reply'
            WHEN NOT has_draft_engagement AND NOT has_live_engagement THEN 'define_terms'
            WHEN has_draft_engagement AND NOT has_live_engagement THEN 'approve_terms'
            WHEN has_live_engagement AND NOT has_accepted_agreement AND has_sent_agreement THEN 'await_agreement'
            WHEN has_live_engagement AND NOT has_accepted_agreement THEN 'send_agreement'
            WHEN has_accepted_agreement AND NOT has_brief THEN 'build_brief'
            WHEN has_brief AND NOT has_deliverable AND NOT has_active_submission THEN 'send_assignment'
            WHEN overdue_due_at IS NOT NULL THEN 'production_overdue'
            WHEN NOT has_received THEN 'await_footage'
            WHEN NOT has_completed THEN 'finish_edit'
            WHEN NOT has_launched THEN 'launch_asset'
            ELSE 'review_performance'
          END AS action_key
        FROM creator_state
      )
      SELECT *,
        CASE action_key
          WHEN 'add_contact' THEN 'Add creator email'
          WHEN 'start_outreach' THEN 'Start creator outreach'
          WHEN 'follow_up' THEN 'Follow up now'
          WHEN 'await_reply' THEN 'Await creator reply'
          WHEN 'define_terms' THEN 'Define commercial terms'
          WHEN 'approve_terms' THEN 'Approve commercial terms'
          WHEN 'await_agreement' THEN 'Await agreement acceptance'
          WHEN 'send_agreement' THEN 'Prepare and send agreement'
          WHEN 'build_brief' THEN 'Build creator brief'
          WHEN 'send_assignment' THEN 'Send creator assignment'
          WHEN 'production_overdue' THEN 'Resolve overdue deliverable'
          WHEN 'await_footage' THEN 'Await creator footage'
          WHEN 'finish_edit' THEN 'Edit and approve footage'
          WHEN 'launch_asset' THEN 'Ready for launch'
          ELSE 'Review creator performance'
        END AS action_label,
        CASE
          WHEN action_key IN ('follow_up', 'production_overdue') THEN 'urgent'
          WHEN action_key IN ('await_reply', 'await_agreement', 'await_footage') THEN 'waiting'
          WHEN action_key IN ('add_contact') THEN 'blocked'
          ELSE 'action'
        END AS action_state,
        CASE
          WHEN action_key IN ('add_contact') THEN 'profile'
          WHEN action_key IN ('start_outreach', 'follow_up', 'await_reply') THEN 'outreach'
          WHEN action_key IN ('define_terms', 'approve_terms', 'await_agreement', 'send_agreement') THEN 'agreements'
          WHEN action_key IN ('build_brief', 'send_assignment') THEN 'briefs'
          WHEN action_key IN ('production_overdue', 'await_footage', 'finish_edit', 'launch_asset') THEN 'deliverables'
          ELSE 'performance'
        END AS target_tab,
        CASE
          WHEN action_key IN ('start_outreach', 'follow_up', 'await_reply') THEN 'outreach'
          WHEN action_key IN ('define_terms', 'approve_terms', 'await_agreement', 'send_agreement') THEN 'contracts'
          WHEN action_key IN ('build_brief', 'send_assignment') THEN 'creative'
          WHEN action_key IN ('production_overdue', 'await_footage', 'finish_edit', 'launch_asset') THEN 'production'
          WHEN action_key = 'review_performance' THEN 'performance'
          ELSE 'data'
        END AS category,
        CASE
          WHEN action_key = 'follow_up' THEN next_follow_up_at
          WHEN action_key = 'production_overdue' THEN overdue_due_at
          WHEN action_key = 'await_agreement' THEN agreement_expires_at
          WHEN action_key = 'await_footage' THEN submission_expires_at
          ELSE NULL
        END AS action_date
      FROM classified
      ORDER BY
        CASE
          WHEN action_key = 'production_overdue' THEN 0
          WHEN action_key = 'follow_up' THEN 1
          WHEN action_key = 'add_contact' THEN 2
          WHEN action_key IN ('define_terms', 'approve_terms', 'send_agreement', 'build_brief', 'send_assignment', 'finish_edit', 'launch_asset') THEN 3
          WHEN action_key IN ('await_reply', 'await_agreement', 'await_footage') THEN 4
          ELSE 5
        END,
        action_date ASC NULLS LAST,
        updated_at ASC
    `;

    const summary = items.reduce((result, item) => {
      result.total += 1;
      result[item.action_state] = (result[item.action_state] || 0) + 1;
      result.categories[item.category] = (result.categories[item.category] || 0) + 1;
      return result;
    }, { total: 0, urgent: 0, action: 0, waiting: 0, blocked: 0, categories: {} });

    return res.json({ items, summary, generated_at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
