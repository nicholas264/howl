import { useCallback, useEffect, useMemo, useState } from 'react';

const STATUS_OPTIONS = [
  ['planned', 'Planned'],
  ['ordered', 'Ordered'],
  ['in_transit', 'In transit'],
  ['delivered', 'Delivered'],
  ['blocked', 'Blocked'],
];

const EMPTY_ADD = {
  creator_id: '',
  seeded_on: '',
  product_label: '',
  unit_type: '',
  quantity: '1',
  shipping_cost: '',
  creator_fee: '',
  seeding_status: 'planned',
  agreed_deliverables: '',
  deliverable_due: '',
  usage_rights: '',
  notes: '',
};

const fmt$ = n => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '-';
const fmtMo = m => {
  if (!m) return 'Undated';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
const monthKey = date => date ? String(date).slice(0, 7) : 'undated';
const labelForStatus = value => STATUS_OPTIONS.find(([key]) => key === value)?.[1] || 'Planned';

function inferStatus(row) {
  if (row.seeding_status) return row.seeding_status;
  const note = `${row.notes || ''} ${row.usage_rights || ''}`.toLowerCase();
  if (note.includes('delivered')) return 'delivered';
  if (note.includes('transit')) return 'in_transit';
  if (note.includes('blocked') || note.includes('waiting')) return 'blocked';
  if (note.includes('progress')) return 'ordered';
  return 'planned';
}

function rowToForm(row) {
  return {
    id: row.id,
    seeded_on: row.seeded_on || '',
    product_label: row.product_label || '',
    unit_type: row.unit_type || '',
    quantity: String(row.quantity || 1),
    unit_cogs: String(row.unit_cogs || 0),
    shipping_cost: row.shipping_cost ? String(row.shipping_cost) : '',
    creator_fee: row.creator_fee ? String(row.creator_fee) : '',
    seeding_status: inferStatus(row),
    agreed_deliverables: row.agreed_deliverables ? String(row.agreed_deliverables) : '',
    deliverable_due: row.deliverable_due || '',
    usage_rights: row.usage_rights || '',
    notes: row.notes || '',
  };
}

function Score({ label, value, detail, tone = '' }) {
  return (
    <div className={`seed-score ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export default function SeedingLedger({ canManage = false }) {
  const [data, setData] = useState(null);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_ADD);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fees, setFees] = useState(null);
  const [feeBusy, setFeeBusy] = useState(null);
  const [filters, setFilters] = useState({ month: 'all', status: 'all', search: '' });

  const loadFees = useCallback(async () => {
    try {
      const res = await fetch('/api/creator-fees');
      if (res.ok) setFees(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ledger, cre] = await Promise.all([
        fetch('/api/creator-seeding-log').then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load ledger'))),
        fetch('/api/creators').then(r => r.ok ? r.json() : { creators: [] }),
      ]);
      setData(ledger);
      setCreators((cre.creators || []).map(c => ({ id: c.id, name: c.name })));
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadFees(); }, [load, loadFees]);

  async function convertFee(intent) {
    setFeeBusy(intent.creator_name);
    try {
      await fetch('/api/creator-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: intent.suggested_creator_id,
          creator_name: intent.creator_name,
          amount: intent.amount,
          type: intent.type,
          note: intent.note,
        }),
      });
      await loadFees();
    } finally {
      setFeeBusy(null);
    }
  }

  const rows = data?.rows || [];
  const units = data?.units || [];
  const openFeeIntents = fees?.intents?.filter(i => !i.converted) || [];

  const months = useMemo(() => {
    const set = new Set(rows.map(r => monthKey(r.seeded_on)).filter(Boolean));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows.filter(row => {
      const status = inferStatus(row);
      if (filters.month !== 'all' && monthKey(row.seeded_on) !== filters.month) return false;
      if (filters.status === 'needs_deliverable') {
        const missing = row.agreed_deliverables && !row.deliverable_due;
        if (!missing) return false;
      } else if (filters.status !== 'all' && status !== filters.status) {
        return false;
      }
      if (!q) return true;
      return [
        row.creator_name,
        row.product_label,
        row.unit_type,
        row.usage_rights,
        row.notes,
      ].some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, filters]);

  const totals = useMemo(() => {
    return rows.reduce((a, r) => {
      const status = inferStatus(r);
      const total = Number(r.total_cost) || 0;
      a.units += Number(r.quantity) || 0;
      a.cogs += Number(r.cogs_total) || 0;
      a.shipping += Number(r.shipping_cost) || 0;
      a.fees += Number(r.creator_fee) || 0;
      a.total += total;
      if (status !== 'delivered') a.openShipments += 1;
      if (r.agreed_deliverables && !r.deliverable_due) a.needsDue += 1;
      return a;
    }, { units: 0, cogs: 0, shipping: 0, fees: 0, total: 0, openShipments: 0, needsDue: 0 });
  }, [rows]);

  const catalogCost = ut => units.find(u => u.unit_type === ut)?.cogs || 0;

  async function saveUnit(unit_type, cogs) {
    await fetch('/api/creator-seeding-log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unit', unit_type, cogs: Number(cogs) || 0 }),
    });
    load();
  }

  async function addRow(e) {
    e.preventDefault();
    if (!form.creator_id || !form.unit_type) return;
    setBusy(true);
    try {
      const res = await fetch('/api/creator-seeding-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
      setForm(EMPTY_ADD);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm?.id) return;
    setBusy(true);
    try {
      const res = await fetch('/api/creator-seeding-log', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not update row');
      setEditingId(null);
      setEditForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(id) {
    if (!confirm('Remove this seeding row?')) return;
    await fetch(`/api/creator-seeding-log?id=${id}`, { method: 'DELETE' });
    load();
  }

  if (loading && !data) return <div className="forge"><div className="forge-empty">Loading seeding ledger...</div></div>;
  if (error && !data) return <div className="forge"><div className="forge-empty">{error}</div></div>;

  return (
    <div className="forge seed-page">
      <div className="forge-head">
        <div>
          <div className="forge-eyebrow">Product Seeding</div>
          <h1>Creator Investment Ledger</h1>
          <p className="forge-sub">
            One place for seeded product, COGS, creator fees, deliverable promises, usage terms, and what still needs a follow-up.
          </p>
        </div>
        {canManage && (
          <button type="button" className="primary-action" onClick={() => setAdding(v => !v)}>
            {adding ? 'Close' : 'Add seeding'}
          </button>
        )}
      </div>

      {error && <div className="app-error">{error}</div>}

      <div className="seed-scoreboard">
        <Score label="Total invested" value={fmt$(totals.total)} detail={`${totals.units.toLocaleString()} units seeded`} tone="hero" />
        <Score label="Product COGS" value={fmt$(totals.cogs)} detail="Catalog-driven" />
        <Score label="Creator fees" value={fmt$(totals.fees)} detail={`${openFeeIntents.length} fee notes open`} />
        <Score label="Open shipments" value={totals.openShipments.toLocaleString()} detail="Not marked delivered" tone={totals.openShipments ? 'warn' : ''} />
        <Score label="Need due date" value={totals.needsDue.toLocaleString()} detail="Deliverables promised" tone={totals.needsDue ? 'warn' : ''} />
      </div>

      <div className="seed-toolbar">
        <input
          value={filters.search}
          onChange={event => setFilters({ ...filters, search: event.target.value })}
          placeholder="Search creator, product, notes..."
        />
        <select value={filters.month} onChange={event => setFilters({ ...filters, month: event.target.value })}>
          <option value="all">All months</option>
          {months.map(month => <option key={month} value={month}>{month === 'undated' ? 'Undated' : fmtMo(month)}</option>)}
        </select>
        <select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="needs_deliverable">Needs due date</option>
        </select>
      </div>

      {adding && canManage && (
        <form className="seed-add seed-card-panel" onSubmit={addRow}>
          <select value={form.creator_id} onChange={e => setForm({ ...form, creator_id: e.target.value })} required>
            <option value="">Creator...</option>
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={form.seeded_on} onChange={e => setForm({ ...form, seeded_on: e.target.value })} />
          <input className="wide" placeholder="Product seeded" value={form.product_label} onChange={e => setForm({ ...form, product_label: e.target.value })} />
          <select value={form.unit_type} onChange={e => setForm({ ...form, unit_type: e.target.value })} required>
            <option value="">Unit...</option>
            {units.map(u => <option key={u.unit_type} value={u.unit_type}>{u.unit_type} ({fmt$(u.cogs)})</option>)}
          </select>
          <input type="number" min="1" placeholder="Qty" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
          <select value={form.seeding_status} onChange={e => setForm({ ...form, seeding_status: e.target.value })}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Shipping" value={form.shipping_cost} onChange={e => setForm({ ...form, shipping_cost: e.target.value })} />
          <input type="number" step="0.01" placeholder="Creator fee" value={form.creator_fee} onChange={e => setForm({ ...form, creator_fee: e.target.value })} />
          <input type="number" min="0" placeholder="Deliverables" value={form.agreed_deliverables} onChange={e => setForm({ ...form, agreed_deliverables: e.target.value })} />
          <input type="date" value={form.deliverable_due} onChange={e => setForm({ ...form, deliverable_due: e.target.value })} />
          <input placeholder="Usage rights" value={form.usage_rights} onChange={e => setForm({ ...form, usage_rights: e.target.value })} />
          <input className="wide" placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div className="seed-add-actions">
            {form.unit_type && <span>Row COGS: {fmt$(catalogCost(form.unit_type) * (Number(form.quantity) || 1))}</span>}
            <button className="primary-action" disabled={busy}>{busy ? 'Saving...' : 'Save row'}</button>
          </div>
        </form>
      )}

      <div className="seed-grid">
        <section className="seed-section">
          <div className="seed-section-label">Monthly spend</div>
          <table className="seed-rollup">
            <thead>
              <tr><th>Month</th><th>Creators</th><th>Units</th><th>COGS</th><th>Shipping</th><th>Fees</th><th>Total</th></tr>
            </thead>
            <tbody>
              {data.rollup.map(r => (
                <tr key={r.month}>
                  <td>{fmtMo(r.month)}</td>
                  <td>{r.creators}</td>
                  <td>{r.units}</td>
                  <td>{fmt$(r.cogs)}</td>
                  <td>{fmt$(r.shipping)}</td>
                  <td>{fmt$(r.fees)}</td>
                  <td className="seed-total">{fmt$(r.total)}</td>
                </tr>
              ))}
              {!data.rollup.length && <tr><td colSpan={7} className="seed-empty-cell">No dated rows yet.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="seed-section">
          <div className="seed-section-label">Unit cost catalog</div>
          <div className="seed-catalog">
            {units.map(u => (
              <div className="seed-unit" key={u.unit_type}>
                <b>{u.unit_type}</b>
                {canManage ? (
                  <input type="number" step="0.01" defaultValue={u.cogs}
                    onBlur={e => { if (Number(e.target.value) !== u.cogs) saveUnit(u.unit_type, e.target.value); }} />
                ) : <span>{fmt$(u.cogs)}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="seed-section">
        <div className="seed-section-label">Ledger - {filteredRows.length} rows</div>
        <div className="seed-table-wrap">
          <table className="seed-table">
            <thead>
              <tr>
                <th>Status</th><th>Date</th><th>Creator</th><th>Product</th><th>Unit</th><th className="num">Qty</th>
                <th className="num">COGS</th><th className="num">Ship</th><th className="num">Fee</th><th className="num">Total</th>
                <th>Deliverables</th><th>Due</th><th>Usage</th><th>Notes</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const status = inferStatus(r);
                const isEditing = editingId === r.id;
                return isEditing ? (
                  <tr key={r.id} className="seed-edit-row">
                    <td colSpan={canManage ? 15 : 14}>
                      <form className="seed-edit-form" onSubmit={saveEdit}>
                        <select value={editForm.seeding_status} onChange={e => setEditForm({ ...editForm, seeding_status: e.target.value })}>
                          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <input type="date" value={editForm.seeded_on} onChange={e => setEditForm({ ...editForm, seeded_on: e.target.value })} />
                        <input placeholder="Product seeded" value={editForm.product_label} onChange={e => setEditForm({ ...editForm, product_label: e.target.value })} />
                        <select value={editForm.unit_type} onChange={e => setEditForm({ ...editForm, unit_type: e.target.value, unit_cogs: String(catalogCost(e.target.value)) })}>
                          {units.map(u => <option key={u.unit_type} value={u.unit_type}>{u.unit_type}</option>)}
                        </select>
                        <input type="number" min="1" value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} />
                        <input type="number" step="0.01" value={editForm.unit_cogs} onChange={e => setEditForm({ ...editForm, unit_cogs: e.target.value })} />
                        <input type="number" step="0.01" placeholder="Shipping" value={editForm.shipping_cost} onChange={e => setEditForm({ ...editForm, shipping_cost: e.target.value })} />
                        <input type="number" step="0.01" placeholder="Fee" value={editForm.creator_fee} onChange={e => setEditForm({ ...editForm, creator_fee: e.target.value })} />
                        <input type="number" min="0" placeholder="Deliverables" value={editForm.agreed_deliverables} onChange={e => setEditForm({ ...editForm, agreed_deliverables: e.target.value })} />
                        <input type="date" value={editForm.deliverable_due} onChange={e => setEditForm({ ...editForm, deliverable_due: e.target.value })} />
                        <input placeholder="Usage rights" value={editForm.usage_rights} onChange={e => setEditForm({ ...editForm, usage_rights: e.target.value })} />
                        <input className="wide" placeholder="Notes" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                        <div className="seed-edit-actions">
                          <button className="primary-action" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
                          <button type="button" onClick={() => { setEditingId(null); setEditForm(null); }}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td><span className={`seed-status ${status}`}>{labelForStatus(status)}</span></td>
                    <td>{r.seeded_on || '-'}</td>
                    <td className="seed-creator">{r.creator_name}</td>
                    <td>{r.product_label || '-'}</td>
                    <td>{r.unit_type ? <span className="seed-unit-pill">{r.unit_type}</span> : '-'}</td>
                    <td className="num">{r.quantity}</td>
                    <td className="num">{fmt$(r.cogs_total)}</td>
                    <td className="num">{r.shipping_cost ? fmt$(r.shipping_cost) : '-'}</td>
                    <td className="num">{r.creator_fee ? fmt$(r.creator_fee) : '-'}</td>
                    <td className="num seed-money">{fmt$(r.total_cost)}</td>
                    <td>{r.agreed_deliverables || '-'}</td>
                    <td className={r.agreed_deliverables && !r.deliverable_due ? 'seed-risk' : ''}>{r.deliverable_due || '-'}</td>
                    <td>{r.usage_rights || '-'}</td>
                    <td className="seed-note-cell">{r.notes || ''}</td>
                    {canManage && (
                      <td className="seed-row-actions">
                        <button type="button" onClick={() => { setEditingId(r.id); setEditForm(rowToForm(r)); }}>Edit</button>
                        <button className="seed-del" title="Remove" onClick={() => deleteRow(r.id)}>x</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!filteredRows.length && <tr><td colSpan={canManage ? 15 : 14} className="seed-empty-cell">No rows match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {fees?.intents?.length > 0 && (
        <section className="seed-section">
          <div className="seed-section-label">Creator fees to formalize ({openFeeIntents.length} open)</div>
          <div className="seed-fee-list">
            {fees.intents.map(intent => (
              <div className={`seed-fee${intent.converted ? ' done' : ''}`} key={intent.creator_name}>
                <div>
                  <span className="seed-fee-name">{intent.creator_name}</span>
                  <span className="seed-fee-note">{intent.note}</span>
                  {intent.suggested_creator_name && intent.suggested_creator_name.toLowerCase() !== intent.creator_name.toLowerCase() && (
                    <span className="seed-fee-match">{'-> '}{intent.suggested_creator_name}</span>
                  )}
                  {!intent.suggested_creator_id && <span className="seed-fee-match">{'-> '}will create creator</span>}
                </div>
                <div className="seed-fee-actions">
                  <span className="flow-tag">{intent.type === 'retainer' ? 'retainer /mo' : 'one-off'}</span>
                  <span className="seed-fee-amt">{intent.amount ? `$${intent.amount.toLocaleString()}` : 'TBD'}</span>
                  {intent.converted ? (
                    <span className="flow-tag flame">linked</span>
                  ) : canManage ? (
                    <button type="button" className="flow-btn primary" disabled={feeBusy === intent.creator_name} onClick={() => convertFee(intent)}>
                      {feeBusy === intent.creator_name ? 'Linking...' : 'Create engagement'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
