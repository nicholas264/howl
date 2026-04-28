// One-shot OAuth callback for the Howl Creative Shopify app.
// Visit /api/shopify-install to start the install flow.
// After approval, Shopify redirects here with ?code=... ?shop=... ?state=...
// We exchange code -> permanent shpat_ token and display it.
export default async function handler(req, res) {
  const { code, shop, hmac, state } = req.query;
  if (!code || !shop) {
    return res.status(400).send('Missing code or shop. Start the install at /api/shopify-install');
  }
  // State format: "{role}.{random}" — extract role.
  const role = (state || '').toString().split('.')[0] === 'dealer' ? 'dealer' : 'primary';
  const tokenEnv = role === 'dealer' ? 'SHOPIFY_DEALER_ACCESS_TOKEN' : 'SHOPIFY_ACCESS_TOKEN';
  const storeEnv = role === 'dealer' ? 'SHOPIFY_DEALER_STORE' : 'SHOPIFY_STORE';

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set in Vercel env first.');
  }

  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const d = await r.json();
    if (!d.access_token) {
      return res.status(500).send(`Token exchange failed: ${JSON.stringify(d)}`);
    }

    res.setHeader('Content-Type', 'text/html');
    return res.send(`<!doctype html>
<html><head><title>Shopify token</title>
<style>body{font-family:system-ui;background:#0d1117;color:#f0f4f8;padding:48px;max-width:760px;margin:0 auto}
code{display:block;background:#1c2330;border:1px solid #2a3441;padding:18px;border-radius:6px;font-size:13px;word-break:break-all;margin:12px 0}
.warn{color:#f5a623;font-size:13px}.ok{color:#3fb950;font-weight:700}.role{display:inline-block;padding:3px 10px;border-radius:3px;background:rgba(220,68,10,0.15);color:#DC440A;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-left:8px}</style></head>
<body>
<h1 class="ok">✓ Token issued <span class="role">${role}</span></h1>
<p>Shop: <strong>${shop}</strong></p>
<p>Scopes: ${d.scope}</p>
<p>Permanent Admin API access token:</p>
<code>${d.access_token}</code>
<p class="warn">Copy this NOW. It won't be shown again. Set these in Vercel env:</p>
<code>${storeEnv}=${shop}
${tokenEnv}=${d.access_token}</code>
<p style="font-size:12px;color:#8b949e">CLI alternative:</p>
<code>printf '${shop}' | vercel env add ${storeEnv} production
printf '${d.access_token}' | vercel env add ${tokenEnv} production
vercel --prod</code>
</body></html>`);
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
}
