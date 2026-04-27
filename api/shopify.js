import { requireAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const store = process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com';
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!token) return res.status(500).json({ error: 'SHOPIFY_ACCESS_TOKEN not configured' });

  const GQL = `https://${store}/admin/api/2025-01/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const gql = async (query, variables = {}) => {
    const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const d = await r.json();
    if (d.errors) {
      const msg = Array.isArray(d.errors)
        ? d.errors.map(e => e.message || JSON.stringify(e)).join('; ')
        : typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors);
      throw new Error(`Shopify GraphQL error (HTTP ${r.status}): ${msg}`);
    }
    if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
    return d.data;
  };

  try {
    const { action } = req.body;

    if (action === 'get_analytics') {
      // shopifyqlQuery was removed in API 2024-10. Aggregate orders directly.
      const since = new Date();
      since.setMonth(since.getMonth() - 13);
      since.setDate(1); since.setHours(0, 0, 0, 0);
      const sinceISO = since.toISOString();

      // Paginate through orders. 250 max per page.
      const Q = `query Orders($cursor: String) {
        orders(first: 250, after: $cursor, query: "created_at:>=${sinceISO} financial_status:paid", sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          edges { node {
            id
            createdAt
            netPaymentSet { shopMoney { amount } }
            currentTotalPriceSet { shopMoney { amount } }
            lineItems(first: 50) {
              edges { node {
                name
                quantity
                originalTotalSet { shopMoney { amount } }
              } }
            }
          } }
        }
      }`;

      const orders = [];
      let cursor = null;
      let pages = 0;
      // Hard cap to avoid runaway: 40 pages = 10,000 orders
      while (pages < 40) {
        const data = await gql(Q, { cursor });
        const conn = data.orders;
        for (const e of conn.edges) orders.push(e.node);
        if (!conn.pageInfo.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
        pages++;
      }

      const monthMap = {}; // YYYY-MM → { netSales, orders }
      const productMap = {}; // title → { totalRevenue, totalOrders, months }

      for (const o of orders) {
        const d = new Date(o.createdAt);
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const orderRev = parseFloat(o.netPaymentSet?.shopMoney?.amount || o.currentTotalPriceSet?.shopMoney?.amount || 0);
        if (!monthMap[mKey]) monthMap[mKey] = { netSales: 0, orders: 0 };
        monthMap[mKey].netSales += orderRev;
        monthMap[mKey].orders += 1;

        const productTotalsThisOrder = {};
        for (const li of (o.lineItems?.edges || [])) {
          const title = li.node.name?.split(' - ')[0] || 'Other';
          const rev = parseFloat(li.node.originalTotalSet?.shopMoney?.amount || 0);
          productTotalsThisOrder[title] = (productTotalsThisOrder[title] || 0) + rev;
        }
        for (const [title, rev] of Object.entries(productTotalsThisOrder)) {
          if (!productMap[title]) productMap[title] = { totalRevenue: 0, totalOrders: 0, months: {} };
          productMap[title].totalRevenue += rev;
          productMap[title].totalOrders += 1;
          if (!productMap[title].months[mKey]) productMap[title].months[mKey] = { netSales: 0, orders: 0 };
          productMap[title].months[mKey].netSales += rev;
          productMap[title].months[mKey].orders += 1;
        }
      }

      // Build sorted months array
      const months = Object.entries(monthMap)
        .map(([month, v]) => ({
          month,
          netSales: v.netSales,
          grossSales: v.netSales,
          orders: v.orders,
          sessions: 0, // not available via Admin API
          cvr: 0,
          aov: v.orders > 0 ? v.netSales / v.orders : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      const topProducts = Object.entries(productMap)
        .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
        .slice(0, 8)
        .map(([name, data]) => ({ name, ...data }));

      return res.json({ months, topProducts, _meta: { ordersScanned: orders.length, pages } });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Shopify API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
