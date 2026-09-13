import { createHash } from "node:crypto";
import {
  getShopifyAccessToken,
  shopifyContentConfig,
} from "./shopify-content.js";
import { dayInZone } from "../../src/lib/dealer-analytics.js";

const VERSION = "2026-04";
export function normalizeDealerOrders(orders, shop) {
  const seen = new Set();
  return orders
    .filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return (
        !o.test &&
        !o.cancelledAt &&
        !["VOIDED", "EXPIRED"].includes(o.displayFinancialStatus)
      );
    })
    .map((o) => {
      const email = (o.email || "").trim().toLowerCase();
      const customerId = o.customer?.id?.split("/").at(-1) || null;
      const address =
        o.billingAddress || o.shippingAddress || o.customer?.defaultAddress;
      const company =
        o.billingAddress?.company?.trim() ||
        o.shippingAddress?.company?.trim() ||
        o.customer?.defaultAddress?.company?.trim();
      return {
        id: o.id.split("/").at(-1),
        name: o.name,
        createdAt: o.createdAt,
        day: dayInZone(o.createdAt, shop.timeZone),
        customerKey: customerId
          ? `customer:${customerId}`
          : email
            ? `guest:${createHash("sha256").update(email).digest("hex")}`
            : `order:${o.id}`,
        customerId,
        customerName:
          company ||
          o.customer?.displayName ||
          address?.name ||
          "Unidentified customer",
        contactName: o.customer?.displayName || "",
        location: [address?.city, address?.provinceCode, address?.countryCodeV2]
          .filter(Boolean)
          .join(", "),
        netSales: Number(o.currentSubtotalPriceSet.shopMoney.amount),
        taxesIncluded: o.taxesIncluded === true,
        outstanding: Number(o.totalOutstandingSet.shopMoney.amount),
        status: o.displayFinancialStatus,
      };
    });
}

export async function fetchDealerOrders({
  fetchImpl = fetch,
  getToken = () => getShopifyAccessToken("dealer"),
  config = shopifyContentConfig("dealer"),
} = {}) {
  if (!config.store || !config.configured)
    throw new Error(
      "Dealer Shopify is not configured. Ask an administrator to check the dealer app credentials.",
    );
  const token = await getToken();
  const deadline = AbortSignal.timeout(90000);
  async function gql(query, variables = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetchImpl(
        `https://${config.store}/admin/api/${VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query, variables }),
          signal: deadline,
        },
      );
      const data = await r.json();
      if (
        r.status === 429 ||
        data.errors?.some?.((e) => e.extensions?.code === "THROTTLED")
      ) {
        if (attempt === 3)
          throw new Error("Shopify is busy. Wait a moment, then sync again.");
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
        continue;
      }
      if (!r.ok || data.errors)
        throw new Error(
          "Dealer Shopify could not load customer orders. Check read_orders, read_all_orders and read_customers permissions, then retry.",
        );
      return data.data;
    }
  }
  const meta = await gql(
    "{ shop { name myshopifyDomain currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }",
  );
  const scopes = meta.currentAppInstallation.accessScopes.map((s) => s.handle);
  if (!scopes.includes("read_all_orders"))
    throw new Error(
      "Dealer dashboard requires read_all_orders so customer spend and cadence are not limited to 60 days.",
    );
  const shop = {
    name: meta.shop.name,
    domain: meta.shop.myshopifyDomain,
    currency: meta.shop.currencyCode,
    timeZone: meta.shop.ianaTimezone,
  };
  const orders = [];
  let after = null;
  for (let page = 0; page < 100; page++) {
    const data = await gql(
      `query DealerOrders($after: String) {
      orders(first: 100, after: $after, sortKey: CREATED_AT, query: "test:false") {
        pageInfo { hasNextPage endCursor }
        nodes {
          id name createdAt cancelledAt test displayFinancialStatus email taxesIncluded
          currentSubtotalPriceSet { shopMoney { amount } }
          totalOutstandingSet { shopMoney { amount } }
          customer { id displayName defaultAddress { company city provinceCode countryCodeV2 } }
          billingAddress { company name city provinceCode countryCodeV2 }
          shippingAddress { company name city provinceCode countryCodeV2 }
        }
      }
    }`,
      { after },
    );
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) {
      const normalized = normalizeDealerOrders(orders, shop);
      return {
        shop,
        asOf: new Date().toISOString(),
        orders: normalized,
        meta: {
          scanned: orders.length,
          excluded: orders.length - normalized.length,
          pages: page + 1,
          historyComplete: true,
        },
      };
    }
    const next = data.orders.pageInfo.endCursor;
    if (!next || next === after)
      throw new Error(
        "Shopify pagination did not advance. No partial customer totals were published. Retry the sync.",
      );
    after = next;
  }
  throw new Error(
    "Dealer history exceeds 10,000 orders. No partial totals were published. Contact an administrator to increase the import capacity.",
  );
}
