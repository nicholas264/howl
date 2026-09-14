const DAY = 86400000;
const isScheels = (name) => /\bscheel['’]?s\b/i.test(name || "");
function revenueMix(netSales, scheelsSales) {
  return {
    scheelsSales: round(scheelsSales),
    otherDealerSales: round(netSales - scheelsSales),
    scheelsShare: netSales > 0 ? scheelsSales / netSales : null,
    otherDealerShare: netSales > 0 ? (netSales - scheelsSales) / netSales : null,
  };
}
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysBetween = (a, b) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY,
  );
export function dayInZone(value, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type).value)
    .join("-");
}
export function periodStart(preset, today, firstDay) {
  if (preset === "all") return firstDay || today;
  if (preset === "ytd") return `${today.slice(0, 4)}-01-01`;
  const n = preset === "90d" ? 89 : 364;
  return new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
}
export function buildDealerReport(data, { start, end } = {}) {
  const today = dayInZone(data.asOf, data.shop.timeZone);
  const until = end && end < today ? end : today;
  const since = start || `${until.slice(0, 4)}-01-01`;
  const history = data.orders
    .filter((o) => o.day <= until)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const groups = new Map(),
    monthly = new Map();
  let netSales = 0,
    scheelsSales = 0,
    periodOrders = 0,
    repeatSales = 0;
  for (const o of history) {
    let c = groups.get(o.customerKey);
    if (!c) {
      c = {
        id: o.customerKey,
        name: o.customerName,
        contactName: o.contactName,
        customerId: o.customerId,
        location: o.location,
        orders: [],
        periodOrders: [],
        spend: 0,
        historySpend: 0,
      };
      groups.set(c.id, c);
    }
    const repeat = c.orders.length > 0;
    c.name = o.customerName;
    c.contactName = o.contactName;
    c.contactEmail = o.contactEmail || c.contactEmail || "";
    c.contactPhone = o.contactPhone || c.contactPhone || "";
    c.location = o.location;
    c.orders.push(o);
    c.historySpend += o.netSales;
    if (o.day < since) continue;
    c.periodOrders.push(o);
    c.spend += o.netSales;
    netSales += o.netSales;
    const scheels = isScheels(o.customerName);
    if (scheels) scheelsSales += o.netSales;
    periodOrders++;
    if (repeat) repeatSales += o.netSales;
    const month = o.day.slice(0, 7);
    if (!monthly.has(month))
      monthly.set(month, { month, netSales: 0, orders: 0, scheelsSales: 0 });
    monthly.get(month).netSales += o.netSales;
    if (scheels) monthly.get(month).scheelsSales += o.netSales;
    monthly.get(month).orders++;
  }
  const customers = [...groups.values()]
    .map((c) => {
      const dates = [...new Set(c.orders.map((o) => o.day))].sort();
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      const cadence = gaps.length
        ? gaps.reduce((a, b) => a + b, 0) / gaps.length
        : null;
      const sinceLast = daysBetween(dates.at(-1), until);
      const status =
        gaps.length < 2
          ? "learning"
          : sinceLast > cadence * 1.5
            ? "overdue"
            : sinceLast >= cadence
              ? "due"
              : "on-track";
      const nextOrder =
        cadence === null
          ? null
          : new Date(
              Date.parse(`${dates.at(-1)}T00:00:00Z`) +
                Math.round(cadence) * DAY,
            )
              .toISOString()
              .slice(0, 10);
      return {
        ...c,
        spend: round(c.spend),
        historySpend: round(c.historySpend),
        firstOrder: dates[0],
        lastOrder: dates.at(-1),
        cadence,
        gaps: gaps.length,
        orderDates: dates,
        orderGaps: gaps.map((days, i) => ({
          from: dates[i],
          to: dates[i + 1],
          days,
        })),
        sinceLast,
        status,
        nextOrder,
        aov: c.periodOrders.length ? c.spend / c.periodOrders.length : null,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  const active = customers.filter((c) => c.periodOrders.length);
  const repeat = active.filter((c) => c.orders.length > 1);
  const cadenceCustomers = active.filter((c) => c.cadence !== null);
  const months = [];
  const cursor = new Date(`${since.slice(0, 7)}-01T12:00:00Z`);
  while (
    cursor.toISOString().slice(0, 7) <= until.slice(0, 7) &&
    months.length < 240
  ) {
    const month = cursor.toISOString().slice(0, 7);
    const row = monthly.get(month) || { month, netSales: 0, orders: 0, scheelsSales: 0 };
    months.push({ ...row, ...revenueMix(row.netSales, row.scheelsSales) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return {
    start: since,
    end: until,
    customers,
    months,
    summary: {
      netSales: round(netSales),
      ...revenueMix(netSales, scheelsSales),
      orders: periodOrders,
      activeCustomers: active.length,
      newCustomers: active.filter((c) => c.firstOrder >= since).length,
      repeatCustomers: repeat.length,
      repeatRate: active.length ? repeat.length / active.length : null,
      aov: periodOrders ? netSales / periodOrders : null,
      cadence: cadenceCustomers.length
        ? cadenceCustomers.reduce((sum, c) => sum + c.cadence, 0) /
          cadenceCustomers.length
        : null,
      cadenceCustomers: cadenceCustomers.length,
      topFiveShare:
        netSales > 0
          ? active.slice(0, 5).reduce((sum, c) => sum + c.spend, 0) / netSales
          : null,
      repeatSalesShare: netSales > 0 ? repeatSales / netSales : null,
      overdue: customers.filter((c) => c.status === "overdue").length,
    },
  };
}

// Quote every cell and neutralize spreadsheet formulas in customer-supplied text.
export function dealerCustomersCsv(customers, { start, end, currency }) {
  const cell = (value) => {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "Customer",
      "Location",
      "Period start",
      "Period end",
      "Currency",
      "Net ordered in period",
      "Orders in period",
      "Average order",
      "Cadence days",
      "Last order",
      "Reorder status",
      "Net ordered all history",
    ],
  ];
  for (const c of customers)
    rows.push([
      c.name,
      c.location,
      start,
      end,
      currency,
      c.spend.toFixed(2),
      c.periodOrders.length,
      c.aov == null ? "" : c.aov.toFixed(2),
      c.cadence == null ? "" : c.cadence.toFixed(1),
      c.lastOrder,
      c.status,
      c.historySpend.toFixed(2),
    ]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function buildDealerOutreachQueue(
  customers,
  { cutoff = "smart", search = "", sort = "value" } = {},
) {
  const query = search.trim().toLowerCase();
  return customers
    .flatMap((c) => {
      const established = c.gaps >= 2 && c.cadence > 0;
      const threshold =
        cutoff === "smart"
          ? established
            ? Math.max(30, Math.ceil(c.cadence * 1.5))
            : 60
          : Number(cutoff);
      if (
        !Number.isFinite(threshold) ||
        threshold < 1 ||
        c.sinceLast < threshold ||
        c.historySpend <= 0
      )
        return [];
      if (
        query &&
        ![c.name, c.contactName, c.contactEmail, c.location]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
        return [];
      const reason =
        c.orders.length === 1
          ? "First order, no repeat purchase"
          : established
            ? "Past usual reorder window"
            : "Repeat buyer gone quiet";
      const action =
        c.orders.length === 1
          ? "Ask how the first order sold through and offer help with the next order."
          : "Check inventory and sell-through; discuss the next replenishment order.";
      return [{ ...c, threshold, reason, action }];
    })
    .sort((a, b) =>
      sort === "quiet"
        ? b.sinceLast - a.sinceLast ||
          b.historySpend - a.historySpend ||
          a.name.localeCompare(b.name)
        : b.historySpend - a.historySpend ||
          b.sinceLast - a.sinceLast ||
          a.name.localeCompare(b.name),
    );
}
export function dealerOutreachCsv(queue, { asOf, currency }) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "Priority",
      "Customer",
      "Contact",
      "Email",
      "Phone",
      "Location",
      "Last order",
      "Days since order",
      "Usual gap days",
      "Historical net ordered",
      "Currency",
      "Reason",
      "Suggested conversation",
      "Data as of",
      "Contacted on",
      "Outcome",
      "Next follow-up",
      "Roy notes",
    ],
  ];
  queue.forEach((c, i) =>
    rows.push([
      i + 1,
      c.name,
      c.contactName,
      c.contactEmail,
      c.contactPhone,
      c.location,
      c.lastOrder,
      c.sinceLast,
      c.cadence == null ? "" : c.cadence.toFixed(1),
      c.historySpend.toFixed(2),
      currency,
      c.reason,
      c.action,
      asOf,
      "",
      "",
      "",
      "",
    ]),
  );
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
