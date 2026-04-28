// Vercel OIDC → GCP STS → service account impersonation, with caller-supplied scopes.
import { getVercelOidcToken } from '@vercel/functions/oidc';

const STS_URL = 'https://sts.googleapis.com/v1/token';

export async function getGoogleAccessToken(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('getGoogleAccessToken requires at least one scope');
  }

  const oidcToken = await getVercelOidcToken();
  const audience = process.env.GCP_WIF_AUDIENCE;
  const saEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  if (!oidcToken) throw new Error('Vercel OIDC token unavailable (ensure OIDC Federation is enabled on the team)');
  if (!audience) throw new Error('GCP_WIF_AUDIENCE not configured');
  if (!saEmail) throw new Error('GCP_SERVICE_ACCOUNT_EMAIL not configured');

  const stsBody = new URLSearchParams({
    audience,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token: oidcToken,
  });
  const stsRes = await fetch(STS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: stsBody,
  });
  const stsData = await stsRes.json();
  if (!stsData.access_token) {
    throw new Error(`STS exchange failed: ${stsData.error_description || JSON.stringify(stsData)}`);
  }

  const impRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:generateAccessToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stsData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scope: scopes, lifetime: '3600s' }),
    }
  );
  const impData = await impRes.json();
  if (!impData.accessToken) {
    throw new Error(`SA impersonation failed: ${impData.error?.message || JSON.stringify(impData)}`);
  }
  return impData.accessToken;
}
