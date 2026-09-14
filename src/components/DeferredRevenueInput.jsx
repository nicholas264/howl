import React, { useState } from 'react';

export default function DeferredRevenueInput({ settings, onSave, saving }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [drafts, setDrafts] = useState({});
  const [message, setMessage] = useState('');
  const value = drafts[month] ?? settings?.deferredRevenue2025ByMonth?.[month] ?? '';
  const inputStyle = { padding: '8px 10px', border: '1px solid #dedbd3', borderRadius: 4, font: 'inherit', width: 170 };
  async function submit(event) {
    event.preventDefault();
    setMessage('');
    const amount = value === '' ? 0 : Number(value);
    if (!month || !Number.isFinite(amount) || amount < 0) return setMessage('Enter a valid month and a non-negative amount.');
    const amounts = { ...settings?.deferredRevenue2025ByMonth };
    if (amount === 0) delete amounts[month];
    else amounts[month] = amount;
    try {
      await onSave({ ...settings, deferredRevenue2025ByMonth: amounts });
      setMessage('Saved. Revenue totals updated.');
    } catch (error) {
      setMessage(error.message || 'Could not save. Please try again.');
    }
  }
  return (
    <form onSubmit={submit} style={{ padding: 16, marginBottom: 16, border: '1px solid #dedbd3', borderRadius: 8, background: '#fff' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>2025 deferred revenue <span style={{ fontWeight: 400, color: '#77746f' }}>(optional)</span></div>
      <p style={{ fontSize: 12, color: '#77746f', margin: '0 0 12px' }}>Add revenue deferred from 2025 to the month it is recognized. Enter only amounts not already included in connected sales. Leave blank to remove an adjustment. All other data continues to sync through APIs.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Recognition month
          <input type="month" required value={month} disabled={saving} onChange={e => { setMonth(e.target.value); setMessage(''); }} style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Amount ($)
          <input type="number" min="0" step="0.01" placeholder="0.00" value={value} disabled={saving} onChange={e => { setDrafts(previous => ({ ...previous, [month]: e.target.value })); setMessage(''); }} style={inputStyle} />
        </label>
        <button type="submit" disabled={saving || !settings} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save deferred revenue'}</button>
      </div>
      {message && <div role="status" style={{ fontSize: 12, marginTop: 10 }}>{message}</div>}
    </form>
  );
}
