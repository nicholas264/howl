// Clears Drive auth cookies (HttpOnly refresh + readable connected flag)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const isProd = process.env.NODE_ENV === 'production';
  const baseAttrs = `Path=/; Max-Age=0; SameSite=Lax${isProd ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', [
    `drive_refresh=; HttpOnly; ${baseAttrs}`,
    `drive_connected=; ${baseAttrs}`,
    `gmail_connected=; ${baseAttrs}`,
  ]);
  res.status(200).json({ ok: true });
}
