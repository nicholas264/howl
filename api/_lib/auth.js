// Server-side auth helper. Verifies Clerk session JWT from Authorization header.
// Usage at top of each handler:
//   const auth = await requireAuth(req, res); if (!auth) return;
import { createClerkClient, verifyToken } from '@clerk/backend';

let clerk = null;
function getClerk() {
  if (!clerk) clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return clerk;
}

export async function requireAuth(req, res) {
  // Skip auth in local dev if explicitly disabled
  if (process.env.AUTH_DISABLED === 'true') return { userId: 'local-dev', email: 'dev@local' };

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
    return { userId: payload.sub, email: payload.email, payload };
  } catch (err) {
    res.status(401).json({ error: `Unauthorized — ${err.message}` });
    return null;
  }
}
