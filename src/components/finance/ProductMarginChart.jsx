import React from 'react';
import { marginProducts, productForItem, productMarginRows, suggestedProduct } from '../../lib/product-margins.js';
import { TrendChart } from './FinanceTrends.jsx';

const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const monthLabel = month => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function ProductMarginChart({ periods, snapshot, settings, draft, update, save, busy, money }) {
 const data = snapshot.productMargins;
 if (!data) return <section className="fin-runway"><h2>Gross margin by product</h2><p className="fin-trend-note">R1 · R3 · R4 · Bags</p><p role={snapshot.productMarginsError ? 'status' : undefined}>{snapshot.productMarginsError || 'Sync QuickBooks to import monthly product revenue and COGS.'}</p></section>;
 const rows = productMarginRows(periods, data, settings.productItemMapping);
 const unmapped = marginProducts.filter(product => !data.items.some(item => productForItem(item, settings.productItemMapping) === product.key));
 return <div className="fin-product-margins">
  <TrendChart title="Gross margin by product" note="Monthly QuickBooks item revenue less item COGS, divided by revenue. Bags combines the mapped bag items using total revenue and cost. Excludes selling expenses and overhead. Unassigned accounting entries are excluded. Missing costs and months with zero or negative revenue show as gaps." rows={rows} series={marginProducts} format={percent}/>
  {unmapped.length > 0 && <p className="fin-notice">Choose QuickBooks items below for: {unmapped.map(product => product.label).join(', ')}.</p>}
  <details className="fin-panel"><summary>Monthly product revenue and costs</summary><div className="fin-table-wrap"><table><thead><tr><th>Month</th><th>Product</th><th>Revenue</th><th>COGS</th><th>Gross profit</th><th>Gross margin</th></tr></thead><tbody>{rows.filter(row => data.months.some(month => month.month === row.month)).flatMap(row => marginProducts.map(product => { const detail = row.details[product.key]; return <tr key={`${row.month}-${product.key}`}><th>{monthLabel(row.month)}</th><th>{product.label}</th><td>{money(detail.revenue)}</td><td>{money(detail.cogs)}</td><td>{money(detail.grossProfit)}</td><td>{percent(row[product.key])}</td></tr>; }))}</tbody></table></div></details>
  <details className="fin-panel"><summary>Review product item mapping</summary><p>Finished-product names are matched automatically. Review the items included in each line, including discontinued items. Map bag items to Bags and leave parts, mounts, and other accessories excluded. Saving updates the graph from the imported item history.</p><fieldset disabled={busy}><div className="fin-table-wrap"><table><thead><tr><th>QuickBooks item</th><th>SKU</th><th>Product line</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><th>{item.fullName}{!item.active && <small> (inactive)</small>}</th><td>{item.sku || '—'}</td><td><select aria-label={`Product line for ${item.fullName}`} value={draft.productItemMapping?.[item.id] || ''} onChange={event => {const mapping = {...draft.productItemMapping};if(event.target.value)mapping[item.id]=event.target.value;else delete mapping[item.id];update({...draft,productItemMapping:mapping});}}><option value="">Automatic ({marginProducts.find(product => product.key === suggestedProduct(item))?.label || 'Excluded'})</option>{marginProducts.map(product => <option key={product.key} value={product.key}>{product.label}</option>)}<option value="exclude">Excluded</option></select></td></tr>)}</tbody></table></div><button onClick={save}>Save product mapping</button></fieldset></details>
 </div>;
}
