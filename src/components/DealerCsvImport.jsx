import { useState, useCallback } from 'react';
import Papa from 'papaparse';

const S = {
  card:    { background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: '20px 22px', marginBottom: 20 },
  label:   { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 8, display: 'block' },
  btn:     { padding: '8px 16px', background: '#DC440A', border: 'none', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  ghost:   { padding: '8px 16px', background: 'none', border: '1px solid #2a3441', color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer', borderRadius: 4 },
  err:     { padding: '8px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.1)', color: '#DC440A', fontSize: 10, borderRadius: 4, marginTop: 10 },
};

// Parse a Shopify orders export CSV → per-month aggregates.
// Each row in the export is a line item; orders span multiple rows. Order Name (e.g. "#1234")
// is repeated. Columns we care about: "Name", "Created at", "Total" (currency), "Shipping",
// "Subtotal", "Email", "Lineitem quantity", "Lineitem price".
function aggregateOrders(rows) {
  const seen = new Set(); // dedupe by Name (one Name = one order, multiple line item rows)
  const customerFirstSeen = {}; // email → earliest YYYY-MM
  const monthMap = {};

  // First pass: track earliest month per email so new vs returning is consistent.
  for (const r of rows) {
    const email = (r['Email'] || '').toLowerCase().trim();
    const created = r['Created at'] || r['Paid at'];
    if (!email || !created) continue;
    const d = new Date(created);
    if (isNaN(d)) continue;
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!customerFirstSeen[email] || mk < customerFirstSeen[email]) {
      customerFirstSeen[email] = mk;
    }
  }

  // Second pass: aggregate, dedup by Order Name.
  for (const r of rows) {
    const name = (r['Name'] || '').trim();
    const status = (r['Financial Status'] || '').toLowerCase();
    if (!name) continue;
    if (status && status !== 'paid' && status !== 'partially_refunded') continue;
    if (seen.has(name)) {
      // Still tally line items for COGS-like metrics later, but skip order-level math.
      continue;
    }
    seen.add(name);

    const created = r['Created at'] || r['Paid at'];
    if (!created) continue;
    const d = new Date(created);
    if (isNaN(d)) continue;
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const total = parseFloat(r['Total'] || r['Subtotal'] || 0) || 0;
    const shipping = parseFloat(r['Shipping'] || 0) || 0;
    const email = (r['Email'] || '').toLowerCase().trim();
    const isNew = email && customerFirstSeen[email] === mk;

    if (!monthMap[mk]) monthMap[mk] = {
      netSales: 0, orders: 0, shipping: 0,
      newCustomers: 0, returningCustomers: 0,
      newRevenue: 0, returningRevenue: 0,
      uncostedRevenue: 0, // dealer CSV has no unit cost — treat all as uncosted (GM% fallback applies)
    };

    monthMap[mk].netSales += total;
    monthMap[mk].orders += 1;
    monthMap[mk].shipping += shipping;
    monthMap[mk].uncostedRevenue += total;
    if (isNew) {
      monthMap[mk].newCustomers += 1;
      monthMap[mk].newRevenue += total;
    } else if (email) {
      monthMap[mk].returningCustomers += 1;
      monthMap[mk].returningRevenue += total;
    }
  }

  return Object.entries(monthMap)
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export default function DealerCsvImport({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // [{month, ...}]
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState('');

  const handleFile = useCallback((f) => {
    if (!f) return;
    setError(''); setSuccess(''); setParsed(null); setFile(f);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (!results.data || results.data.length === 0) {
            setError('CSV looks empty.');
            return;
          }
          const requiredCols = ['Name', 'Created at'];
          const missing = requiredCols.filter(c => !(c in (results.data[0] || {})));
          if (missing.length) {
            setError(`CSV missing required columns: ${missing.join(', ')}. Re-export from Shopify with the default order export.`);
            return;
          }
          const months = aggregateOrders(results.data);
          if (months.length === 0) {
            setError('No paid orders found in this file.');
            return;
          }
          setParsed(months);
        } catch (err) {
          setError(`Parse error: ${err.message}`);
        }
      },
      error: (err) => setError(`CSV error: ${err.message}`),
    });
  }, []);

  const handleUpload = useCallback(async () => {
    if (!parsed) return;
    setUploading(true); setError(''); setSuccess('');
    try {
      const snapshots = parsed.map(m => ({
        month: m.month,
        shopify_dealer: {
          netSales: m.netSales, orders: m.orders, shipping: m.shipping,
          newCustomers: m.newCustomers, returningCustomers: m.returningCustomers,
          newRevenue: m.newRevenue, returningRevenue: m.returningRevenue,
          uncostedRevenue: m.uncostedRevenue, costedRevenue: 0, cogs: 0,
        },
      }));
      const r = await fetch('/api/db/monthly-metrics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot', snapshots }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setSuccess(`Saved ${d.upserted} months of dealer data.`);
      setParsed(null); setFile(null);
      if (onUploaded) onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, [parsed, onUploaded]);

  const fmt$ = (n) => '$' + Math.round(n).toLocaleString();
  const fmtMo = (mk) => {
    const [y, m] = mk.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  return (
    <div style={S.card}>
      <span style={S.label}>Dealer Store CSV Import</span>
      <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 12, lineHeight: 1.5 }}>
        Export orders from <strong>{`{dealer-store} → Orders → Export`}</strong> as CSV (default columns, all orders or a date range).
        Drop the file below — we aggregate per month and add it to your dashboard totals.
        New vs returning is inferred from email + first-seen month within the upload.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ ...S.ghost, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
          {file ? file.name : 'Choose CSV file…'}
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
        </label>
        {parsed && (
          <button onClick={handleUpload} disabled={uploading} style={uploading ? S.ghost : S.btn}>
            {uploading ? 'Saving…' : `Save ${parsed.length} months`}
          </button>
        )}
      </div>

      {error && <div style={S.err}>{error}</div>}
      {success && <div style={{ ...S.err, color: '#3fb950', borderColor: 'rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.1)' }}>{success}</div>}

      {parsed && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1, marginBottom: 6 }}>Preview — {parsed.length} months parsed</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Month', 'Orders', 'Revenue', 'New', 'Ret'].map(h => (
                  <th key={h} style={{ fontSize: 8, letterSpacing: 1, color: '#6e7681', textAlign: h === 'Month' ? 'left' : 'right', padding: '4px 8px 6px 0', textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.map(m => (
                <tr key={m.month} style={{ borderTop: '1px solid #2a3441' }}>
                  <td style={{ padding: '4px 8px 4px 0', fontSize: 11, color: '#c9d1d9' }}>{fmtMo(m.month)}</td>
                  <td style={{ padding: '4px 8px 4px 0', fontSize: 11, color: '#c9d1d9', textAlign: 'right' }}>{m.orders}</td>
                  <td style={{ padding: '4px 8px 4px 0', fontSize: 11, color: '#f0f4f8', textAlign: 'right', fontWeight: 600 }}>{fmt$(m.netSales)}</td>
                  <td style={{ padding: '4px 8px 4px 0', fontSize: 11, color: '#DC440A', textAlign: 'right' }}>{m.newCustomers}</td>
                  <td style={{ padding: '4px 0', fontSize: 11, color: '#2ea98f', textAlign: 'right' }}>{m.returningCustomers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
