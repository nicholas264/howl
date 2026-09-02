import { requirePermission } from './_lib/app-access.js';
import { getShopifyAccessToken, shopifyContentConfig } from './_lib/shopify-content.js';
import { createHash } from 'node:crypto';

const SKU_UNIT_RULES = [
  { sku: 'R1 RallyMount', terms: ['r1 rallymount', 'r1 rally mount', 'rallymount r1', 'rally mount r1'] },
  { sku: 'R3 RallyMount', terms: ['r3 rallymount', 'r3 rally mount', 'rallymount r3', 'rally mount r3'] },
  { sku: 'R1 HaulBag', terms: ['r1 haulbag', 'r1 haul bag', 'haulbag r1', 'haul bag r1'] },
  { sku: 'R3 HaulBag', terms: ['r3 haulbag', 'r3 haul bag', 'haulbag r3', 'haul bag r3'] },
  { sku: 'R4 HaulBag', terms: ['r4 haulbag', 'r4 haul bag', 'haulbag r4', 'haul bag r4'] },
  { sku: '10 lb Tanks', terms: ['10 lb tank', '10lb tank', '10-pound tank', '10 pound tank'] },
  { sku: '20 lb Tanks', terms: ['20 lb tank', '20lb tank', '20-pound tank', '20 pound tank'] },
  { sku: 'Tank Mount', terms: ['tank mount'] },
  { sku: 'Rally Straps', terms: ['rally straps', 'rally strap'] },
  { sku: 'Ground Tarp', terms: ['ground tarp', 'tarp'] },
  { sku: 'RV Kit', terms: ['rv kit'] },
  { sku: 'Heater', terms: ['heater'] },
  { sku: 'R4 Campfire', terms: ['r4 campfire', 'r4 mkii', 'r4 mk ii', 'r4'] },
  { sku: 'R3 Campfire', terms: ['r3 campfire', 'r3'] },
  { sku: 'R1 Campfire', terms: ['r1 campfire', 'r1'] },
];

function customerKey(order, store) {
  const email = (order.email || '').trim().toLowerCase();
  if (email) {
    return `email:${createHash('sha256').update(email).digest('hex')}`;
  }
  if (order.customer?.id) return `customer:${store}:${order.customer.id}`;
  return `guest:${store}:${order.id}`;
}

function normalizeSkuText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function classifySkuUnit(lineItem) {
  const haystack = normalizeSkuText([
    lineItem.sku,
    lineItem.name,
    lineItem.variantTitle,
    lineItem.productTitle,
  ].filter(Boolean).join(' '));
  if (!haystack) return null;
  for (const rule of SKU_UNIT_RULES) {
    if (rule.terms.some(term => {
      const normalizedTerm = normalizeSkuText(term);
      return new RegExp(`(^| )${normalizedTerm.replace(/\s+/g, ' ')}( |$)`).test(haystack);
    })) {
      return rule.sku;
    }
  }
  return null;
}

// Per-store fetch + aggregation. Returns:
//   { months, topProducts, _meta: { ordersScanned, pages, customerScopeMissing, inventoryScopeMissing } }
async function fetchStoreAnalytics(store, token) {
  const GQL = `https://${store}/admin/api/2026-04/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const gql = async (query, variables = {}) => {
    const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const d = await r.json();
    if (d.errors) {
      const errs = Array.isArray(d.errors) ? d.errors : [];
      if (errs.some(e => /access denied for (customer|email) field/i.test(e.message || ''))) {
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

  const report = async (query) => {
    const data = await gql(`query Report($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData { columns { name dataType displayName } rows }
        parseErrors
      }
    }`, { query });
    const result = data.shopifyqlQuery;
    if (result.parseErrors?.length) {
      throw new Error(`ShopifyQL error (${store}): ${result.parseErrors.join('; ')}`);
    }
    return result.tableData?.rows || [];
  };

  const since = new Date();
  since.setMonth(since.getMonth() - 13);
  since.setDate(1); since.setHours(0, 0, 0, 0);
  const sinceISO = since.toISOString();
  const currentYear = new Date().getFullYear();

  // ShopifyQL is the same reporting layer used by Shopify Analytics. It is the
  // authority for revenue, orders, and customer cohorts; raw orders below remain
  // useful for product detail and COGS but don't reproduce Shopify's report rules.
  const [monthlyReport, sessionsReport, ytdRows] = await Promise.all([
    report(`FROM sales
      SHOW total_sales, net_sales, orders, customers, new_customers, returning_customers
      GROUP BY month
      SINCE -13m UNTIL today
      ORDER BY month`),
    report(`FROM sessions
      SHOW sessions
      GROUP BY month
      SINCE -13m UNTIL today
      ORDER BY month`),
    report(`FROM sales
      SHOW total_sales, net_sales, orders, customers, new_customers, returning_customers
      SINCE ${currentYear}-01-01 UNTIL today`),
  ]);
  const reportByMonth = Object.fromEntries(monthlyReport.map(row => [
    String(row.month).slice(0, 7),
    {
      totalSales: Number(row.total_sales || 0),
      netSales: Number(row.net_sales || 0),
      orders: Number(row.orders || 0),
      customers: Number(row.customers || 0),
      newCustomers: Number(row.new_customers || 0),
      returningCustomers: Number(row.returning_customers || 0),
    },
  ]));
  const sessionsByMonth = Object.fromEntries(sessionsReport.map(row => [
    String(row.month).slice(0, 7),
    Number(row.sessions || 0),
  ]));
  const ytdRow = ytdRows[0] || {};
  const ytd = {
    year: currentYear,
    totalSales: Number(ytdRow.total_sales || 0),
    netSales: Number(ytdRow.net_sales || 0),
    orders: Number(ytdRow.orders || 0),
    customers: Number(ytdRow.customers || 0),
    newCustomers: Number(ytdRow.new_customers || 0),
    returningCustomers: Number(ytdRow.returning_customers || 0),
  };

  // Query notes:
  // - test:false excludes Bogus Gateway / dev orders.
  // - We pull all orders (no financial_status filter) and reject in code based on
  //   displayFinancialStatus + cancelledAt. This is more robust than guessing the
  //   correct OR-combination in Shopify search syntax.
  // - Revenue source: currentSubtotalPriceSet — post-discount, post-refund, ex-tax,
  //   ex-shipping. This is the standard MER/aMER denominator. Refunds reduce it
  //   automatically; previously we used netPaymentSet which counted refunded $ as
  //   revenue and included tax + shipping.
  const buildQuery = (includeCustomer, includeUnitCost) => `query Orders($cursor: String) {
    orders(first: 250, after: $cursor, query: "created_at:>=${sinceISO} test:false", sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id
        createdAt
        cancelledAt
        displayFinancialStatus
        currentSubtotalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        ${includeCustomer ? 'email customer { id numberOfOrders }' : ''}
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

  const rawOrders = [];
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
        rawOrders.length = 0; cursor = null; pages = 0;
        continue;
      }
      if (err.code === 'MISSING_INVENTORY_SCOPE' && includeUnitCost) {
        includeUnitCost = false; inventoryScopeMissing = true;
        rawOrders.length = 0; cursor = null; pages = 0;
        continue;
      }
      throw err;
    }
    const conn = data.orders;
    for (const e of conn.edges) rawOrders.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    pages++;
  }

  // Reject cancelled and non-revenue-bearing orders.
  // displayFinancialStatus values: PAID, PARTIALLY_REFUNDED, PARTIALLY_PAID, REFUNDED,
  // VOIDED, PENDING, AUTHORIZED, EXPIRED.
  // Keep PAID + PARTIALLY_REFUNDED + PARTIALLY_PAID (still has captured revenue).
  const KEEP_STATUS = new Set(['PAID', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID']);
  const orders = rawOrders.filter(o =>
    !o.cancelledAt && KEEP_STATUS.has((o.displayFinancialStatus || '').toUpperCase())
  );
  const rejectedCount = rawOrders.length - orders.length;

  const monthMap = {};
  const productMap = {};

  // New/returning classification.
  // Logged-in customers: compare lifetime numberOfOrders to orders in window —
  // if all known orders fall inside the window, the earliest is the acquisition.
  // Email hashes are preferred so the same buyer can be deduplicated across stores.
  // Registered customers use lifetime order count to determine whether the first
  // order in this window is truly their acquisition order. Guest-email orders use
  // the earliest order in the fetched window as the best available approximation.
  const canClassifyCustomers = !customerScopeMissing;
  const customerOrders = {};
  if (canClassifyCustomers) {
    for (const o of orders) {
      const key = customerKey(o, store);
      if (!customerOrders[key]) customerOrders[key] = [];
      customerOrders[key].push(o);
    }
  }
  const newOrderIds = new Set();
  for (const list of Object.values(customerOrders)) {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const lifetime = list.find(o => o.customer?.numberOfOrders != null)?.customer?.numberOfOrders ?? list.length;
    if (lifetime <= list.length) newOrderIds.add(list[0].id);
  }

  for (const o of orders) {
    const d = new Date(o.createdAt);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // currentSubtotalPriceSet = line-item subtotal after discounts and refunds,
    // before tax and shipping. The standard "net sales" definition for MER/aMER.
    const orderRev = parseFloat(o.currentSubtotalPriceSet?.shopMoney?.amount || 0);
    const shipping = parseFloat(o.totalShippingPriceSet?.shopMoney?.amount || 0);
    const key = canClassifyCustomers ? customerKey(o, store) : null;
    const isNew = canClassifyCustomers
      ? newOrderIds.has(o.id)
      : null;
    if (!monthMap[mKey]) monthMap[mKey] = {
      netSales: 0, orders: 0, shipping: 0,
      newRevenue: 0, returningRevenue: 0,
      cogs: 0, costedRevenue: 0, uncostedRevenue: 0,
      customerKeys: new Set(), newCustomerKeys: new Set(), returningCustomerKeys: new Set(),
    };
    monthMap[mKey].netSales += orderRev;
    monthMap[mKey].orders += 1;
    monthMap[mKey].shipping += shipping;
    if (key) monthMap[mKey].customerKeys.add(key);
    if (isNew === true) {
      monthMap[mKey].newCustomerKeys.add(key);
      monthMap[mKey].newRevenue += orderRev;
    } else if (isNew === false) {
      monthMap[mKey].returningCustomerKeys.add(key);
      monthMap[mKey].returningRevenue += orderRev;
    }

    const lineItems = o.lineItems?.edges || [];
    const originalOrderTotal = lineItems.reduce(
      (sum, li) => sum + parseFloat(li.node.originalTotalSet?.shopMoney?.amount || 0),
      0,
    );
    const allocatedRevenue = (li) => {
      const original = parseFloat(li.node.originalTotalSet?.shopMoney?.amount || 0);
      if (originalOrderTotal > 0) return orderRev * (original / originalOrderTotal);
      return lineItems.length > 0 ? orderRev / lineItems.length : 0;
    };

    for (const li of lineItems) {
      const liRev = allocatedRevenue(li);
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
    for (const li of lineItems) {
      const title = li.node.name?.split(' - ')[0] || 'Other';
      const rev = allocatedRevenue(li);
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

  for (const month of Object.keys(reportByMonth)) {
    if (!monthMap[month]) monthMap[month] = {
      netSales: 0, orders: 0, shipping: 0,
      newRevenue: 0, returningRevenue: 0,
      cogs: 0, costedRevenue: 0, uncostedRevenue: 0,
      customerKeys: new Set(), newCustomerKeys: new Set(), returningCustomerKeys: new Set(),
    };
  }

  const months = Object.entries(monthMap).map(([month, v]) => {
    const authoritative = reportByMonth[month];
    const orders = authoritative?.orders ?? v.orders;
    const sessions = sessionsByMonth[month] || 0;
    return {
    ...(() => {
      // A customer acquired this month stays in the "new" bucket even if they
      // place another order later in the same month.
      const returningKeys = [...v.returningCustomerKeys].filter(k => !v.newCustomerKeys.has(k));
      return {
        customers: authoritative?.customers ?? v.customerKeys.size,
        newCustomers: authoritative?.newCustomers ?? v.newCustomerKeys.size,
        returningCustomers: authoritative?.returningCustomers ?? returningKeys.length,
        customerKeys: [...v.customerKeys],
        newCustomerKeys: [...v.newCustomerKeys],
        returningCustomerKeys: returningKeys,
      };
    })(),
    month,
    netSales: authoritative?.netSales ?? v.netSales,
    grossSales: authoritative?.totalSales ?? v.netSales,
    shopifyNetSales: authoritative?.netSales ?? v.netSales,
    orders,
    shipping: v.shipping,
    sessions,
    cvr: sessions > 0 ? (orders / sessions) * 100 : 0,
    aov: orders > 0
      ? (authoritative?.netSales ?? v.netSales) / orders
      : 0,
    newRevenue: v.newRevenue,
    returningRevenue: v.returningRevenue,
    cogs: v.cogs,
    costedRevenue: v.costedRevenue,
    uncostedRevenue: v.uncostedRevenue,
    reportSource: authoritative ? 'shopifyql' : 'orders',
  };
  }).sort((a, b) => a.month.localeCompare(b.month));

  return {
    months, productMap, ytd,
    _meta: { ordersScanned: orders.length, ordersRejected: rejectedCount, pages, customerScopeMissing, inventoryScopeMissing },
  };
}

async function fetchStoreSkuUnits(store, token, monthKey) {
  const GQL = `https://${store}/admin/api/2026-04/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };
  const gql = async (query, variables = {}) => {
    const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    const d = await r.json();
    if (d.errors) {
      const errs = Array.isArray(d.errors) ? d.errors : [];
      const msg = errs.length
        ? errs.map(e => e.message || JSON.stringify(e)).join('; ')
        : typeof d.errors === 'string' ? d.errors : JSON.stringify(d.errors);
      throw new Error(`Shopify GraphQL error (${store} HTTP ${r.status}): ${msg}`);
    }
    if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
    return d.data;
  };

  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const today = new Date();
  const todayUtcEnd = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59));
  const untilDate = start > todayUtcEnd ? end : (end < todayUtcEnd ? end : todayUtcEnd);
  const sinceISO = start.toISOString();
  const untilISO = untilDate.toISOString();
  const queryFilter = `created_at:>=${sinceISO} created_at:<=${untilISO} test:false`;

  const query = `query Orders($cursor: String) {
    orders(first: 250, after: $cursor, query: "${queryFilter}", sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id
        name
        createdAt
        cancelledAt
        displayFinancialStatus
        currentSubtotalPriceSet { shopMoney { amount } }
        lineItems(first: 100) {
          edges { node {
            name
            quantity
            currentQuantity
            sku
            originalTotalSet { shopMoney { amount } }
            variant { id sku title product { id title handle } }
          } }
        }
      } }
    }
  }`;

  const KEEP_STATUS = new Set(['PAID', 'PARTIALLY_REFUNDED', 'PARTIALLY_PAID']);
  const bySku = {};
  const unmapped = [];
  let cursor = null;
  let pages = 0;
  let ordersScanned = 0;
  let rejected = 0;
  while (pages < 50) {
    const data = await gql(query, { cursor });
    const conn = data.orders;
    for (const edge of (conn.edges || [])) {
      const order = edge.node;
      ordersScanned++;
      if (order.cancelledAt || !KEEP_STATUS.has((order.displayFinancialStatus || '').toUpperCase())) {
        rejected++;
        continue;
      }
      const lineItems = order.lineItems?.edges || [];
      const originalOrderTotal = lineItems.reduce(
        (sum, li) => sum + Number(li.node.originalTotalSet?.shopMoney?.amount || 0),
        0,
      );
      const orderRevenue = Number(order.currentSubtotalPriceSet?.shopMoney?.amount || 0);
      for (const li of lineItems) {
        const node = li.node;
        const quantity = Math.max(0, Number(node.currentQuantity ?? node.quantity ?? 0));
        if (!quantity) continue;
        const originalLineTotal = Number(node.originalTotalSet?.shopMoney?.amount || 0);
        const revenue = originalOrderTotal > 0
          ? orderRevenue * (originalLineTotal / originalOrderTotal)
          : 0;
        const sku = classifySkuUnit({
          sku: node.sku || node.variant?.sku || '',
          name: node.name || '',
          variantTitle: node.variant?.title || '',
          productTitle: node.variant?.product?.title || '',
        });
        if (!sku) {
          unmapped.push({
            order_id: order.id,
            order_name: order.name,
            line_name: node.name,
            shopify_sku: node.sku || node.variant?.sku || '',
            quantity,
            revenue,
          });
          continue;
        }
        if (!bySku[sku]) bySku[sku] = { units: 0, revenue: 0, orders: 0 };
        bySku[sku].units += quantity;
        bySku[sku].revenue += revenue;
        bySku[sku].orders += 1;
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    pages++;
  }

  return {
    monthKey,
    since: sinceISO.slice(0, 10),
    until: untilISO.slice(0, 10),
    bySku,
    unmapped,
    _meta: { ordersScanned, ordersRejected: rejected, pages },
  };
}

// Sum two store results into a combined per-month aggregate.
function mergeStoreResults(stores) {
  const monthMap = {};
  const productMap = {};
  const sourceStores = {};
  const meta = { ordersScanned: 0, pages: 0, customerScopeMissing: false, inventoryScopeMissing: false, perStore: {} };

  for (const { role, result } of stores) {
    sourceStores[role] = { months: result.months, ytd: result.ytd };
    meta.perStore[role] = result._meta;
    meta.ordersScanned += result._meta.ordersScanned;
    meta.pages += result._meta.pages;
    if (result._meta.customerScopeMissing) meta.customerScopeMissing = true;
    if (result._meta.inventoryScopeMissing) meta.inventoryScopeMissing = true;

    for (const m of result.months) {
      if (!monthMap[m.month]) monthMap[m.month] = {
        netSales: 0, grossSales: 0, orders: 0, shipping: 0, newCustomers: 0, returningCustomers: 0,
        sessions: 0,
        newRevenue: 0, returningRevenue: 0, cogs: 0, costedRevenue: 0, uncostedRevenue: 0,
        customerKeys: new Set(), newCustomerKeys: new Set(), returningCustomerKeys: new Set(),
      };
      const t = monthMap[m.month];
      t.netSales += m.netSales || 0;
      t.grossSales += m.grossSales ?? m.netSales ?? 0;
      t.orders += m.orders || 0;
      t.shipping += m.shipping || 0;
      t.sessions += m.sessions || 0;
      t.newCustomers += m.newCustomers || 0;
      t.returningCustomers += m.returningCustomers || 0;
      t.newRevenue += m.newRevenue || 0;
      t.returningRevenue += m.returningRevenue || 0;
      t.cogs += m.cogs || 0;
      t.costedRevenue += m.costedRevenue || 0;
      t.uncostedRevenue += m.uncostedRevenue || 0;
      for (const key of (m.customerKeys || [])) t.customerKeys.add(key);
      for (const key of (m.newCustomerKeys || [])) t.newCustomerKeys.add(key);
      for (const key of (m.returningCustomerKeys || [])) t.returningCustomerKeys.add(key);
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

  const months = Object.entries(monthMap).map(([month, v]) => {
    const newCustomerKeys = [...v.newCustomerKeys];
    const returningCustomerKeys = [...v.returningCustomerKeys].filter(k => !v.newCustomerKeys.has(k));
    const newCustomers = v.customerKeys.size > 0 ? newCustomerKeys.length : v.newCustomers;
    const returningCustomers = v.customerKeys.size > 0 ? returningCustomerKeys.length : v.returningCustomers;
    return {
      month,
      netSales: v.netSales,
      grossSales: v.grossSales,
      orders: v.orders,
      shipping: v.shipping,
      sessions: v.sessions,
      cvr: v.sessions > 0 ? (v.orders / v.sessions) * 100 : 0,
      aov: v.orders > 0 ? v.netSales / v.orders : 0,
      newCustomers,
      returningCustomers,
      customerKeys: [...v.customerKeys],
      newCustomerKeys,
      returningCustomerKeys,
      newRevenue: v.newRevenue,
      returningRevenue: v.returningRevenue,
      newAov: newCustomers > 0 ? v.newRevenue / newCustomers : 0,
      returningAov: returningCustomers > 0 ? v.returningRevenue / returningCustomers : 0,
      repeatRate: (newCustomers + returningCustomers) > 0
        ? returningCustomers / (newCustomers + returningCustomers)
        : 0,
      cogs: v.cogs,
      costedRevenue: v.costedRevenue,
      uncostedRevenue: v.uncostedRevenue,
    };
  }).sort((a, b) => a.month.localeCompare(b.month));

  const topProducts = Object.entries(productMap)
    .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
    .slice(0, 8)
    .map(([name, data]) => ({ name, ...data }));

  return { months, topProducts, _stores: sourceStores, _meta: meta };
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
        inventoryQuantity
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
      // Prefer the variant-level inventoryQuantity (this is what Shopify admin shows
      // as "Available"). Fall back to summed location levels only if it's null
      // (which happens when the variant isn't tracked or scope is missing).
      const variantAvailable = typeof v.inventoryQuantity === 'number'
        ? v.inventoryQuantity
        : levels.reduce((s, l) => s + l.available, 0);
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
        totalAvailable: variantAvailable,
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
  if (!(await requirePermission(req, res, 'analytics.read'))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Configure stores. Primary is required. Dealer is optional — only added
  // when both env vars are present.
  const stores = [];
  const primaryConfig = shopifyContentConfig();
  if (primaryConfig.configured) {
    stores.push({ role: 'primary', store: primaryConfig.store, getToken: () => getShopifyAccessToken() });
  }
  const dealerConfig = shopifyContentConfig('dealer');
  if (dealerConfig.store && dealerConfig.configured) {
    stores.push({ role: 'dealer', store: dealerConfig.store, getToken: () => getShopifyAccessToken('dealer') });
  }
  if (stores.length === 0) return res.status(500).json({ error: 'No Shopify store credentials configured' });

  try {
    const { action } = req.body;

    // Run each store's fetch in isolation. If one store fails (expired token,
    // missing scope, GraphQL error) the others still return — previously a
    // dealer-store failure 500'd the whole call and emptied the dashboard.
    const settle = async (fn, role, store, getToken) => {
      try {
        const token = await getToken();
        return { role, store, result: await fn(store, token) };
      }
      catch (err) {
        console.error(`Shopify ${role} (${store}) failed:`, err.message);
        return { role, store, error: err.message, code: err.code || null };
      }
    };

    if (action === 'get_inventory') {
      const results = await Promise.all(stores.map(s =>
        settle(fetchStoreInventory, s.role, s.store, s.getToken)
      ));
      const ok = results.filter(r => r.result);
      if (!ok.length) return res.status(500).json({ error: results.map(r => `${r.role}: ${r.error}`).join(' | ') });
      const merged = mergeInventoryResults(ok);
      merged._meta.errors = results.filter(r => r.error).map(r => ({ role: r.role, store: r.store, error: r.error, code: r.code || null }));
      return res.json(merged);
    }

    if (action === 'get_sku_units') {
      const monthKey = String(req.body.monthKey || '').trim();
      if (!/^\d{4}-\d{2}$/.test(monthKey)) return res.status(400).json({ error: 'monthKey must be YYYY-MM' });
      const primary = stores.find(s => s.role === 'primary') || stores[0];
      const token = await primary.getToken();
      const result = await fetchStoreSkuUnits(primary.store, token, monthKey);
      return res.json({ ...result, store: primary.store, role: primary.role });
    }

    if (action === 'get_analytics') {
      const results = await Promise.all(stores.map(s =>
        settle(fetchStoreAnalytics, s.role, s.store, s.getToken)
      ));
      const ok = results.filter(r => r.result);
      if (!ok.length) return res.status(500).json({ error: results.map(r => `${r.role}: ${r.error}`).join(' | ') });
      const merged = mergeStoreResults(ok);
      merged._meta.errors = results
        .filter(r => r.error && !(r.role === 'dealer' && r.code === 'SHOPIFY_DEALER_RECONNECT_REQUIRED'))
        .map(r => ({ role: r.role, store: r.store, error: r.error, code: r.code || null }));
      merged._meta.dealerReconnectRequired = results.some(r => r.role === 'dealer' && r.code === 'SHOPIFY_DEALER_RECONNECT_REQUIRED');
      merged._meta.dealerConfigured = ok.some(r => r.role === 'dealer');
      merged._meta.dealerStorePresent = !!dealerConfig.store;
      merged._meta.dealerStore = dealerConfig.store || null;
      return res.json(merged);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Shopify API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
