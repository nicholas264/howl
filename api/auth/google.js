import { requirePermission } from '../_lib/app-access.js';
import { createGoogleOAuthState, getGoogleConnection } from '../_lib/google-user-oauth.js';

export default async function handler(req, res) {
  const requestedPurpose=req.body?.purpose || req.query?.purpose;
  const purpose=['creator_email','static_studio'].includes(requestedPurpose)?requestedPurpose:'drive';
  const access = await requirePermission(req, res, purpose === 'creator_email' ? 'briefs.write' : 'assets.write');
  if (!access) return;
  const { sql } = access;

  if (req.method === 'GET') {
    const connection = await getGoogleConnection(sql, access.userId);
    return res.json({ connected: Boolean(connection), connection });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const state = await createGoogleOAuthState(sql, access.userId, purpose);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    include_granted_scopes: 'true',
    scope: (purpose==='static_studio' ? ['openid','email','https://www.googleapis.com/auth/drive.readonly'] : [
      'openid',
      'email',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ]).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}
