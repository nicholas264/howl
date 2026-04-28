// Kicks off the Shopify OAuth install flow.
// Visit: /api/shopify-install?shop=howl-campfires.myshopify.com&role=primary
//        /api/shopify-install?shop=<dealer-shop>.myshopify.com&role=dealer
export default async function handler(req, res) {
  const shop = (req.query.shop || 'howl-campfires.myshopify.com').toString();
  const role = (req.query.role || 'primary').toString();
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!clientId) return res.status(500).send('SHOPIFY_CLIENT_ID not set in Vercel env.');

  const scopes = 'read_reports,read_products,read_orders,read_analytics,read_customers,read_inventory';
  const redirectUri = `https://${req.headers.host}/api/shopify-callback`;
  // State carries the role through the round-trip so the callback knows which env var to instruct.
  const state = `${role}.${Math.random().toString(36).slice(2)}`;
  const url = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
}
