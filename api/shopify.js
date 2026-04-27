export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const store = process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com';
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!token) return res.status(500).json({ error: 'SHOPIFY_ACCESS_TOKEN not configured' });

  const GQL = `https://${store}/admin/api/2025-01/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const runQuery = async (shopifyql) => {
    const escaped = shopifyql.replace(/"/g, '\\"');
    const r = await fetch(GQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: "${escaped}") { parseErrors tableData { rows columns { name dataType } } } }`,
      }),
    });
    const d = await r.json();
    // Check for GraphQL-level errors (auth, scope issues). errors can be array, object, or string.
    if (d.errors) {
      const msg = Array.isArray(d.errors)
        ? d.errors.map(e => e.message || JSON.stringify(e)).join('; ')
        : typeof d.errors === 'string' ? d.errors
        : JSON.stringify(d.errors);
      throw new Error(`Shopify GraphQL error (HTTP ${r.status}): ${msg}`);
    }
    if (!r.ok) {
      throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
    }
    const result = d.data?.shopifyqlQuery;
    if (!result) {
      throw new Error(`No shopifyqlQuery in response: ${JSON.stringify(d).slice(0, 500)}`);
    }
    if (result.parseErrors?.length) {
      throw new Error(`ShopifyQL parse error: ${JSON.stringify(result.parseErrors)}`);
    }
    // Rows come back as objects already keyed by column name
    return result?.tableData?.rows || [];
  };

  try {
    const { action } = req.body;

    if (action === 'get_analytics') {
      const [salesRows, sessionRows, productRows] = await Promise.all([
        runQuery('FROM sales SHOW net_sales, gross_sales, orders GROUP BY month SINCE -13m UNTIL today'),
        runQuery('FROM sessions SHOW sessions GROUP BY month SINCE -13m UNTIL today'),
        runQuery('FROM sales SHOW net_sales, orders GROUP BY product_title, month SINCE -13m UNTIL today'),
      ]);

      // Build month lookup for sessions
      const sessionMap = {};
      for (const r of sessionRows) {
        sessionMap[r.month] = parseInt(r.sessions) || 0;
      }

      // Build monthly data with CVR
      const months = salesRows.map(r => {
        const netSales = parseFloat(r.net_sales) || 0;
        const grossSales = parseFloat(r.gross_sales) || 0;
        const orders = parseInt(r.orders) || 0;
        const sessions = sessionMap[r.month] || 0;
        return {
          month: r.month,
          netSales,
          grossSales,
          orders,
          sessions,
          cvr: sessions > 0 ? (orders / sessions) * 100 : 0,
          aov: orders > 0 ? netSales / orders : 0,
        };
      }).sort((a, b) => (a.month || '').localeCompare(b.month || ''));

      // Build product breakdown
      const products = {};
      for (const r of productRows) {
        const title = r.product_title || 'Other';
        if (!products[title]) products[title] = { totalRevenue: 0, totalOrders: 0, months: {} };
        const netSales = parseFloat(r.net_sales) || 0;
        const orders = parseInt(r.orders) || 0;
        products[title].totalRevenue += netSales;
        products[title].totalOrders += orders;
        products[title].months[r.month] = { netSales, orders };
      }

      // Sort products by total revenue
      const topProducts = Object.entries(products)
        .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
        .slice(0, 8)
        .map(([name, data]) => ({ name, ...data }));

      return res.json({ months, topProducts });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Shopify API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
