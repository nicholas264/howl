import { createHmac, timingSafeEqual } from 'node:crypto';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 15,
};

const TOKEN_TTL_SECONDS = 10 * 60;

function secret() {
  return process.env.UGC_SOURCE_TOKEN_SECRET
    || process.env.CLERK_SECRET_KEY
    || process.env.DATABASE_URL
    || 'local-ugc-source-secret';
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

export function signUgcSourceToken(sessionId, ttlSeconds = TOKEN_TTL_SECONDS) {
  const payload = base64url(JSON.stringify({
    sid: Number(sessionId),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUgcSourceToken(token, expectedSessionId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.sid) === Number(expectedSessionId) && Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).end();

  const sessionId = Number(req.query?.id);
  if (!sessionId) return res.status(400).json({ error: 'id required' });

  const { sql } = access;
  await ensureCreatorOpsTables(sql);
  const [session] = await sql`
    SELECT id
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  return res.json({
    token: signUgcSourceToken(sessionId),
    expires_in: TOKEN_TTL_SECONDS,
  });
}
