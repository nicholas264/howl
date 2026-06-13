import { neon } from '@neondatabase/serverless';
import { consumeGoogleOAuthState, saveGoogleConnection } from '../_lib/google-user-oauth.js';

// Handles Google OAuth2 callback and stores the refresh token per HOWL user.
export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error || !code) {
    return res.redirect('/?drive_error=1');
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const oauthState = await consumeGoogleOAuthState(sql, state);
    if (!oauthState) return res.redirect('/?drive_error=invalid_state');
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

    let googleEmail = null;
    try {
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileResponse.json();
      googleEmail = profile.email || null;
    } catch {}
    await saveGoogleConnection(sql, {
      userId: oauthState.user_id,
      refreshToken: tokens.refresh_token,
      scopes: (tokens.scope || '').split(/\s+/).filter(Boolean),
      googleEmail,
    });

    const isProd = process.env.NODE_ENV === 'production';
    const baseAttrs = `Path=/; Max-Age=0; SameSite=Lax${isProd ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `drive_refresh=; HttpOnly; ${baseAttrs}`,
      `drive_connected=; ${baseAttrs}`,
      `gmail_connected=; ${baseAttrs}`,
    ]);
    res.redirect(oauthState.purpose === 'creator_email' ? '/?gmail_connected=1' : '/?drive_connected=1');
  } catch {
    res.redirect('/?drive_error=1');
  }
}
