import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/apiFetch.js";
import {
  buildDealerReport,
  dealerCustomersCsv,
  dayInZone,
  periodStart,
} from "../lib/dealer-analytics.js";
import "./DealerDashboard.css";
import DealerOutreachQueue from "./DealerOutreachQueue.jsx";

const labels = {
  learning: "Building history",
  overdue: "Overdue",
  due: "Due to reorder",
  "on-track": "On track",
};
const date = (value) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const days = (value) => (value == null ? "—" : `${Math.round(value)} days`);
const percent = (value) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;
export default function DealerDashboard({ setActiveTab }) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [preset, setPreset] = useState("ytd"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active");
  const [sort, setSort] = useState({ key: "spend", direction: -1 }),
    [selected, setSelected] = useState(null),
    [limit, setLimit] = useState(25);
  const [historyView, setHistoryView] = useState("period"),
    [exportNotice, setExportNotice] = useState("");
  const alive = useRef(true),
    detail = useRef(null),
    request = useRef(0);
  async function load(refresh = false) {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/dealer-analytics", {
        method: refresh ? "POST" : "GET",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Could not load dealer orders.");
      if (alive.current && request.current === version) setData(payload);
    } catch (e) {
      if (alive.current && request.current === version) setError(e.message);
    } finally {
      if (alive.current && request.current === version) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, []);
  const report = useMemo(() => {
    if (!data) return null;
    const today = dayInZone(data.asOf, data.shop.timeZone);
    const firstDay = data.orders.reduce(
      (min, o) => (o.day < min ? o.day : min),
      today,
    );
    return buildDealerReport(data, {
      start: periodStart(preset, today, firstDay),
    });
  }, [data, preset]);
  const rows = useMemo(() => {
    if (!report) return [];
    const query = search.trim().toLowerCase();
    return report.customers
      .filter((c) => {
        if (
          query &&
          !`${c.name} ${c.contactName} ${c.location}`
            .toLowerCase()
            .includes(query)
        )
          return false;
        if (filter === "balance") return c.historyOutstanding > 0;
        if (filter === "active") return c.periodOrders.length > 0;
        if (filter === "repeat")
          return c.periodOrders.length > 0 && c.orders.length > 1;
        if (filter === "new")
          return c.periodOrders.length > 0 && c.firstOrder >= report.start;
        if (filter === "watch") return ["due", "overdue"].includes(c.status);
        return true;
      })
      .sort((a, b) => {
        const value = (c) =>
          sort.key === "count" ? c.periodOrders.length : c[sort.key];
        const av = value(a),
          bv = value(b);
        if (av == null) return bv == null ? 0 : 1;
        if (bv == null) return -1;
        return (
          (typeof av === "string" ? av.localeCompare(bv) : av - bv) *
            sort.direction || a.name.localeCompare(b.name)
        );
      });
  }, [report, search, filter, sort]);
  useEffect(() => {
    setLimit(25);
    setExportNotice("");
  }, [search, filter, preset, sort]);
  const customer = report?.customers.find((c) => c.id === selected);
  const money = (n) =>
    n == null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: data?.shop.currency || "USD",
          maximumFractionDigits: 0,
        }).format(n);
  const exactMoney = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: data.shop.currency,
    }).format(n);
  function openCustomer(id) {
    setSelected(id);
    setHistoryView(filter === "balance" ? "unpaid" : "period");
    requestAnimationFrame(() => {
      detail.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      detail.current?.focus({ preventScroll: true });
    });
  }
  const detailOrders = customer
    ? historyView === "period"
      ? customer.periodOrders
      : historyView === "unpaid"
        ? customer.orders.filter((o) => o.outstanding > 0)
        : customer.orders
    : [];
  function exportCustomers() {
    const blob = new Blob(
      [dealerCustomersCsv(rows, { ...report, currency: data.shop.currency })],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dealer-customers-${report.start}-${report.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice(
      `Exported ${rows.length} customers with the current search, filter and sort.`,
    );
  }
  function sortBy(key) {
    setSort((old) => ({
      key,
      direction: old.key === key ? -old.direction : key === "name" ? 1 : -1,
    }));
  }
  function heading(key, text) {
    return (
      <th
        aria-sort={
          sort.key === key
            ? sort.direction === 1
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button type="button" onClick={() => sortBy(key)}>
          {text} {sort.key === key ? (sort.direction === 1 ? "↑" : "↓") : "↕"}
        </button>
      </th>
    );
  }
  const s = report?.summary;
  const watch =
    report?.customers
      .filter((c) => ["overdue", "due"].includes(c.status))
      .sort((a, b) => b.sinceLast / b.cadence - a.sinceLast / a.cadence)
      .slice(0, 4) || [];
  return (
    <div className="dealer-dashboard">
      <nav className="dealer-tabs" aria-label="Analytics dashboards">
        <button onClick={() => setActiveTab?.("dashboard-cfo")}>CFO</button>
        <button aria-current="page">Dealers</button>
        <button onClick={() => setActiveTab?.("dashboard-creative")}>
          Creative
        </button>
        <button onClick={() => setActiveTab?.("dashboard-forecast")}>
          Forecast
        </button>
      </nav>
      <header className="dealer-header">
        <div>
          <p className="dealer-eyebrow">DEALER INTELLIGENCE · SHOPIFY</p>
          <h1>Know your next order.</h1>
          <p>Customer value, buying rhythm, and the accounts to keep close.</p>
        </div>
        <div className="dealer-controls">
          <a className="dealer-queue-shortcut" href="#roy-outreach">
            Roy’s queue ↓
          </a>
          <label>
            Period
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="ytd">Year to date</option>
              <option value="90d">Last 90 days</option>
              <option value="12m">Last 365 days</option>
              <option value="all">All history</option>
            </select>
          </label>
          <button
            className="dealer-primary"
            onClick={() => load(true)}
            disabled={loading}
          >
            {loading ? "Syncing…" : "Refresh Shopify"}
          </button>
        </div>
      </header>
      {error && (
        <div className="dealer-error" role="alert">
          {data && "Showing the last successful sync. "}
          {error}{" "}
          <button disabled={loading} onClick={() => load(true)}>
            Retry
          </button>
        </div>
      )}
      {!data && (
        <div className="dealer-empty" role="status">
          {loading
            ? "Reading dealer order history from Shopify…"
            : "Dealer data could not be loaded. Retry the sync above."}
        </div>
      )}
      {report && (
        <>
          <div className="dealer-source">
            <span className="dealer-dot" />
            {data.shop.name}{" "}
            <span>
              · {date(report.start)} – {date(report.end)} · {data.shop.currency}
            </span>
            <span className="dealer-freshness">
              Synced {new Date(data.asOf).toLocaleString()} ·{" "}
              {data.orders.length.toLocaleString()} orders in history
            </span>
          </div>
          <section className="dealer-metrics" aria-label="Dealer performance">
            <div>
              <span>Net ordered</span>
              <strong>{money(s.netSales)}</strong>
              <small>{s.orders.toLocaleString()} orders in period</small>
            </div>
            <div>
              <span>Ordering customers</span>
              <strong>{s.activeCustomers}</strong>
              <small>{s.newCustomers} first-time customers</small>
            </div>
            <div>
              <span>Average order</span>
              <strong>{money(s.aov)}</strong>
              <small>Shopify merchandise subtotal per order</small>
            </div>
            <div>
              <span>Average ordering cadence</span>
              <strong>{days(s.cadence)}</strong>
              <small>Across {s.cadenceCustomers} repeat customers</small>
            </div>
          </section>
          <div className="dealer-insights">
            <section className="dealer-trend">
              <div className="dealer-section-head">
                <div>
                  <p className="dealer-eyebrow">THE ORDER BOOK</p>
                  <h2>Net orders by month</h2>
                </div>
                <span>{percent(s.repeatSalesShare)} from repeat orders</span>
              </div>
              <div
                className="dealer-bars"
                role="list"
                aria-label="Monthly net order sales"
              >
                {report.months.map((m) => (
                  <div
                    className="dealer-bar-column"
                    role="listitem"
                    key={m.month}
                    tabIndex={0}
                    aria-label={`${m.month}: ${exactMoney(m.netSales)}, ${m.orders} orders`}
                  >
                    <div className="dealer-bar-track">
                      <div
                        className="dealer-bar"
                        style={{
                          height: `${Math.max(m.netSales > 0 ? 2 : 0, (m.netSales / Math.max(1, ...report.months.map((x) => x.netSales))) * 100)}%`,
                        }}
                      />
                    </div>
                    <span>
                      {new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString(
                        "en-US",
                        { month: "short", year: "2-digit", timeZone: "UTC" },
                      )}
                    </span>
                    <div className="dealer-tooltip">
                      {exactMoney(m.netSales)}
                      <br />
                      {m.orders} orders
                    </div>
                  </div>
                ))}
              </div>
              <div className="dealer-trend-foot">
                <span>
                  Top 5 customers <b>{percent(s.topFiveShare)}</b> of net orders
                </span>
                <span>
                  Outstanding balance <b>{money(s.outstanding)}</b>
                </span>
              </div>
            </section>
            <section className="dealer-watch">
              <div className="dealer-section-head">
                <div>
                  <p className="dealer-eyebrow">RELATIONSHIPS</p>
                  <h2>Reorder watch</h2>
                </div>
                <span>{s.overdue} overdue</span>
              </div>
              {watch.length ? (
                watch.map((c) => (
                  <button
                    className="dealer-watch-row"
                    key={c.id}
                    onClick={() => openCustomer(c.id)}
                  >
                    <span>
                      <b>{c.name}</b>
                      <small>
                        {c.sinceLast} days since last order · usually{" "}
                        {days(c.cadence)}
                      </small>
                    </span>
                    <span className={`dealer-badge ${c.status}`}>
                      {labels[c.status]}
                    </span>
                  </button>
                ))
              ) : (
                <p className="dealer-subtle">
                  No accounts are due based on established ordering history.
                </p>
              )}
              <p className="dealer-note">
                Estimates use at least 3 distinct order dates. Overdue means
                more than 1.5× the usual gap; this is a prompt to review, not a
                forecast.
              </p>
            </section>
          </div>
          <DealerOutreachQueue
            customers={report.customers}
            shop={data.shop}
            asOf={data.asOf}
            onOpen={openCustomer}
          />
          <section className="dealer-customers">
            <div className="dealer-section-head">
              <div>
                <p className="dealer-eyebrow">YOUR DEALER NETWORK</p>
                <h2>
                  Customer leaderboard <span>{rows.length}</span>
                </h2>
              </div>
              <div className="dealer-table-controls">
                <label>
                  <span className="dealer-sr">Search customers</span>
                  <input
                    placeholder="Search customer or location…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  <span className="dealer-sr">Customer filter</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="active">Ordered in period</option>
                    <option value="all">All customers</option>
                    <option value="repeat">Repeat customers</option>
                    <option value="new">First-time customers</option>
                    <option value="watch">Due / overdue</option>
                    <option value="balance">Outstanding balances</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="dealer-export-row">
              <p className="dealer-note">
                Spend and order counts follow the selected period. Outstanding
                balances cover all imported history.
              </p>
              <button onClick={exportCustomers} disabled={!rows.length}>
                Export {rows.length} customers
              </button>
            </div>
            {exportNotice && (
              <p role="status" className="dealer-note">
                {exportNotice}
              </p>
            )}
            <div className="dealer-table-wrap">
              <table>
                <thead>
                  <tr>
                    {heading("name", "Customer")}
                    {heading("spend", "Net ordered")}
                    {heading("count", "Orders")}
                    {heading("historyOutstanding", "Outstanding")}
                    {heading("aov", "Avg order")}
                    {heading("cadence", "Cadence")}
                    {heading("lastOrder", "Last order")}
                    <th>Reorder status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((c) => (
                    <tr
                      key={c.id}
                      className={selected === c.id ? "dealer-selected" : ""}
                    >
                      <td>
                        <button
                          className="dealer-customer-link"
                          onClick={() => openCustomer(c.id)}
                        >
                          {c.name}
                        </button>
                        <small>{c.location || "Location unavailable"}</small>
                      </td>
                      <td>{money(c.spend)}</td>
                      <td>{c.periodOrders.length}</td>
                      <td>{money(c.historyOutstanding)}</td>
                      <td>{money(c.aov)}</td>
                      <td>{days(c.cadence)}</td>
                      <td>{date(c.lastOrder)}</td>
                      <td>
                        <span className={`dealer-badge ${c.status}`}>
                          {labels[c.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <p className="dealer-empty">
                No customers match this period and filter.
              </p>
            )}
            <footer className="dealer-table-footer">
              <span>
                Showing {Math.min(limit, rows.length)} of {rows.length}{" "}
                customers
              </span>
              {rows.length > limit && (
                <button onClick={() => setLimit((n) => n + 50)}>
                  Show 50 more
                </button>
              )}
            </footer>
          </section>
          {customer && (
            <section
              className="dealer-detail"
              ref={detail}
              tabIndex={-1}
              aria-label={`Customer details for ${customer.name}`}
            >
              <div className="dealer-section-head">
                <div>
                  <p className="dealer-eyebrow">CUSTOMER DETAIL</p>
                  <h2>{customer.name}</h2>
                  <p>
                    {customer.contactName !== customer.name &&
                      customer.contactName}{" "}
                    {customer.location && `· ${customer.location}`}
                  </p>
                </div>
                <button onClick={() => setSelected(null)}>Close details</button>
              </div>
              <div className="dealer-detail-stats">
                <div>
                  <span>Net ordered in period</span>
                  <strong>{money(customer.spend)}</strong>
                </div>
                <div>
                  <span>All-history net ordered</span>
                  <strong>{money(customer.historySpend)}</strong>
                </div>
                <div>
                  <span>Typical order gap</span>
                  <strong>{days(customer.cadence)}</strong>
                  <small>{customer.gaps} observed intervals</small>
                </div>
                <div>
                  <span>Estimated next order</span>
                  <strong>
                    {customer.gaps >= 2
                      ? date(customer.nextOrder)
                      : "More history needed"}
                  </strong>
                </div>
              </div>
              <p className="dealer-note">
                First order {date(customer.firstOrder)} ·{" "}
                {customer.orders.length} orders across imported history. Cadence
                uses all available history. Outstanding balance across history:{" "}
                {exactMoney(customer.historyOutstanding)}.
              </p>
              <div className="dealer-history-controls">
                <label>
                  Show orders{" "}
                  <select
                    value={historyView}
                    onChange={(e) => setHistoryView(e.target.value)}
                  >
                    <option value="period">
                      Selected period ({customer.periodOrders.length})
                    </option>
                    <option value="all">
                      All history ({customer.orders.length})
                    </option>
                    <option value="unpaid">
                      Outstanding only (
                      {customer.orders.filter((o) => o.outstanding > 0).length})
                    </option>
                  </select>
                </label>
                <span>{detailOrders.length} orders shown</span>
              </div>
              <div className="dealer-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Net ordered</th>
                      <th>Outstanding</th>
                      <th>Payment status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...detailOrders].reverse().map((o) => (
                      <tr key={o.id}>
                        <td>
                          <a
                            href={`https://${data.shop.domain}/admin/orders/${encodeURIComponent(o.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {o.name} ↗
                          </a>
                        </td>
                        <td>{date(o.day)}</td>
                        <td>{exactMoney(o.netSales)}</td>
                        <td>{exactMoney(o.outstanding)}</td>
                        <td>{o.status.toLowerCase().replaceAll("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!detailOrders.length && (
                <p>
                  No orders in this view. Select All history to view earlier
                  orders.
                </p>
              )}
            </section>
          )}
          <details className="dealer-definitions">
            <summary>How these numbers are calculated</summary>
            <p>
              Net ordered uses each order’s current merchandise subtotal after
              discounts and refunds. Shipping is excluded; tax is excluded
              unless Shopify includes it in the merchandise price. Cancelled,
              test, voided and expired orders are excluded. Unpaid orders are
              included; outstanding balances include tax and shipping. Refunds
              adjust the original order date, so totals can differ from the
              CFO’s Shopify sales reports, which recognize adjustments on their
              reporting dates.
            </p>
            <p>
              Customers are grouped by Shopify customer ID, or an email
              fingerprint for guest orders. Company names are display labels;
              separate customer records are not merged by name. Repeat customers
              have more than one historical order. New and repeat groups can
              overlap when a customer first orders and reorders within the same
              period.
            </p>
            <p>
              Cadence is the mean gap between distinct order dates in the
              store’s time zone. The dashboard average gives each active repeat
              customer equal weight. Due status uses all imported history,
              including accounts with no orders in the selected period. No
              manual CFO inputs are used.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
