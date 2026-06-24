import { useCallback, useEffect, useMemo, useState } from 'react';

const fmt$ = n => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
const fmtMo = m => {
  if (!m) return 'Undated';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const EMPTY_ADD = { creator_id: '', seeded_on: '', product_label: '', unit_type: '', quantity: '1', shipping_cost: '', creator_fee: '' };

export default function SeedingLedger({ canManage = false }) {
  const [data, setData] = useState(null);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_ADD);
  const [busy, setBusy] = useState(false);
  const [fees, setFees] = useState(null);
  const [feeBusy, setFeeBusy] = useState(null);

  const loadFees = useCallback(async () => {
    try {
      const res = await fetch('/api/creator-fees');
      if (res.ok) setFees(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: intent.suggested_creator_id, creator_name: intent.creator_name,
          amount: intent.amount, type: intent.type, note: intent.note,
        }),
      });
      await loadFees();
    } finally {
      setFeeBusy(null);
    }
  }

  const totals = useMemo(() => {
    if (!data?.rollup) return null;
    return data.rollup.reduce((a, r) => ({
      units: a.units + r.units, cogs: a.cogs + r.cogs, shipping: a.shipping + r.shipping,
      fees: a.fees + r.fees, total: a.total + r.total,
    }), { units: 0, cogs: 0, shipping: 0, fees: 0, total: 0 });
  }, [data]);

  const catalogCost = ut => data?.units?.find(u => u.unit_type === ut)?.cogs || 0;

  async function saveUnit(unit_type, cogs) {
    await fetch('/api/creator-seeding-log', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
      setForm(EMPTY_ADD); setAdding(false); load();
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

  if (loading && !data) return <div className="forge"><div className="forge-empty">Loading seeding ledger…</div></div>;
  if (error && !data) return <div className="forge"><div className="forge-empty">{error}</div></div>;

  const rows = data?.rows || [];

  return (
    <div className="forge seed-page">
      <div className="forge-head">
        <div>
          <div className="forge-eyebrow">Product Seeding</div>
          <h1>Seeding Ledger</h1>
          <p className="forge-sub">
            Every unit shipped to a creator, with cost of goods, shipping, and fees. Replaces the UGC Seeding
            Tracker spreadsheet. Unit COGS comes from the catalog below.
          </p>
        </div>
        {canManage && (
          <button type="button" className="primary-action" onClick={() => setAdding(v => !v)}>
            {adding ? 'Close' : 'Add seeding'}
          </button>
        )}
      </div>

      {/* monthly rollup */}
      <div className="seed-section">
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
            {!data.rollup.length && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>No dated rows yet.</td></tr>}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                <td>Total</td><td>—</td><td>{totals.units}</td>
                <td>{fmt$(totals.cogs)}</td><td>{fmt$(totals.shipping)}</td><td>{fmt$(totals.fees)}</td>
                <td className="seed-total">{fmt$(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* unit cost catalog */}
      <div className="seed-section">
        <div className="seed-section-label">Unit cost catalog (COGS)</div>
        <div className="seed-catalog">
          {data.units.map(u => (
            <div className="seed-unit" key={u.unit_type}>
              <b>{u.unit_type}</b>
              {canManage ? (
                <input type="number" step="0.01" defaultValue={u.cogs}
                  onBlur={e => { if (Number(e.target.value) !== u.cogs) saveUnit(u.unit_type, e.target.value); }} />
              ) : <span>{fmt$(u.cogs)}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* add row */}
      {adding && canManage && (
        <form className="seed-add" onSubmit={addRow}>
          <select value={form.creator_id} onChange={e => setForm({ ...form, creator_id: e.target.value })} required>
            <option value="">Creator…</option>
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={form.seeded_on} onChange={e => setForm({ ...form, seeded_on: e.target.value })} />
          <input className="wide" placeholder="Product seeded" value={form.product_label} onChange={e => setForm({ ...form, product_label: e.target.value })} />
          <select value={form.unit_type} onChange={e => setForm({ ...form, unit_type: e.target.value })} required>
            <option value="">Unit…</option>
            {data.units.map(u => <option key={u.unit_type} value={u.unit_type}>{u.unit_type} ({fmt$(u.cogs)})</option>)}
          </select>
          <input type="number" min="1" placeholder="Qty" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
          <input type="number" step="0.01" placeholder="Shipping" value={form.shipping_cost} onChange={e => setForm({ ...form, shipping_cost: e.target.value })} />
          <input type="number" step="0.01" placeholder="Creator fee" value={form.creator_fee} onChange={e => setForm({ ...form, creator_fee: e.target.value })} />
          <div className="seed-add-actions">
            {form.unit_type && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Row COGS: {fmt$(catalogCost(form.unit_type) * (Number(form.quantity) || 1))}</span>}
            <button className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save row'}</button>
          </div>
        </form>
      )}

      {/* ledger table */}
      <div className="seed-section">
        <div className="seed-section-label">Ledger · {rows.length} rows</div>
        <div className="seed-table-wrap">
          <table className="seed-table">
            <thead>
              <tr>
                <th>Date</th><th>Creator</th><th>Product</th><th>Unit</th><th className="num">Qty</th>
                <th className="num">COGS</th><th className="num">Ship</th><th className="num">Fee</th>
                <th className="num">Total</th><th>Notes</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.seeded_on || '—'}</td>
                  <td className="seed-creator">{r.creator_name}</td>
                  <td>{r.product_label || '—'}</td>
                  <td>{r.unit_type ? <span className="seed-unit-pill">{r.unit_type}</span> : '—'}</td>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{fmt$(r.cogs_total)}</td>
                  <td className="num">{r.shipping_cost ? fmt$(r.shipping_cost) : '—'}</td>
                  <td className="num">{r.creator_fee ? fmt$(r.creator_fee) : '—'}</td>
                  <td className="num seed-money">{fmt$(r.total_cost)}</td>
                  <td style={{ color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.notes || ''}</td>
                  {canManage && <td><button className="seed-del" title="Remove" onClick={() => deleteRow(r.id)}>×</button></td>}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={canManage ? 11 : 10} style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>No seeding rows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* creator fees to formalize -> engagements */}
      {fees?.intents?.length > 0 && (
        <div className="seed-section">
          <div className="seed-section-label">
            Creator fees to formalize ({fees.intents.filter(i => !i.converted).length} open)
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.5, maxWidth: 760 }}>
            Fee and retainer notes from the bottom of the spreadsheet. Converting one creates a structured engagement
            on that creator so the fee + commitment flow into the Pipeline funnel. Retainers count monthly; one-offs
            count as committed deliverables.
          </p>
          <div className="seed-fee-list">
            {fees.intents.map(intent => (
              <div className={`seed-fee${intent.converted ? ' done' : ''}`} key={intent.creator_name}>
                <div>
                  <span className="seed-fee-name">{intent.creator_name}</span>
                  <span className="seed-fee-note">{intent.note}</span>
                  {intent.suggested_creator_name && intent.suggested_creator_name.toLowerCase() !== intent.creator_name.toLowerCase() && (
                    <span className="seed-fee-match">→ {intent.suggested_creator_name}</span>
                  )}
                  {!intent.suggested_creator_id && <span className="seed-fee-match">→ will create creator</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="flow-tag">{intent.type === 'retainer' ? 'retainer /mo' : 'one-off'}</span>
                  <span className="seed-fee-amt">{intent.amount ? `$${intent.amount.toLocaleString()}` : 'TBD'}</span>
                  {intent.converted ? (
                    <span className="flow-tag flame">linked</span>
                  ) : canManage ? (
                    <button type="button" className="flow-btn primary" disabled={feeBusy === intent.creator_name} onClick={() => convertFee(intent)}>
                      {feeBusy === intent.creator_name ? 'Linking…' : 'Create engagement'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
