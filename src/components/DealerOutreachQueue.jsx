import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDealerOutreachQueue,
  dealerOutreachCsv,
} from "../lib/dealer-analytics.js";
export default function DealerOutreachQueue({ customers, shop, asOf, onOpen }) {
  const [cutoff, setCutoff] = useState("smart"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("value"),
    [limit, setLimit] = useState(15),
    [exported, setExported] = useState("");
  const section = useRef(null);
  useEffect(() => {
    if (window.location.hash === "#roy-outreach")
      section.current?.scrollIntoView({ block: "start" });
  }, []);
  const queue = useMemo(
    () => buildDealerOutreachQueue(customers, { cutoff, search, sort }),
    [customers, cutoff, search, sort],
  );
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: shop.currency,
      maximumFractionDigits: 0,
    }).format(value);
  function change(setter, value) {
    setter(value);
    setLimit(15);
    setExported("");
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([dealerOutreachCsv(queue, { asOf, currency: shop.currency })], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `roy-dealer-outreach-${asOf.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(
      `Exported ${queue.length} customers, with columns for contact date, outcome, next follow-up and Roy’s notes.`,
    );
  }
  return (
    <section
      className="dealer-customers dealer-outreach"
      id="roy-outreach"
      ref={section}
      aria-label="Roy's outreach queue"
    >
      <div className="dealer-section-head">
        <div>
          <p className="dealer-eyebrow">OUTSIDE SALES · ROY</p>
          <h2>
            Reactivation queue <span>{queue.length}</span>
          </h2>
          <p className="dealer-note">
            A prioritized follow-up list for customers who have gone quiet. Uses
            all order history, independent of the dashboard period.
          </p>
        </div>
        <button
          className="dealer-primary"
          disabled={!queue.length}
          onClick={download}
        >
          Export Roy’s queue
        </button>
      </div>
      <div className="dealer-queue-controls">
        <label>
          Who to contact
          <select
            value={cutoff}
            onChange={(e) => change(setCutoff, e.target.value)}
          >
            <option value="smart">Past usual reorder window</option>
            <option value="60">Quiet for 60+ days</option>
            <option value="90">Quiet for 90+ days</option>
            <option value="180">Quiet for 180+ days</option>
          </select>
        </label>
        <label>
          Priority
          <select
            value={sort}
            onChange={(e) => change(setSort, e.target.value)}
          >
            <option value="value">Highest historical spend</option>
            <option value="quiet">Longest since last order</option>
          </select>
        </label>
        <label>
          Find customer
          <input
            value={search}
            onChange={(e) => change(setSearch, e.target.value)}
            placeholder="Name, contact or location"
          />
        </label>
      </div>
      <p className="dealer-note">
        {cutoff === "smart"
          ? "Repeat buyers enter after 1.5× their average order gap, with a 30-day minimum. With fewer than 3 distinct order dates, the cutoff is 60 days."
          : `Includes customers with no order in at least ${cutoff} days.`}{" "}
        Customers with no positive historical spend are excluded. This queue
        refreshes from Shopify when the dashboard syncs.
      </p>
      {exported && (
        <p role="status" className="dealer-note">
          {exported}
        </p>
      )}
      <div className="dealer-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Priority / customer</th>
              <th>Contact in Shopify</th>
              <th>Last order / usual gap</th>
              <th>Past spend / balance</th>
              <th>Why now / conversation</th>
            </tr>
          </thead>
          <tbody>
            {queue.slice(0, limit).map((c, i) => (
              <tr key={c.id}>
                <td>
                  <small>#{i + 1}</small>
                  <button
                    className="dealer-customer-link"
                    onClick={() => onOpen(c.id)}
                  >
                    {c.name}
                  </button>
                  <small>{c.location}</small>
                  {c.customerId && (
                    <a
                      className="dealer-profile"
                      href={`https://${shop.domain}/admin/customers/${encodeURIComponent(c.customerId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Shopify customer ↗
                    </a>
                  )}
                </td>
                <td className="dealer-contact">
                  <span>{c.contactName || "Contact name unavailable"}</span>
                  <small>{c.contactEmail || "No email in Shopify"}</small>
                  <small>{c.contactPhone || "No phone in Shopify"}</small>
                </td>
                <td>
                  <b>{c.sinceLast} days ago</b>
                  <small>{c.lastOrder}</small>
                  <small>
                    {c.cadence == null
                      ? "No repeat history"
                      : `Usually ${Math.round(c.cadence)} days`}
                  </small>
                </td>
                <td>
                  <b>{money(c.historySpend)}</b>
                  <small>{c.orders.length} historical orders</small>
                  <small>{money(c.historyOutstanding)} outstanding</small>
                </td>
                <td className="dealer-conversation">
                  <b>{c.reason}</b>
                  <small>{c.action}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!queue.length && (
        <p className="dealer-empty">
          No customers match this inactivity window and search.
        </p>
      )}
      <footer className="dealer-table-footer">
        <span>
          Showing {Math.min(limit, queue.length)} of {queue.length} customers ·
          Export includes the full queue
        </span>
        {queue.length > limit && (
          <button onClick={() => setLimit((n) => n + 30)}>Show 30 more</button>
        )}
      </footer>
    </section>
  );
}
