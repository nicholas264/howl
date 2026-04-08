// Handles Google OAuth2 callback — exchanges code for tokens, redirects to app
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

    // Pass refresh token back to frontend via URL param
    res.redirect(`/?drive_token=${encodeURIComponent(tokens.refresh_token)}`);
  } catch {
    res.redirect('/?drive_error=1');
  }
}
