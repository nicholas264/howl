import { createHash } from 'node:crypto';

let rateLimitTableReady = null;

async function ensureRateLimitTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_rate_limits (
      route       TEXT NOT NULL,
      bucket_key  TEXT NOT NULL,
      count       INTEGER NOT NULL DEFAULT 0,
      reset_at    TIMESTAMPTZ NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (route, bucket_key)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_app_rate_limits_reset ON app_rate_limits(reset_at)`;
}

export async function ensureRateLimits(sql) {
  if (!rateLimitTableReady) rateLimitTableReady = ensureRateLimitTable(sql);
  try {
    await rateLimitTableReady;
  } catch (err) {
    rateLimitTableReady = null;
    throw err;
  }
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

export function rateLimitKey(req, parts = []) {
  const secret = process.env.RATE_LIMIT_SECRET
    || process.env.CLERK_SECRET_KEY
    || process.env.AUTH_SECRET
    || 'howl-rate-limit';
  return createHash('sha256')
    .update([clientIp(req), ...parts.map(part => String(part || ''))].join(':'))
    .update(`:${secret}`)
    .digest('hex');
}

export async function checkRateLimit(sql, {
  route,
  key,
  limit,
  windowSeconds,
}) {
  await ensureRateLimits(sql);
  const [row] = await sql`
    INSERT INTO app_rate_limits (route, bucket_key, count, reset_at)
    VALUES (${route}, ${key}, 1, now() + (${windowSeconds} || ' seconds')::interval)
    ON CONFLICT (route, bucket_key) DO UPDATE
    SET count = CASE
          WHEN app_rate_limits.reset_at <= now() THEN 1
          ELSE app_rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN app_rate_limits.reset_at <= now() THEN now() + (${windowSeconds} || ' seconds')::interval
          ELSE app_rate_limits.reset_at
        END,
        updated_at = now()
    RETURNING count, reset_at
  `;

  const count = Number(row?.count || 0);
  return {
    allowed: count <= limit,
    count,
    limit,
    resetAt: row?.reset_at,
    retryAfter: Math.max(1, Math.ceil((new Date(row?.reset_at).getTime() - Date.now()) / 1000)),
  };
}

export function sendRateLimited(res, result) {
  res.setHeader('Retry-After', String(result.retryAfter || 60));
  return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
}
