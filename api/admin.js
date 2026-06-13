import { createClerkClient } from '@clerk/backend';
import { ensureAppTables, isValidRole, ROLE_LABELS, ROLE_PERMISSIONS, requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { ensureCreativeAnalysisQueue } from './_lib/creative-analysis-queue.js';
import { getIntegrationHealth, testIntegrationHealth } from './_lib/integration-health.js';

function cleanEmail(value) {
  const email = (value || '').toString().trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function audit(sql, access, action, target, metadata = {}) {
  await sql`
    INSERT INTO app_admin_audit (actor_id, actor_email, action, target, metadata)
    VALUES (${access.userId}, ${access.email || null}, ${action}, ${target || null}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'admin.users');
  if (!access) return;
  const { sql } = access;

  try {
    await ensureAppTables(sql);

    if (req.method === 'GET') {
      await Promise.all([
        ensureCreatorOpsTables(sql),
        ensureCreativeAnalysisQueue(sql),
      ]);
      const users = await sql`
        SELECT user_id, email, display_name, role, status, last_seen_at, created_at, updated_at
        FROM app_users
        ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, lower(email)
      `;
      const invitations = await sql`
        SELECT id, email, role, status, clerk_invitation_id, expires_at, created_at, updated_at
        FROM app_invitations
        ORDER BY created_at DESC
        LIMIT 200
      `;
      const feedback = await sql`
        SELECT id, email, kind, message, page_url, status, created_at
        FROM feedback
        ORDER BY
          CASE status WHEN 'open' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT 100
      `;
      const auditLog = await sql`
        SELECT id, actor_email, action, target, metadata, created_at
        FROM app_admin_audit
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const [creativeHealth] = await sql`
        SELECT
          count(*) FILTER (WHERE status = 'pending')::int AS pending,
          count(*) FILTER (WHERE status = 'processing')::int AS processing,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          max(completed_at) FILTER (WHERE status = 'completed') AS last_completed_at
        FROM creative_analysis_queue
      `;
      const [ugcHealth] = await sql`
        SELECT
          count(*) FILTER (WHERE status IN ('transcription_error', 'render_error'))::int AS failed,
          count(*) FILTER (
            WHERE status IN ('transcribing', 'rendering')
              AND updated_at < now() - interval '15 minutes'
          )::int AS stale,
          count(*) FILTER (WHERE status IN ('transcribing', 'rendering'))::int AS processing
        FROM ugc_sessions
      `;
      const ugcFailures = await sql`
        SELECT
          u.id, u.title, u.status, u.last_error, u.updated_at,
          c.name AS creator_name, a.email AS created_by_email
        FROM ugc_sessions u
        LEFT JOIN creators c ON c.id = u.creator_id
        LEFT JOIN app_users a ON a.user_id = u.user_id
        WHERE u.status IN ('transcription_error', 'render_error')
           OR (
             u.status IN ('transcribing', 'rendering')
             AND u.updated_at < now() - interval '15 minutes'
           )
        ORDER BY u.updated_at DESC
        LIMIT 10
      `;
      const [deliverableHealth] = await sql`
        SELECT count(*)::int AS overdue
        FROM creator_deliverables
        WHERE due_at < now()
          AND status NOT IN ('launched', 'complete', 'cancelled')
      `;
      return res.json({
        users,
        invitations,
        feedback,
        audit_log: auditLog,
        health: {
          creative_analysis: creativeHealth,
          ugc: ugcHealth,
          overdue_deliverables: Number(deliverableHealth?.overdue || 0),
          ugc_failures: ugcFailures,
        },
        roles: ROLE_LABELS,
        permissions: ROLE_PERMISSIONS,
        integrations: getIntegrationHealth(),
      });
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'test_integrations') {
        const integrations = await testIntegrationHealth();
        await audit(sql, access, 'integrations.tested', 'production');
        return res.json({ integrations, checked_at: new Date().toISOString() });
      }
      const email = cleanEmail(req.body?.email);
      const role = req.body?.role;
      if (!email || !isValidRole(role)) return res.status(400).json({ error: 'Valid email and role required' });

      let clerkInvitation = null;
      if (process.env.CLERK_SECRET_KEY) {
        try {
          const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
          const appUrl = process.env.APP_URL
            || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
          clerkInvitation = await clerk.invitations.createInvitation({
            emailAddress: email,
            redirectUrl: appUrl,
            publicMetadata: { howlRole: role },
            ignoreExisting: true,
          });
        } catch (err) {
          if (!/already|exist/i.test(err.message || '')) throw err;
        }
      }

      const [invitation] = await sql`
        INSERT INTO app_invitations (
          email, role, status, clerk_invitation_id, invited_by, expires_at
        ) VALUES (
          ${email}, ${role}, 'pending', ${clerkInvitation?.id || null}, ${access.userId},
          ${clerkInvitation?.expiresAt || null}
        )
        RETURNING *
      `;
      await audit(sql, access, 'invite.sent', email, { role });
      return res.status(201).json({ invitation });
    }

    if (req.method === 'PATCH') {
      if (req.body?.action === 'feedback') {
        const id = Number(req.body.id);
        const status = req.body.status;
        if (!id || !['open', 'planned', 'resolved', 'dismissed'].includes(status)) {
          return res.status(400).json({ error: 'Valid feedback id and status required' });
        }
        const [item] = await sql`
          UPDATE feedback
          SET status = ${status}
          WHERE id = ${id}
          RETURNING id, email, kind, message, page_url, status, created_at
        `;
        if (item) await audit(sql, access, 'feedback.updated', `feedback:${id}`, { status });
        return item ? res.json({ feedback: item }) : res.status(404).json({ error: 'Feedback not found' });
      }
      const { user_id, role, status } = req.body || {};
      if (!user_id) return res.status(400).json({ error: 'user_id required' });
      if (role !== undefined && !isValidRole(role)) return res.status(400).json({ error: 'Invalid role' });
      if (status !== undefined && !['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      if (user_id === access.userId && (status === 'suspended' || (role && role !== 'owner'))) {
        return res.status(400).json({ error: 'You cannot remove your own owner access' });
      }
      const [user] = await sql`
        UPDATE app_users
        SET role = COALESCE(${role || null}, role),
            status = COALESCE(${status || null}, status),
            updated_at = now()
        WHERE user_id = ${user_id}
        RETURNING user_id, email, display_name, role, status, last_seen_at, created_at, updated_at
      `;
      if (user) await audit(sql, access, 'user.updated', user.email, { role, status });
      return user ? res.json({ user }) : res.status(404).json({ error: 'User not found' });
    }

    if (req.method === 'DELETE') {
      const invitationId = Number(req.query.invitation_id || req.body?.invitation_id);
      if (!invitationId) return res.status(400).json({ error: 'invitation_id required' });
      const [invitation] = await sql`
        UPDATE app_invitations
        SET status = 'revoked', updated_at = now()
        WHERE id = ${invitationId}
        RETURNING clerk_invitation_id
      `;
      if (invitation?.clerk_invitation_id) {
        const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
        await clerk.invitations.revokeInvitation(invitation.clerk_invitation_id).catch(() => {});
      }
      await audit(sql, access, 'invite.revoked', `invitation:${invitationId}`);
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
