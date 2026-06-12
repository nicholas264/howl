import { neon } from '@neondatabase/serverless';
import { requireAuth } from './auth.js';

export const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: [
    'creators.read', 'creators.write', 'briefs.read', 'briefs.write',
    'assets.read', 'assets.write', 'launch.read', 'launch.write',
    'analytics.read', 'admin.users',
  ],
  strategist: [
    'creators.read', 'creators.write', 'briefs.read', 'briefs.write',
    'assets.read', 'analytics.read',
  ],
  producer: [
    'creators.read', 'briefs.read', 'briefs.write', 'assets.read',
    'assets.write', 'launch.read',
  ],
  launcher: [
    'creators.read', 'briefs.read', 'assets.read', 'assets.write',
    'launch.read', 'launch.write', 'analytics.read',
  ],
  analyst: ['creators.read', 'assets.read', 'launch.read', 'analytics.read'],
  viewer: ['creators.read', 'briefs.read', 'assets.read', 'launch.read', 'analytics.read'],
};

export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  strategist: 'Strategist',
  producer: 'Producer',
  launcher: 'Launcher',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

export function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

export function hasPermission(access, permission) {
  return access?.permissions?.includes('*') || access?.permissions?.includes(permission);
}

let appTablesReady = null;

async function createAppTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      user_id       TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      display_name  TEXT,
      role          TEXT NOT NULL DEFAULT 'viewer',
      status        TEXT NOT NULL DEFAULT 'active',
      invited_by    TEXT,
      last_seen_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users(lower(email))`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_invitations (
      id                   BIGSERIAL PRIMARY KEY,
      email                TEXT NOT NULL,
      role                 TEXT NOT NULL DEFAULT 'viewer',
      status               TEXT NOT NULL DEFAULT 'pending',
      clerk_invitation_id  TEXT,
      invited_by           TEXT,
      accepted_by          TEXT,
      expires_at           TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_app_invitations_email ON app_invitations(lower(email))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_app_invitations_status ON app_invitations(status)`;
}

export async function ensureAppTables(sql) {
  if (!appTablesReady) appTablesReady = createAppTables(sql);
  try {
    await appTablesReady;
  } catch (err) {
    appTablesReady = null;
    throw err;
  }
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function getAppAccess(auth, sql = neon(process.env.DATABASE_URL)) {
  if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED === 'true') {
    return {
      user: {
        user_id: auth.userId,
        email: auth.email,
        display_name: 'Local Developer',
        role: 'owner',
        status: 'active',
      },
      role: 'owner',
      permissions: ROLE_PERMISSIONS.owner,
      role_labels: ROLE_LABELS,
    };
  }
  await ensureAppTables(sql);
  const email = (auth.email || '').trim().toLowerCase();
  const isBootstrapAdmin = email && adminEmails().includes(email);

  let [user] = await sql`
    SELECT user_id, email, display_name, role, status, last_seen_at, created_at
    FROM app_users
    WHERE user_id = ${auth.userId}
    LIMIT 1
  `;

  if (!user && email) {
    const [invitation] = await sql`
      SELECT id, role
      FROM app_invitations
      WHERE lower(email) = ${email} AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!isBootstrapAdmin && !invitation) {
      return {
        user: null,
        role: 'uninvited',
        permissions: [],
        role_labels: ROLE_LABELS,
      };
    }
    const role = isBootstrapAdmin ? 'owner' : (invitation?.role || 'viewer');
    [user] = await sql`
      INSERT INTO app_users (user_id, email, role, status, last_seen_at)
      VALUES (${auth.userId}, ${email}, ${role}, 'active', now())
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, last_seen_at = now(), updated_at = now()
      RETURNING user_id, email, display_name, role, status, last_seen_at, created_at
    `;
    if (invitation) {
      await sql`
        UPDATE app_invitations
        SET status = 'accepted', accepted_by = ${auth.userId}, updated_at = now()
        WHERE id = ${invitation.id}
      `;
    }
  } else if (user) {
    if (isBootstrapAdmin && user.role !== 'owner') {
      [user] = await sql`
        UPDATE app_users
        SET role = 'owner', last_seen_at = now(), updated_at = now()
        WHERE user_id = ${auth.userId}
        RETURNING user_id, email, display_name, role, status, last_seen_at, created_at
      `;
    } else {
      await sql`UPDATE app_users SET last_seen_at = now() WHERE user_id = ${auth.userId}`;
    }
  }

  const role = isValidRole(user?.role) ? user.role : 'viewer';
  return {
    user,
    role,
    permissions: ROLE_PERMISSIONS[role],
    role_labels: ROLE_LABELS,
  };
}

export async function requirePermission(req, res, permission) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  try {
    const sql = neon(process.env.DATABASE_URL);
    const access = await getAppAccess(auth, sql);
    if (!access.user || access.user.status !== 'active' || !hasPermission(access, permission)) {
      res.status(403).json({ error: `Forbidden - ${permission} required` });
      return null;
    }
    return { ...auth, ...access, sql };
  } catch (err) {
    res.status(500).json({ error: `Access check failed: ${err.message}` });
    return null;
  }
}
