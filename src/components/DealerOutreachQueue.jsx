import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../lib/api.js";
import { dayInZone } from "../lib/dealer-analytics.js";
import { buildDealerOpportunities, summarizeDealerOpportunities, dealerOpportunitiesCsv, outreachLabels } from "../lib/dealer-opportunities.js";

function ContactEditor({ row, today, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => ({
    customer_key: row.id, anchor_order_id: row.anchorOrderId,
    revision: row.record?.revision || 0, status: row.status,
    owner: row.record?.owner || "", last_contact: row.record?.last_contact || "",
    next_follow_up: row.record?.next_follow_up || "", notes: row.record?.notes || "",
  }));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  function change(key, value) { setDraft((d) => ({ ...d, [key]: value })); }
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError("");
    try { await onSave({ ...draft, last_contact: draft.last_contact || null, next_follow_up: draft.next_follow_up || null }); }
    catch (err) { setError(err.message); setSaving(false); }
  }
  return <form className="dealer-contact-editor" onSubmit={submit} aria-label={`Contact tracking for ${row.name}`}>
    <h3>Contact tracking · {row.name}</h3>
    <fieldset disabled={saving}>
      <label>Status<select ref={first} value={draft.status} onChange={(e) => change("status", e.target.value)}>
        {Object.entries(outreachLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Owner<input maxLength={120} value={draft.owner} placeholder="e.g. Roy" onChange={(e) => change("owner", e.target.value)} /></label>
      <label>Last contact<input type="date" max={today} required={["contacted", "replied", "expected"].includes(draft.status)} value={draft.last_contact} onChange={(e) => change("last_contact", e.target.value)} /></label>
      <label>Next follow-up<input type="date" min={draft.last_contact || undefined} value={draft.next_follow_up} onChange={(e) => change("next_follow_up", e.target.value)} /></label>
      <label className="dealer-editor-notes">Notes<textarea rows={3} maxLength={5000} value={draft.notes} placeholder="Conversation, next step, or why this opportunity is closed" onChange={(e) => change("notes", e.target.value)} /></label>
    </fieldset>
    {error && <p className="dealer-error" role="alert">{error}</p>}
    <div className="dealer-editor-actions"><button className="dealer-primary" disabled={saving}>{saving ? "Saving…" : "Save contact tracking"}</button><button type="button" disabled={saving} onClick={onCancel}>Cancel</button></div>
    <p className="dealer-note">Saved for this reorder cycle and shared with your team. Logging a contact does not send a message.</p>
  </form>;
}

export default function DealerOutreachQueue({ customers, shop, asOf, onOpen }) {
  const [tracking, setTracking] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("open"), [sort, setSort] = useState("value"), [limit, setLimit] = useState(15);
  const [editing, setEditing] = useState(null), [notice, setNotice] = useState("");
  const request = useRef(0), section = useRef(null);
  const today = dayInZone(asOf, shop.timeZone);
  const contactToday = dayInZone(new Date().toISOString(), shop.timeZone);
  async function load() {
    const version = ++request.current;
    setLoading(true); setError(""); setEditing(null);
    try {
      const payload = await apiJson("/api/dealer-outreach");
      if (version === request.current) setTracking(payload);
    } catch (err) { if (version === request.current) { setError(err.message); setTracking(null); } }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { load(); return () => { request.current++; }; }, [shop.domain, asOf]);
  useEffect(() => { if (window.location.hash === "#roy-outreach") section.current?.scrollIntoView({ block: "start" }); }, []);
  const opportunities = useMemo(() => buildDealerOpportunities(customers, tracking?.records || [], today), [customers, tracking, today]);
  const summary = useMemo(() => summarizeDealerOpportunities(opportunities), [opportunities]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return opportunities.filter((c) => {
      if (filter === "open" ? c.status === "closed" : filter === "followup" ? !c.followUpDue : filter === "contacted" ? !["contacted", "replied"].includes(c.status) : c.status !== filter) return false;
      return !query || [c.name, c.location, c.contactName, c.contactEmail, c.record?.owner].join(" ").toLowerCase().includes(query);
    }).sort((a, b) => sort === "quiet" ? b.sinceLast - a.sinceLast || b.estimate - a.estimate : b.estimate - a.estimate || a.name.localeCompare(b.name));
  }, [opportunities, search, filter, sort]);
  useEffect(() => { setLimit(15); setEditing(null); }, [search, filter, sort]);
  const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: shop.currency, maximumFractionDigits: 0 }).format(value);
  const ready = tracking && !loading && !error;
  async function save(draft) {
    const version = request.current;
    const { record } = await apiJson("/api/dealer-outreach", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (version !== request.current) return;
    setTracking((state) => ({ ...state, records: [...state.records.filter((r) => !(r.customer_key === record.customer_key && r.anchor_order_id === record.anchor_order_id)), record] }));
    setEditing(null); setNotice("Contact tracking saved and shared with your team.");
  }
  function download() {
    const url = URL.createObjectURL(new Blob([dealerOpportunitiesCsv(rows, shop.currency)], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `dealer-opportunities-${today}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported all ${rows.length} dealers in this view, including saved contact tracking.`);
  }
  return <section className="dealer-customers dealer-outreach" id="roy-outreach" ref={section} aria-label="Dealer revenue opportunities">
    <div className="dealer-section-head"><div><h2>Potential reorder revenue</h2><p className="dealer-note">One potential next order per dealer. Based on purchase history; not booked revenue or a probability-weighted forecast.</p></div><button disabled={loading} onClick={load}>Refresh contact tracking</button></div>
    <div className="dealer-opportunity-summary">
      <div className="dealer-potential-total"><strong>{ready ? money(summary.total) : "—"}</strong><span>{ready ? `${summary.count} open dealer opportunities` : error ? "Contact tracking unavailable" : "Loading contact tracking"}</span><small>As of {today} · independent of the dashboard period</small></div>
      <div className="dealer-potential-stages">
        {[["uncontacted", "No contact logged"], ["contacted", "Contacted / replied"], ["expected", "Order expected"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} disabled={!ready} onClick={() => setFilter(filter === key ? "open" : key)}><span>{label}</span><strong>{ready ? money(summary[key]) : "—"}</strong></button>)}
      </div>
    </div>
    <details className="dealer-estimate-method"><summary>How potential revenue is calculated</summary><p>Each estimate is the median of the dealer’s last three positive order subtotals, or all available positive orders when fewer exist. Tax and shipping are excluded unless tax is included in Shopify prices. With at least three distinct order dates, dealers enter when their usual ordering gap has elapsed, with a 30-day minimum. Otherwise, they enter after 60 days. Estimates based on fewer than three orders are marked as limited history.</p><p>A new positive order starts a new reorder cycle after Shopify refreshes. Earlier contact records are retained, but do not carry into the new cycle. Closed opportunities are excluded from the total. Records without a stable customer identity are excluded. “Order expected” reflects a logged sales conversation; its value still uses the historical estimate.</p></details>
    {error && <p role="alert" className="dealer-error">{error} Opportunity totals and statuses are hidden until contact tracking loads. <button onClick={load}>Retry contact tracking</button></p>}
    {loading && <p role="status" className="dealer-note">Loading shared contact tracking…</p>}
    {notice && <p role="status" className="dealer-note">{notice}</p>}
    {ready && <>
      <div className="dealer-queue-controls">
        <label>Opportunity view<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">All open opportunities ({summary.count})</option><option value="uncontacted">No contact logged</option><option value="contacted">Contacted / replied</option><option value="expected">Order expected</option><option value="followup">Follow-ups due ({summary.followUps})</option><option value="closed">Closed ({summary.closed})</option></select></label>
        <label>Priority<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="value">Highest potential reorder</option><option value="quiet">Longest since last order</option></select></label>
        <label>Find dealer<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Dealer, contact, location or owner" /></label>
        <button disabled={!rows.length} onClick={download}>Export opportunities</button>
      </div>
      {!tracking.canWrite && <p className="dealer-note">You have read-only access. An owner, admin, or strategist can update contact tracking.</p>}
      <div className="dealer-table-wrap"><table><thead><tr><th>Dealer / opportunity</th><th>Potential reorder</th><th>Last order</th><th>Contact</th><th>Outreach / next step</th><th><span className="dealer-sr">Actions</span></th></tr></thead><tbody>
        {rows.slice(0, limit).map((c) => <Fragment key={c.id}><tr>
          <td><button className="dealer-customer-link" onClick={() => onOpen(c.id)}>{c.name}</button><small>{c.location}</small><span className="dealer-opportunity-kind">{c.kind}</span></td>
          <td><b>{money(c.estimate)}</b><small>Based on {c.sampleSize} recent {c.sampleSize === 1 ? "order" : "orders"}</small>{c.sampleSize < 3 && <small className="dealer-limited-history">Limited history</small>}</td>
          <td><b>{c.sinceLast} days ago</b><small>{c.lastOrder}</small><small>{c.reason}</small></td>
          <td className="dealer-contact"><span>{c.contactName || "Contact name unavailable"}</span><small>{c.contactEmail || "No email in Shopify"}</small><small>{c.contactPhone || "No phone in Shopify"}</small>{c.customerId && <a className="dealer-profile" href={`https://${shop.domain}/admin/customers/${encodeURIComponent(c.customerId)}`} target="_blank" rel="noreferrer">Shopify customer ↗</a>}</td>
          <td className="dealer-outreach-status"><b>{outreachLabels[c.status]}</b><small>{c.record?.owner ? `Owner: ${c.record.owner}` : "Unassigned"}</small>{c.record?.last_contact && <small>Last contact: {c.record.last_contact}</small>}{c.record?.next_follow_up && <small className={c.followUpDue ? "dealer-followup-due" : ""}>Follow-up: {c.record.next_follow_up}{c.followUpDue ? " · Due" : ""}</small>}{c.record?.notes && <p className="dealer-saved-notes">{c.record.notes}</p>}</td>
          <td><button disabled={!tracking.canWrite} onClick={() => { setEditing(c.id === editing ? null : c.id); setNotice(""); }}>Update contact</button></td>
        </tr>{editing === c.id && <tr><td colSpan={6}><ContactEditor key={`${c.id}:${c.anchorOrderId}:${c.record?.revision || 0}`} row={c} today={contactToday} onSave={save} onCancel={() => setEditing(null)} /></td></tr>}</Fragment>)}
      </tbody></table></div>
      {!rows.length && <p className="dealer-empty">No dealers match this view. Choose another status or clear your search.</p>}
      <footer className="dealer-table-footer"><span>Showing {Math.min(limit, rows.length)} of {rows.length} dealers · Totals above cover all open opportunities</span>{rows.length > limit && <button onClick={() => setLimit((n) => n + 30)}>Show 30 more</button>}</footer>
    </>}
  </section>;
}
