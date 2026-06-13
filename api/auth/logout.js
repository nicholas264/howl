// Clears Drive auth cookies (HttpOnly refresh + readable connected flag)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  await disconnectGoogle(neon(process.env.DATABASE_URL), auth.userId);
  const isProd = process.env.NODE_ENV === 'production';
  const baseAttrs = `Path=/; Max-Age=0; SameSite=Lax${isProd ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', [
    `drive_refresh=; HttpOnly; ${baseAttrs}`,
    `drive_connected=; ${baseAttrs}`,
    `gmail_connected=; ${baseAttrs}`,
  ]);
  res.status(200).json({ ok: true });
}
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';
import { disconnectGoogle } from '../_lib/google-user-oauth.js';
