import { requireAuth } from './_lib/auth.js';

// Per-store fetch + aggregation. Returns:
//   { months, topProducts, _meta: { ordersScanned, pages, customerScopeMissing, inventoryScopeMissing } }
async function fetchStoreAnalytics(store, token) {
  const GQL = `https://${store}/admin/api/2025-01/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const gql = async (query, variables = {}) => {
    const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const d = await r.json();
    if (d.errors) {
      const errs = Array.isArray(d.errors) ? d.errors : [];
      if (errs.some(e => /access denied for customer field/i.test(e.message || ''))) {
        const err = new Error('missing_scope:read_customers');
        err.code = 'MISSING_CUSTOMER_SCOPE';
        throw err;
      }
      if (errs.some(e => /access denied for (inventoryitem|unitcost) field|read_inventory/i.test(e.message || ''))) {
        const err = new Error('missing_scope:read_inventory');
        err.code = 'MISSING_INVENTORY_SCOPE';
        throw err;
      }
      const msg = errs.length
        ? errs.map(e => e.message || JSON.stringify(e)).join('; ')
        : typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors);
      throw new Error(`Shopify GraphQL error (${store} HTTP ${r.status}): ${msg}`);
    }
    if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
    return d.data;
  };

  const since = new Date();
  since.setMonth(since.getMonth() - 13);
  since.setDate(1); since.setHours(0, 0, 0, 0);
  const sinceISO = since.toISOString();

  const buildQuery = (includeCustomer, includeUnitCost) => `query Orders($cursor: String) {
    orders(first: 250, after: $cursor, query: "created_at:>=${sinceISO} financial_status:paid", sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id
        createdAt
        netPaymentSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        ${includeCustomer ? 'customer { id numberOfOrders }' : ''}
        lineItems(first: 50) {
          edges { node {
            name
            quantity
            originalTotalSet { shopMoney { amount } }
            ${includeUnitCost ? 'variant { id inventoryItem { unitCost { amount } } }' : ''}
          } }
        }
      } }
    }
  }`;

  const orders = [];
  let cursor = null;
  let pages = 0;
  let includeCustomer = true;
  let includeUnitCost = true;
  let customerScopeMissing = false;
  let inventoryScopeMissing = false;
  while (pages < 40) {
    let data;
    try {
      data = await gql(buildQuery(includeCustomer, includeUnitCost), { cursor });
    } catch (err) {
      if (err.code === 'MISSING_CUSTOMER_SCOPE' && includeCustomer) {
        includeCustomer = false; customerScopeMissing = true;
        orders.length = 0; cursor = null; pages = 0;
        continue;
      }
      if (err.code === 'MISSING_INVENTORY_SCOPE' && includeUnitCost) {
        includeUnitCost = false; inventoryScopeMissing = true;
        orders.length = 0; cursor = null; pages = 0;
        continue;
      }
      throw err;
    }
    const conn = data.orders;
    for (const e of conn.edges) orders.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    pages++;
  }

  const monthMap = {};
  const productMap = {};

  // New/returning classification using lifetime numberOfOrders snapshot.
  const customerOrders = {};
  for (const o of orders) {
    const cid = o.customer?.id;
    if (!cid) continue;
    if (!customerOrders[cid]) customerOrders[cid] = [];
    customerOrders[cid].push(o);
  }
  const newOrderIds = new Set();
  for (const [cid, list] of Object.entries(customerOrders)) {
    const lifetime = list[0].customer?.numberOfOrders ?? list.length;
    if (lifetime <= list.length) newOrderIds.add(list[0].id);
  }

  for (const o of orders) {
    const d = new Date(o.createdAt);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const orderRev = parseFloat(o.netPaymentSet?.shopMoney?.amount || o.currentTotalPriceSet?.shopMoney?.amount || 0);
    const shipping = parseFloat(o.totalShippingPriceSet?.shopMoney?.amount || 0);
    const isNew = newOrderIds.has(o.id);
    if (!monthMap[mKey]) monthMap[mKey] = { netSales: 0, orders: 0, shipping: 0, newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0, cogs: 0, costedRevenue: 0, uncostedRevenue: 0 };
    monthMap[mKey].netSales += orderRev;
    monthMap[mKey].orders += 1;
    monthMap[mKey].shipping += shipping;
    if (isNew) {
      monthMap[mKey].newCustomers += 1;
      monthMap[mKey].newRevenue += orderRev;
    } else if (o.customer?.id) {
      monthMap[mKey].returningCustomers += 1;
      monthMap[mKey].returningRevenue += orderRev;
    }
    for (const li of (o.lineItems?.edges || [])) {
      const liRev = parseFloat(li.node.originalTotalSet?.shopMoney?.amount || 0);
      const unitCost = parseFloat(li.node.variant?.inventoryItem?.unitCost?.amount || 0);
      const qty = parseInt(li.node.quantity || 0);
      if (unitCost > 0 && qty > 0) {
        monthMap[mKey].cogs += unitCost * qty;
        monthMap[mKey].costedRevenue += liRev;
      } else {
        monthMap[mKey].uncostedRevenue += liRev;
      }
    }

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

  const months = Object.entries(monthMap).map(([month, v]) => ({
    month,
    netSales: v.netSales,
    orders: v.orders,
    shipping: v.shipping,
    aov: v.orders > 0 ? v.netSales / v.orders : 0,
    newCustomers: v.newCustomers,
    returningCustomers: v.returningCustomers,
    newRevenue: v.newRevenue,
    returningRevenue: v.returningRevenue,
    cogs: v.cogs,
    costedRevenue: v.costedRevenue,
    uncostedRevenue: v.uncostedRevenue,
  })).sort((a, b) => a.month.localeCompare(b.month));

  return {
    months, productMap,
    _meta: { ordersScanned: orders.length, pages, customerScopeMissing, inventoryScopeMissing },
  };
}

// Sum two store results into a combined per-month aggregate.
function mergeStoreResults(stores) {
  const monthMap = {};
  const productMap = {};
  const meta = { ordersScanned: 0, pages: 0, customerScopeMissing: false, inventoryScopeMissing: false, perStore: {} };

  for (const { role, result } of stores) {
    meta.perStore[role] = result._meta;
    meta.ordersScanned += result._meta.ordersScanned;
    meta.pages += result._meta.pages;
    if (result._meta.customerScopeMissing) meta.customerScopeMissing = true;
    if (result._meta.inventoryScopeMissing) meta.inventoryScopeMissing = true;

    for (const m of result.months) {
      if (!monthMap[m.month]) monthMap[m.month] = {
        netSales: 0, orders: 0, shipping: 0, newCustomers: 0, returningCustomers: 0,
        newRevenue: 0, returningRevenue: 0, cogs: 0, costedRevenue: 0, uncostedRevenue: 0,
      };
      const t = monthMap[m.month];
      t.netSales += m.netSales || 0;
      t.orders += m.orders || 0;
      t.shipping += m.shipping || 0;
      t.newCustomers += m.newCustomers || 0;
      t.returningCustomers += m.returningCustomers || 0;
      t.newRevenue += m.newRevenue || 0;
      t.returningRevenue += m.returningRevenue || 0;
      t.cogs += m.cogs || 0;
      t.costedRevenue += m.costedRevenue || 0;
      t.uncostedRevenue += m.uncostedRevenue || 0;
    }

    for (const [title, p] of Object.entries(result.productMap || {})) {
      if (!productMap[title]) productMap[title] = { totalRevenue: 0, totalOrders: 0, months: {} };
      productMap[title].totalRevenue += p.totalRevenue;
      productMap[title].totalOrders += p.totalOrders;
      for (const [mk, mv] of Object.entries(p.months || {})) {
        if (!productMap[title].months[mk]) productMap[title].months[mk] = { netSales: 0, orders: 0 };
        productMap[title].months[mk].netSales += mv.netSales;
        productMap[title].months[mk].orders += mv.orders;
      }
    }
  }

  const months = Object.entries(monthMap).map(([month, v]) => ({
    month,
    netSales: v.netSales,
    grossSales: v.netSales,
    orders: v.orders,
    shipping: v.shipping,
    sessions: 0,
    cvr: 0,
    aov: v.orders > 0 ? v.netSales / v.orders : 0,
    newCustomers: v.newCustomers,
    returningCustomers: v.returningCustomers,
    newRevenue: v.newRevenue,
    returningRevenue: v.returningRevenue,
    newAov: v.newCustomers > 0 ? v.newRevenue / v.newCustomers : 0,
    returningAov: v.returningCustomers > 0 ? v.returningRevenue / v.returningCustomers : 0,
    repeatRate: v.orders > 0 ? v.returningCustomers / v.orders : 0,
    cogs: v.cogs,
    costedRevenue: v.costedRevenue,
    uncostedRevenue: v.uncostedRevenue,
  })).sort((a, b) => a.month.localeCompare(b.month));

  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
    .slice(0, 8)
    .map(([name, data]) => ({ name, ...data }));

  return { months, topProducts, _meta: meta };
}

// Inventory snapshot: per-variant on-hand / available / committed / incoming, broken down by location.
async function fetchStoreInventory(store, token) {
  const GQL = `https://${store}/admin/api/2025-01/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const gql = async (query, variables = {}) => {
    const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const d = await r.json();
    if (d.errors) {
      const errs = Array.isArray(d.errors) ? d.errors : [];
      if (errs.some(e => /access denied for (inventoryitem|inventorylevel|inventoryquantity)|read_inventory/i.test(e.message || ''))) {
        const err = new Error('missing_scope:read_inventory');
        err.code = 'MISSING_INVENTORY_SCOPE';
        throw err;
      }
      if (errs.some(e => /access denied for name field|read_locations/i.test(e.message || ''))) {
        const err = new Error('missing_scope:read_locations');
        err.code = 'MISSING_LOCATIONS_SCOPE';
        throw err;
      }
      const msg = errs.map(e => e.message || JSON.stringify(e)).join('; ');
      throw new Error(`Shopify GraphQL error (${store} HTTP ${r.status}): ${msg}`);
    }
    if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
    return d.data;
  };

  const buildQuery = (includeLocationName) => `query Variants($cursor: String) {
    productVariants(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id
        sku
        title
        displayName
        price
        product { id title handle status }
        inventoryItem {
          tracked
          inventoryLevels(first: 20) {
            edges { node {
              location { id ${includeLocationName ? 'name' : ''} }
              quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity }
            } }
          }
        }
      } }
    }
  }`;

  let includeLocationName = true;
  let locationsScopeMissing = false;

  const variants = [];
  let cursor = null;
  let pages = 0;
  while (pages < 100) {
    let data;
    try {
      data = await gql(buildQuery(includeLocationName), { cursor });
    } catch (err) {
      if (err.code === 'MISSING_LOCATIONS_SCOPE' && includeLocationName) {
        includeLocationName = false; locationsScopeMissing = true;
        variants.length = 0; cursor = null; pages = 0;
        continue;
      }
      throw err;
    }
    const conn = data.productVariants;
    for (const e of conn.edges) {
      const v = e.node;
      if (!v.inventoryItem?.tracked) continue;
      const levels = (v.inventoryItem.inventoryLevels?.edges || []).map(le => {
        const q = {};
        for (const { name, quantity } of (le.node.quantities || [])) q[name] = quantity;
        const locId = le.node.location.id;
        const shortId = (locId || '').split('/').pop();
        return {
          locationId: locId,
          locationName: le.node.location.name || `Location ${shortId}`,
          available: q.available || 0,
          onHand: q.on_hand || 0,
          committed: q.committed || 0,
          incoming: q.incoming || 0,
        };
      });
      variants.push({
        variantId: v.id,
        sku: v.sku || '',
        variantTitle: v.title,
        displayName: v.displayName,
        price: parseFloat(v.price || 0),
        productId: v.product.id,
        productTitle: v.product.title,
        productHandle: v.product.handle,
        productStatus: v.product.status,
        levels,
        totalAvailable: levels.reduce((s, l) => s + l.available, 0),
        totalOnHand: levels.reduce((s, l) => s + l.onHand, 0),
        totalCommitted: levels.reduce((s, l) => s + l.committed, 0),
        totalIncoming: levels.reduce((s, l) => s + l.incoming, 0),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    pages++;
  }

  return { variants, _meta: { variantsScanned: variants.length, pages, locationsScopeMissing } };
}

function mergeInventoryResults(stores) {
  const out = { stores: {}, _meta: { variantsScanned: 0, pages: 0 } };
  for (const { role, store, result } of stores) {
    out.stores[role] = { store, variants: result.variants };
    out._meta.variantsScanned += result._meta.variantsScanned;
    out._meta.pages += result._meta.pages;
  }
  return out;
}

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Configure stores. Primary is required. Dealer is optional — only added
  // when both env vars are present.
  const stores = [];
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    stores.push({ role: 'primary', store: process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com', token: process.env.SHOPIFY_ACCESS_TOKEN });
  }
  if (process.env.SHOPIFY_DEALER_ACCESS_TOKEN && process.env.SHOPIFY_DEALER_STORE) {
    stores.push({ role: 'dealer', store: process.env.SHOPIFY_DEALER_STORE, token: process.env.SHOPIFY_DEALER_ACCESS_TOKEN });
  }
  if (stores.length === 0) return res.status(500).json({ error: 'No Shopify store credentials configured' });

  try {
    const { action } = req.body;

    if (action === 'get_inventory') {
      const results = await Promise.all(stores.map(async ({ role, store, token }) => {
        const result = await fetchStoreInventory(store, token);
        return { role, store, result };
      }));
      return res.json(mergeInventoryResults(results));
    }

    if (action === 'get_analytics') {
      const results = await Promise.all(stores.map(async ({ role, store, token }) => {
        const result = await fetchStoreAnalytics(store, token);
        return { role, store, result };
      }));
      const merged = mergeStoreResults(results);
      return res.json(merged);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Shopify API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
