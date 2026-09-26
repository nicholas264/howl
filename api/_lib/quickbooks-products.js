import { provider, monthEnd } from './finance.js';

export async function readProductItems(connection, env, fetcher) {
 const items = [], seen = new Set();
 for (let start = 1; start <= 5001; start += 1000) {
  const query = `select * from Item where Active in (true,false) startposition ${start} maxresults 1000`;
  const response = await provider(`query?${new URLSearchParams({ query })}`, connection.access, connection.realm, env, fetcher);
  const page = response.QueryResponse?.Item;
  if (!response.QueryResponse || (page !== undefined && !Array.isArray(page))) throw new Error('QuickBooks returned an incomplete item catalog.');
  for (const item of page || []) {
   if (!/^\d{1,40}$/.test(item.Id) || typeof item.Name !== 'string' || seen.has(item.Id)) throw new Error('QuickBooks returned an invalid item catalog.');
   seen.add(item.Id);
   if (['Inventory', 'NonInventory', 'Service'].includes(item.Type)) items.push({ id: item.Id, name: item.Name, fullName: item.FullyQualifiedName || item.Name, sku: item.Sku || '', active: item.Active !== false });
  }
  if (!page || page.length < 1000) return items;
 }
 throw new Error('The QuickBooks item catalog is too large to import completely.');
}

const amount = cell => {
 const value = cell?.value;
 if (value === '') return 0;
 if (typeof value !== 'string' || !/^[-+]?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error('QuickBooks product report contains an invalid amount.');
 return Number(value);
};

// Column identity is verified before any value is attributed to a product.
// Company totals and unassigned columns never become product series.
export function parseProductProfitLoss(report, month, basis, currency, items, company) {
 const header = report?.Header, columns = report?.Columns?.Column;
 if (header?.ReportName !== 'ProfitAndLoss' || header.StartPeriod !== `${month}-01` || header.EndPeriod !== monthEnd(month) || header.ReportBasis !== basis || header.Currency !== currency || header.SummarizeColumnsBy !== 'ProductsAndServices' || !Array.isArray(columns) || columns[0]?.ColType !== 'Account') throw new Error('QuickBooks did not return the requested product-level P&L.');
 const empty = header.Option?.some(option => option.Name === 'NoReportData' && option.Value === 'true');
 const groups = new Map();
 function walk(rows) {
  for (const row of rows || []) {
   if (row.group) { if (groups.has(row.group)) throw new Error('Duplicate product report group.'); groups.set(row.group, row); }
   walk(row.Rows?.Row);
  }
 }
 walk(report.Rows?.Row);
 const get = (group, index) => {
  const row = groups.get(group);
  return row ? amount((row.Summary?.ColData || row.ColData)?.[index]) : 0;
 };
 const totalIndices = columns.flatMap((col, index) => (col.MetaData?.some(meta => meta.Name === 'ColKey' && meta.Value === 'total') || col.ColTitle?.toLowerCase() === 'total') ? [index] : []);
 if (totalIndices.length !== 1) {
  if (empty && !company.revenue && !company.cogs && columns.length === 1 && !report.Rows?.Row?.some(row => row.type === 'Data')) return { month, values: Object.fromEntries(items.map(item => [item.id, { revenue: 0, cogs: 0 }])) };
  throw new Error('QuickBooks product report is missing its reconciliation total.');
 }
 const totalIndex = totalIndices[0];
 if (Math.abs(get('Income', totalIndex) - company.revenue) > .05 || Math.abs(get('COGS', totalIndex) - company.cogs) > .05) throw new Error('Product report revenue or COGS did not reconcile to the company P&L. Sync again after accounting changes.');
 const values = {}, mapped = new Set();
 for (let index = 1; index < columns.length; index++) {
  if (index === totalIndex) continue;
  const col = columns[index], id = col.MetaData?.find(meta => meta.Name === 'ColKey')?.Value;
  const candidates = items.filter(item => item.id === id || item.fullName === col.ColTitle || item.name === col.ColTitle);
  const exact = items.find(item => item.id === id);
  const item = exact || (candidates.length === 1 ? candidates[0] : null);
  if (!item) continue;
  if (mapped.has(item.id)) throw new Error('QuickBooks returned duplicate product columns.');
  mapped.add(item.id);
  const revenue = get('Income', index), cogs = get('COGS', index);
  values[item.id] = { revenue, cogs: revenue !== 0 && cogs === 0 ? null : cogs };
 }
 // Omitted items have no activity in this complete, reconciled report.
 for (const item of items) if (!mapped.has(item.id)) values[item.id] = { revenue: 0, cogs: 0 };
 if (!mapped.size && (company.revenue || company.cogs)) throw new Error('QuickBooks product columns could not be matched to its item catalog.');
 return { month, values };
}

export async function syncProductMargins(connection, settings, months, env, fetcher) {
 const items = await readProductItems(connection, env, fetcher), reports = [];
 for (let i = 0; i < months.length; i += 3) {
  const results = await Promise.allSettled(months.slice(i, i + 3).map(async company => {
   const month = company.month;
   const q = new URLSearchParams({ start_date: `${month}-01`, end_date: monthEnd(month), accounting_method: settings.basis, summarize_column_by: 'ProductsAndServices' });
   return parseProductProfitLoss(await provider(`reports/ProfitAndLoss?${q}`, connection.access, connection.realm, env, fetcher), month, settings.basis, settings.currency, items, company);
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  reports.push(...results.map(result => result.value));
 }
 return { items, months: reports };
}
