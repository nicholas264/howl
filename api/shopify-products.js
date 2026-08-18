import { requirePermission } from './_lib/app-access.js';
import { getShopifyAccessToken, shopifyContentConfig } from './_lib/shopify-content.js';

async function shopifyGraphql(query, variables = {}) {
  const { store, configured } = shopifyContentConfig();
  if (!configured) throw new Error('Shopify store is not connected');
  const token = await getShopifyAccessToken();
  const response = await fetch(`https://${store}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    throw new Error(data.errors?.map(error => error.message).join('; ') || `Shopify returned ${response.status}`);
  }
  return { data: data.data, store };
}

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, 'creators.read'))) return;
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { data, store } = await shopifyGraphql(`query CreatorSeedProducts {
      products(first: 100, query: "status:active", sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            description
            featuredMedia { preview { image { url } } }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryItem { unitCost { amount currencyCode } }
                  availableForSale
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
    }`);
    const products = (data.products?.edges || []).map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      description: node.description,
      image_url: node.featuredMedia?.preview?.image?.url || null,
      variants: (node.variants?.edges || []).map(({ node: variant }) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: Number(variant.price || 0),
        unit_cost: variant.inventoryItem?.unitCost ? Number(variant.inventoryItem.unitCost.amount || 0) : null,
        unit_cost_currency: variant.inventoryItem?.unitCost?.currencyCode || null,
        available_for_sale: Boolean(variant.availableForSale),
        inventory_quantity: variant.inventoryQuantity,
      })),
    }));
    return res.json({ connected: true, store, products });
  } catch (err) {
    return res.status(502).json({ connected: false, error: err.message });
  }
}
