import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { mapClickupStatus } from './_lib/clickup-creators.js';

async function loadSetup(sql) {
  const [statusRows, healthRows, attributionRows] = await Promise.all([
    sql`
      SELECT
        source_metadata->>'clickup_status' AS raw_status,
        stage,
        status,
        count(*)::int AS count
      FROM creators
      WHERE source_metadata->>'clickup_status' IS NOT NULL
      GROUP BY source_metadata->>'clickup_status', stage, status
      ORDER BY count(*) DESC
    `,
    sql`
      SELECT
        count(*) FILTER (
          WHERE status <> 'inactive' AND stage <> 'alumni'
            AND stage IN ('interested', 'briefing', 'producing', 'active')
            AND (
              email IS NULL OR niche IS NULL OR strengths IS NULL
              OR audience_demographics IS NULL OR rate_notes IS NULL
          )
        )::int AS priority_profile_gaps,
        count(*) FILTER (
          WHERE source = 'clickup' AND email IS NULL
        )::int AS clickup_missing_email,
        (
          SELECT count(*)::int FROM (
            SELECT lower(email)
            FROM creators
            WHERE email IS NOT NULL
            GROUP BY lower(email)
            HAVING count(*) > 1
            UNION ALL
            SELECT platform || ':' || lower(regexp_replace(trim(handle), '^@', ''))
            FROM creator_social_accounts
            WHERE handle IS NOT NULL AND length(trim(handle)) > 1
            GROUP BY platform, lower(regexp_replace(trim(handle), '^@', ''))
            HAVING count(DISTINCT creator_id) > 1
          ) duplicates
        ) AS duplicate_groups
      FROM creators
    `,
    sql`
      WITH live_groups AS (
        SELECT DISTINCT cp.group_key
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE i.date BETWEEN current_date - 14 AND current_date
          AND (i.spend > 0 OR i.impressions > 0)
      )
      SELECT
        count(*)::int AS total_groups,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM creative_creator_assignments a
            WHERE a.group_key = live_groups.group_key
          ) OR EXISTS (
            SELECT 1 FROM creative_assets asset
            WHERE asset.group_key = live_groups.group_key AND asset.creator_id IS NOT NULL
          ) OR EXISTS (
            SELECT 1
            FROM launch_history launch
            JOIN creative_performance cp ON cp.ad_id = launch.ad_id
            WHERE cp.group_key = live_groups.group_key AND launch.creator_id IS NOT NULL
          )
        )::int AS assigned_groups
      FROM live_groups
    `,
  ]);

  const grouped = new Map();
  for (const row of statusRows) {
    const rawStatus = row.raw_status || 'No status';
    const mapping = mapClickupStatus(rawStatus);
    const currentCount = Number(row.count || 0);
    const current = grouped.get(rawStatus) || {
      raw_status: rawStatus,
      count: 0,
      current: new Map(),
      ...mapping,
    };
    current.count += currentCount;
    current.current.set(`${row.stage}/${row.status}`, (current.current.get(`${row.stage}/${row.status}`) || 0) + currentCount);
    grouped.set(rawStatus, current);
  }

  const statusMappings = Array.from(grouped.values()).map(item => ({
    raw_status: item.raw_status,
    count: item.count,
    stage: item.stage,
    status: item.status,
    mapping_key: item.mapping_key,
    confidence: item.confidence,
    mismatched_count: Array.from(item.current.entries()).reduce(
      (sum, [key, count]) => sum + (key === `${item.stage}/${item.status}` ? 0 : count),
      0,
    ),
  }));
  const verifiedMismatchCount = statusMappings
    .filter(item => item.confidence === 'high')
    .reduce((sum, item) => sum + item.mismatched_count, 0);
  const reviewCount = statusMappings
    .filter(item => item.confidence === 'review')
    .reduce((sum, item) => sum + item.count, 0);
  const health = healthRows[0] || {};
  const attribution = attributionRows[0] || {};
  const unassignedGroups = Math.max(0, Number(attribution.total_groups || 0) - Number(attribution.assigned_groups || 0));

  return {
    status_mappings: statusMappings,
    verified_mismatch_count: verifiedMismatchCount,
    review_status_count: reviewCount,
    duplicate_groups: Number(health.duplicate_groups || 0),
    priority_profile_gaps: Number(health.priority_profile_gaps || 0),
    clickup_missing_email: Number(health.clickup_missing_email || 0),
    creative_unassigned_groups: unassignedGroups,
    steps: [
      verifiedMismatchCount > 0 && {
        key: 'clickup_mapping',
        title: 'Clean up ClickUp lifecycle stages',
        detail: 'Apply verified mappings so denied, completed, proven, and producing creators land in the right workflow.',
        count: verifiedMismatchCount,
        action: 'Apply verified mappings',
      },
      reviewCount > 0 && {
        key: 'clickup_review',
        title: 'Review unfamiliar ClickUp statuses',
        detail: 'These statuses need an explicit decision before HOWL should move the creators.',
        count: reviewCount,
        action: 'Review mappings',
      },
      Number(health.clickup_missing_email || 0) > 0 && {
        key: 'clickup_email',
        title: 'Repair creator emails from ClickUp',
        detail: 'Read the visible ClickUp view and full task records to restore application emails automatically.',
        count: Number(health.clickup_missing_email || 0),
        action: 'Repair emails',
      },
      Number(health.duplicate_groups || 0) > 0 && {
        key: 'duplicates',
        title: 'Merge duplicate creator records',
        detail: 'Consolidate history, social profiles, rates, and creative attribution into one usable record.',
        count: Number(health.duplicate_groups || 0),
        action: 'Open data health',
      },
      Number(health.priority_profile_gaps || 0) > 0 && {
        key: 'profiles',
        title: 'Complete high-priority creator profiles',
        detail: 'Focus only on qualified, briefing, producing, and active creators missing decision-critical information.',
        count: Number(health.priority_profile_gaps || 0),
        action: 'Open profile gaps',
      },
      unassignedGroups > 0 && {
        key: 'attribution',
        title: 'Match live creative to creators',
        detail: 'Connect current Meta performance to creator records so planning can learn from what actually worked.',
        count: unassignedGroups,
        action: 'Open attribution',
      },
    ].filter(Boolean),
  };
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'creators.read' : 'creators.write';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'POST') {
      if (req.body?.action !== 'apply_clickup_status_mapping') return res.status(405).end();
      const statuses = await sql`
        SELECT DISTINCT source_metadata->>'clickup_status' AS raw_status
        FROM creators
        WHERE source_metadata->>'clickup_status' IS NOT NULL
      `;
      let updated = 0;
      for (const row of statuses) {
        const mapping = mapClickupStatus(row.raw_status);
        if (mapping.confidence !== 'high') continue;
        const changed = await sql`
          UPDATE creators SET
            stage = ${mapping.stage},
            status = ${mapping.status},
            source_metadata = source_metadata || ${JSON.stringify({
              clickup_mapping_key: mapping.mapping_key,
              clickup_mapping_confidence: mapping.confidence,
              clickup_mapped_stage: mapping.stage,
              clickup_mapped_status: mapping.status,
            })}::jsonb,
            updated_at = now()
          WHERE source_metadata->>'clickup_status' = ${row.raw_status}
            AND (stage <> ${mapping.stage} OR status <> ${mapping.status})
          RETURNING id
        `;
        updated += changed.length;
      }
      return res.json({ ok: true, updated, setup: await loadSetup(sql) });
    }
    if (req.method !== 'GET') return res.status(405).end();
    const items = await sql`
      WITH creator_state AS (
        SELECT
          c.id, c.name, c.email, c.avatar_url, c.stage, c.status, c.updated_at,
          c.product_seeding_required,
          (
            c.shipping_address1 IS NOT NULL
            AND c.shipping_city IS NOT NULL
            AND c.shipping_region IS NOT NULL
            AND c.shipping_postal_code IS NOT NULL
            AND c.shipping_country_code IS NOT NULL
          ) AS shipping_ready,
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
          (
            c.product_seeding_required = false
            OR EXISTS (
              SELECT 1 FROM creator_product_seeds s
              WHERE s.creator_id = c.id
                AND s.status IN ('ordered', 'shipped', 'delivered')
            )
            OR EXISTS (
              SELECT 1 FROM creator_deliverables d
              WHERE d.creator_id = c.id AND d.status <> 'cancelled'
            )
            OR EXISTS (
              SELECT 1 FROM launch_history l
              WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)
            )
          ) AS product_ready,
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
            WHEN has_brief AND NOT product_ready AND NOT shipping_ready THEN 'add_shipping'
            WHEN has_brief AND NOT product_ready THEN 'seed_product'
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
          WHEN 'add_shipping' THEN 'Add shipping address'
          WHEN 'seed_product' THEN 'Seed creator product'
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
          WHEN action_key IN ('add_contact', 'add_shipping') THEN 'blocked'
          ELSE 'action'
        END AS action_state,
        CASE
          WHEN action_key IN ('add_contact', 'add_shipping') THEN 'profile'
          WHEN action_key = 'seed_product' THEN 'products'
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
          WHEN action_key = 'seed_product' THEN 'product'
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
          WHEN action_key IN ('add_contact', 'add_shipping') THEN 2
          WHEN action_key IN ('define_terms', 'approve_terms', 'send_agreement', 'build_brief', 'seed_product', 'send_assignment', 'finish_edit', 'launch_asset') THEN 3
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

    return res.json({
      items,
      summary,
      setup: await loadSetup(sql),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
