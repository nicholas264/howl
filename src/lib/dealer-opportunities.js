export const outreachLabels = {
  uncontacted: "No contact logged",
  contacted: "Contacted",
  replied: "Replied",
  expected: "Order expected",
  closed: "Closed / not pursuing",
};
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const gap = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const opportunityKey = (customer, anchor) => JSON.stringify([customer, anchor]);

// One reorder per account, never multiplied by the number of missed cycles.
export function buildDealerOpportunities(customers, records = [], today, followUpDay = today) {
  const saved = new Map(records.map((r) => [opportunityKey(r.customer_key, r.anchor_order_id), r]));
  const seen = new Set();
  return customers.flatMap((c) => {
    if (seen.has(c.id) || c.id.startsWith("order:")) return [];
    seen.add(c.id);
    const orders = [...new Map(c.orders.filter((o) => o.netSales > 0 && o.day <= today).map((o) => [o.id, o])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (!orders.length) return [];
    const last = orders.at(-1);
    const dates = [...new Set(orders.map((o) => o.day))].sort();
    const cadence = dates.length >= 3 ? gap(dates[0], dates.at(-1)) / (dates.length - 1) : null;
    const threshold = cadence == null ? 60 : Math.max(30, Math.ceil(cadence));
    const sinceLast = gap(last.day, today);
    const record = saved.get(opportunityKey(c.id, last.id));
    // Keep an explicitly active sales conversation visible even before it is due.
    if (sinceLast < threshold && (!record || record.status === "uncontacted")) return [];
    const recent = orders.slice(-3).map((o) => o.netSales).sort((a, b) => a - b);
    const middle = Math.floor(recent.length / 2);
    const estimate = round(recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2);
    const status = record?.status || "uncontacted";
    return [{
      ...c, lastOrder: last.day, anchorOrderId: last.id, sinceLast, cadence,
      estimate, sampleSize: recent.length, status, record, threshold,
      kind: orders.length === 1 ? "Second order" : sinceLast >= Math.max(60, threshold * 1.5) ? "Reactivation" : "Replenishment",
      reason: orders.length === 1 ? "First purchase has not repeated" : cadence == null ? "Quiet for 60+ days; limited repeat history" : `${sinceLast} days since order; usual gap ${Math.round(cadence)} days`,
      followUpDue: status !== "closed" && !!record?.next_follow_up && record.next_follow_up <= followUpDay,
    }];
  }).sort((a, b) => b.estimate - a.estimate || b.sinceLast - a.sinceLast || a.name.localeCompare(b.name));
}

export function summarizeDealerOpportunities(rows) {
  const summary = { total: 0, uncontacted: 0, contacted: 0, expected: 0, count: 0, followUps: 0, closed: 0 };
  for (const row of rows) {
    if (row.status === "closed") { summary.closed++; continue; }
    summary.count++;
    summary.total += row.estimate;
    summary[row.status === "replied" ? "contacted" : row.status] += row.estimate;
    if (row.followUpDue) summary.followUps++;
  }
  for (const key of ["total", "uncontacted", "contacted", "expected"]) summary[key] = round(summary[key]);
  return summary;
}

export function dealerOpportunitiesCsv(rows, currency) {
  const cell = (v) => '"' + String(v ?? "").replace(/^[\s]*[=+@-]/, (s) => "'" + s).replaceAll('"', '""') + '"';
  const data = [["Dealer", "Potential reorder", "Currency", "Estimate order count", "Opportunity", "Status", "Contact", "Email", "Phone", "Last order", "Owner", "Last contact", "Next follow-up", "Notes"]];
  for (const c of rows) data.push([c.name, c.estimate.toFixed(2), currency, c.sampleSize, c.kind, outreachLabels[c.status], c.contactName, c.contactEmail, c.contactPhone, c.lastOrder, c.record?.owner, c.record?.last_contact, c.record?.next_follow_up, c.record?.notes]);
  return "\uFEFF" + data.map((r) => r.map(cell).join(",")).join("\r\n");
}
