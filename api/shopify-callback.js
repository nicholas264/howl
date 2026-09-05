// Retired unsafe credential-display flow. Integrations use server-configured credentials.
export default async function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'Legacy Shopify token setup is disabled. Configure the Shopify integration with an administrator.' });
}
