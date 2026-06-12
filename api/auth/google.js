// Initiates Google OAuth2 flow
export default function handler(req, res) {
  const purpose = req.query?.purpose === 'creator_email' ? 'creator_email' : 'drive';
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/gmail.send',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: purpose,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
