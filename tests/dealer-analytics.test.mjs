import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealerReport,
  dayInZone,
  periodStart,
} from "../src/lib/dealer-analytics.js";
import {
  normalizeDealerOrders,
  fetchDealerOrders,
} from "../api/_lib/dealer-analytics.js";
import { createDealerAnalyticsHandler } from "../api/dealer-analytics.js";
const shop = {
  name: "Dealer",
  domain: "dealer.myshopify.com",
  currency: "USD",
  timeZone: "America/Denver",
};
const order = (id, day, amount = 100, key = "a") => ({
  id,
  name: `#${id}`,
  day,
  createdAt: `${day}T12:00:00Z`,
  netSales: amount,
  outstanding: 0,
  customerKey: key,
  customerName: key,
  contactName: key,
  location: "Denver",
  customerId: key,
  status: "PAID",
});
const data = (orders) => ({ shop, asOf: "2026-09-12T20:00:00Z", orders });
test("store dates and inclusive presets respect timezone and leap boundaries", () => {
  assert.equal(dayInZone("2026-01-01T01:00:00Z", shop.timeZone), "2025-12-31");
  assert.equal(periodStart("90d", "2026-09-12"), "2026-06-15");
  assert.equal(periodStart("all", "2026-09-12", "2023-05-01"), "2023-05-01");
});
test("period spend excludes earlier orders but cadence and repeat use history", () => {
  const r = buildDealerReport(
    data([
      order("1", "2025-12-01"),
      order("2", "2026-01-01", 50),
      order("3", "2026-02-01", 150),
      order("4", "2026-02-01", 200, "b"),
    ]),
  );
  assert.equal(r.summary.netSales, 400);
  assert.equal(r.summary.orders, 3);
  assert.equal(r.summary.newCustomers, 1);
  assert.equal(r.summary.repeatCustomers, 1);
  assert.equal(r.summary.repeatSalesShare, 0.5);
  assert.equal(r.customers.find((c) => c.id === "a").cadence, 31);
  assert.equal(r.months.length, 9);
  assert.equal(r.months.at(-1).netSales, 0);
});
test("same day orders are repeat purchases but do not create zero-day cadence", () => {
  const r = buildDealerReport(
    data([order("1", "2026-01-01"), order("2", "2026-01-01")]),
  );
  assert.equal(r.summary.repeatRate, 1);
  assert.equal(r.summary.cadence, null);
  assert.equal(r.customers[0].status, "learning");
});
test("reorder flags require three distinct dates, and inactive accounts remain visible", () => {
  const r = buildDealerReport(
    data([
      order("1", "2026-01-01"),
      order("2", "2026-02-01"),
      order("3", "2026-03-01"),
      order("4", "2026-01-01", 100, "b"),
      order("5", "2026-02-01", 100, "b"),
    ]),
    { start: "2026-06-01" },
  );
  assert.equal(r.summary.activeCustomers, 0);
  assert.equal(r.summary.overdue, 1);
  assert.equal(r.customers.find((c) => c.id === "b").status, "learning");
  assert.equal(r.summary.netSales, 0);
});
test("future orders are excluded and empty data does not invent metrics", () => {
  const r = buildDealerReport(data([order("1", "2026-12-01")]));
  assert.equal(r.customers.length, 0);
  assert.equal(r.summary.aov, null);
  assert.equal(r.summary.repeatRate, null);
});
const raw = (id, overrides = {}) => ({
  id: `gid://shopify/Order/${id}`,
  name: `#${id}`,
  createdAt: "2026-01-01T01:00:00Z",
  test: false,
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  currentSubtotalPriceSet: { shopMoney: { amount: "75.25" } },
  totalOutstandingSet: { shopMoney: { amount: "20.00" } },
  ...overrides,
});
test("normalization excludes cancelled/test/voided and deduplicates, retaining net-term and refund amounts", () => {
  const rows = normalizeDealerOrders(
    [
      raw(1),
      raw(1),
      raw(2, { test: true }),
      raw(3, { cancelledAt: "x" }),
      raw(4, { displayFinancialStatus: "VOIDED" }),
      raw(5, { displayFinancialStatus: "PENDING" }),
      raw(6, {
        displayFinancialStatus: "REFUNDED",
        currentSubtotalPriceSet: { shopMoney: { amount: "0" } },
      }),
    ],
    shop,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].day, "2025-12-31");
  assert.equal(rows[0].netSales, 75.25);
  assert.equal(rows[1].outstanding, 20);
  assert.equal(rows[2].netSales, 0);
});
test("customer IDs take precedence; guest email matching is normalized and anonymous orders stay separate", () => {
  const rows = normalizeDealerOrders(
    [
      raw(1, { email: " A@EXAMPLE.COM " }),
      raw(2, { email: "a@example.com" }),
      raw(3),
      raw(4),
      raw(5, {
        email: "a@example.com",
        customer: { id: "gid://shopify/Customer/42", displayName: "Buyer" },
        billingAddress: { company: " Dealer Co ", city: "Denver" },
      }),
    ],
    shop,
  );
  assert.equal(rows[0].customerKey, rows[1].customerKey);
  assert.notEqual(rows[2].customerKey, rows[3].customerKey);
  assert.equal(rows[4].customerKey, "customer:42");
  assert.equal(rows[4].customerName, "Dealer Co");
  assert.ok(!rows[0].customerKey.includes("a@example.com"));
  assert.equal(rows[1].contactEmail, "a@example.com");
});
const metadata = {
  shop: {
    name: "Dealer",
    myshopifyDomain: shop.domain,
    currencyCode: "USD",
    ianaTimezone: shop.timeZone,
  },
  currentAppInstallation: { accessScopes: [{ handle: "read_all_orders" }] },
};
const response = (d) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: d }),
});
const config = { store: shop.domain, configured: true };
test("Shopify import exhausts all pages and uses dealer token and explicit cursors", async () => {
  const calls = [];
  const results = [
    metadata,
    {
      orders: {
        nodes: [raw(1)],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      },
    },
    {
      orders: {
        nodes: [raw(2)],
        pageInfo: { hasNextPage: false, endCursor: "last" },
      },
    },
  ];
  const r = await fetchDealerOrders({
    config,
    getToken: async () => "dealer-test-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return response(results.shift());
    },
  });
  assert.equal(r.orders.length, 2);
  assert.equal(r.meta.historyComplete, true);
  assert.equal(r.meta.pages, 2);
  assert.equal(JSON.parse(calls[2].body).variables.after, "next");
  assert.equal(calls[0].headers["X-Shopify-Access-Token"], "dealer-test-token");
  assert.ok(calls.every((c) => c.url.includes(shop.domain)));
});
test("missing historical scope and broken pagination fail without partial totals", async () => {
  await assert.rejects(
    fetchDealerOrders({
      config,
      getToken: async () => "x",
      fetchImpl: async () =>
        response({ ...metadata, currentAppInstallation: { accessScopes: [] } }),
    }),
    /read_all_orders/,
  );
  let i = 0;
  await assert.rejects(
    fetchDealerOrders({
      config,
      getToken: async () => "x",
      fetchImpl: async () =>
        response(
          i++
            ? {
                orders: {
                  nodes: [],
                  pageInfo: { hasNextPage: true, endCursor: null },
                },
              }
            : metadata,
        ),
    }),
    /pagination/,
  );
});
function res() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
  };
}
test("API authorizes every request, caches GET and refreshes POST", async () => {
  let calls = 0,
    auth = 0,
    clock = 0;
  const h = createDealerAnalyticsHandler({
    authorize: async () => {
      auth++;
      return true;
    },
    load: async () => ({ revision: ++calls }),
    now: () => clock,
  });
  const a = res();
  await h({ method: "GET" }, a);
  const b = res();
  await h({ method: "GET" }, b);
  assert.equal(b.body.revision, 1);
  assert.equal(auth, 2);
  assert.equal(a.headers["Cache-Control"], "private, no-store");
  const c = res();
  await h({ method: "POST" }, c);
  assert.equal(c.body.revision, 2);
  clock = 300001;
  await h({ method: "GET" }, res());
  assert.equal(calls, 3);
});
test("unauthorized requests never load or receive cached private data", async () => {
  let allow = true,
    calls = 0;
  const h = createDealerAnalyticsHandler({
    authorize: async (req, r) => {
      if (!allow) r.status(403).json({ error: "Forbidden" });
      return allow;
    },
    load: async () => {
      calls++;
      return { private: true };
    },
  });
  await h({ method: "GET" }, res());
  allow = false;
  const r = res();
  await h({ method: "GET" }, r);
  assert.equal(r.statusCode, 403);
  assert.equal(calls, 1);
  assert.equal(r.body.private, undefined);
});
test("failed refresh returns an error and in-flight imports coalesce", async () => {
  let resolve,
    calls = 0;
  const h = createDealerAnalyticsHandler({
    authorize: async () => true,
    load: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const a = res(),
    b = res();
  const one = h({ method: "GET" }, a),
    two = h({ method: "POST" }, b);
  await new Promise((r) => setImmediate(r));
  resolve({ ok: true });
  await Promise.all([one, two]);
  assert.equal(calls, 1);
  assert.deepEqual(a.body, b.body);
  const fail = createDealerAnalyticsHandler({
    authorize: async () => true,
    load: async () => {
      throw new Error("No partial totals");
    },
  });
  const r = res();
  await fail({ method: "GET" }, r);
  assert.equal(r.statusCode, 502);
  assert.match(r.body.error, /partial/);
});

test("outstanding customer balances include orders before the selected period", () => {
  const r = buildDealerReport(
    data([
      { ...order("old", "2025-12-01"), outstanding: 250 },
      { ...order("new", "2026-02-01"), outstanding: 50 },
    ]),
  );
  assert.equal(r.customers[0].outstanding, 50);
  assert.equal(r.customers[0].historyOutstanding, 300);
  assert.equal(r.summary.outstanding, 50);
});
test("CSV exports all filtered rows, exact money, date context and neutralized formulas", async () => {
  const { dealerCustomersCsv } = await import("../src/lib/dealer-analytics.js");
  const r = buildDealerReport(data([order("1", "2026-01-01", 75.25)]));
  const customer = {
    ...r.customers[0],
    name: '=HYPERLINK("unsafe")',
    location: "Town, State",
  };
  const csv = dealerCustomersCsv(
    Array.from({ length: 30 }, () => customer),
    { ...r, currency: "USD" },
  );
  assert.equal(csv.split("\r\n").length, 31);
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"'));
  assert.ok(csv.includes('"Town, State"'));
  assert.ok(csv.includes('"2026-01-01","2026-09-12","USD","75.25"'));
  assert.equal(
    dealerCustomersCsv([], { ...r, currency: "USD" }).split("\r\n").length,
    1,
  );
});

test("outreach includes quiet one-time buyers and uses established cadence with a minimum gap", async () => {
  const { buildDealerOutreachQueue } = await import(
    "../src/lib/dealer-analytics.js"
  );
  const base = {
    name: "Dealer",
    contactName: "",
    location: "",
    historySpend: 100,
    historyOutstanding: 0,
    orders: [{}],
    gaps: 0,
    cadence: null,
    sinceLast: 60,
  };
  const q = buildDealerOutreachQueue([
    { ...base, id: "one" },
    { ...base, id: "recent", sinceLast: 59 },
    { ...base, id: "fast", gaps: 2, cadence: 5, sinceLast: 29 },
    { ...base, id: "slow", gaps: 2, cadence: 60, sinceLast: 89 },
    { ...base, id: "due", gaps: 2, cadence: 60, sinceLast: 90 },
    { ...base, id: "zero", historySpend: 0 },
  ]);
  assert.deepEqual(
    q.map((c) => c.id),
    ["due", "one"],
  );
  assert.equal(q[1].reason, "First order, no repeat purchase");
  assert.equal(q[0].threshold, 90);
});
test("outreach sorting, fixed cutoffs, searching and balance guidance are deterministic", async () => {
  const { buildDealerOutreachQueue } = await import(
    "../src/lib/dealer-analytics.js"
  );
  const base = {
    contactName: "",
    contactEmail: "",
    location: "",
    orders: [{}, {}],
    gaps: 1,
    cadence: 45,
    historyOutstanding: 0,
  };
  const rows = [
    { ...base, id: "a", name: "Valuable", sinceLast: 90, historySpend: 1000 },
    {
      ...base,
      id: "b",
      name: "Quiet",
      sinceLast: 180,
      historySpend: 100,
      historyOutstanding: 50,
    },
  ];
  assert.equal(buildDealerOutreachQueue(rows)[0].id, "a");
  assert.equal(buildDealerOutreachQueue(rows, { sort: "quiet" })[0].id, "b");
  assert.equal(buildDealerOutreachQueue(rows, { cutoff: "180" }).length, 1);
  assert.match(
    buildDealerOutreachQueue(rows, { search: "quiet" })[0].action,
    /open balance/,
  );
});
test("outreach export includes contacts and blank follow-up columns without spreadsheet formulas", async () => {
  const { dealerOutreachCsv } = await import("../src/lib/dealer-analytics.js");
  const csv = dealerOutreachCsv(
    [
      {
        name: "=unsafe",
        contactEmail: "roy@example.com",
        contactPhone: "+15555550123",
        historySpend: 100,
        historyOutstanding: 0,
        cadence: null,
      },
    ],
    { asOf: "2026-09-13", currency: "USD" },
  );
  assert.ok(csv.includes('"\'=unsafe"'));
  assert.ok(csv.includes("roy@example.com"));
  assert.ok(csv.includes('"Roy notes"'));
  assert.ok(csv.endsWith(',"","","",""'));
});
