// Server-side auth helpers. Verifies Clerk session JWT from Authorization header.
// Usage at top of each handler:
//   const auth = await requireAuth(req, res); if (!auth) return;
//   const auth = await requireAdmin(req, res); if (!auth) return;
import { createClerkClient, verifyToken } from '@clerk/backend';

let clerk = null;
function getClerk() {
  if (!clerk) clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return clerk;
}

const userCache = new Map(); // userId -> { email, ts }
const USER_TTL_MS = 60 * 1000;

async function resolveEmail(userId, payloadEmail) {
  if (payloadEmail) return payloadEmail;
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.ts < USER_TTL_MS) return hit.email;
  try {
    const user = await getClerk().users.getUser(userId);
    const email = user?.primaryEmailAddress?.emailAddress
      || user?.emailAddresses?.[0]?.emailAddress
      || null;
    userCache.set(userId, { email, ts: Date.now() });
    return email;
  } catch {
    return null;
  }
}

export async function requireAuth(req, res) {
  // Local-dev only: bypass requires both AUTH_DISABLED=true AND non-production env.
  if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED === 'true') {
    return { userId: 'local-dev', email: 'dev@local' };
  }

  if (!process.env.CLERK_SECRET_KEY) {
    res.status(500).json({ error: 'CLERK_SECRET_KEY not configured' });
    return null;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized — missing token' });
    return null;
  }

  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    const email = await resolveEmail(payload.sub, payload.email);
    return { userId: payload.sub, email, payload };
  } catch (err) {
    res.status(401).json({ error: `Unauthorized — ${err.message}` });
    return null;
  }
}

// Restricts a route to admins. ADMIN_EMAILS is a comma-separated list.
// In local dev with AUTH_DISABLED, the dev user is treated as admin.
export async function requireAdmin(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED === 'true') return auth;

  const allow = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const email = (auth.email || '').toLowerCase();
  if (!email || !allow.includes(email)) {
    res.status(403).json({ error: 'Forbidden — admin only' });
    return null;
  }
  return auth;
}
