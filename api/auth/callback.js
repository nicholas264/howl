// Handles Google OAuth2 callback — exchanges code for tokens, sets HttpOnly cookie
export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect('/?drive_error=1');
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      return res.redirect('/?drive_error=no_refresh_token');
    }

    const isProd = process.env.NODE_ENV === 'production';
    const baseAttrs = `Path=/; Max-Age=31536000; SameSite=Lax${isProd ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `drive_refresh=${encodeURIComponent(tokens.refresh_token)}; HttpOnly; ${baseAttrs}`,
      `drive_connected=1; ${baseAttrs}`,
    ]);
    res.redirect('/?drive_connected=1');
  } catch {
    res.redirect('/?drive_error=1');
  }
}
