import { createClerkClient } from '@clerk/backend';
import { ensureAppTables, isValidRole, ROLE_LABELS, ROLE_PERMISSIONS, requirePermission } from './_lib/app-access.js';

function cleanEmail(value) {
  const email = (value || '').toString().trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'admin.users');
  if (!access) return;
  const { sql } = access;

  try {
    await ensureAppTables(sql);

    if (req.method === 'GET') {
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
      return res.json({ users, invitations, roles: ROLE_LABELS, permissions: ROLE_PERMISSIONS });
    }

    if (req.method === 'POST') {
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
      return res.status(201).json({ invitation });
    }

    if (req.method === 'PATCH') {
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
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
