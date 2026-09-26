import { ratio } from './finance.js';

export const marginProducts = [
 { key: 'r1', label: 'R1', color: '#635bce' },
 { key: 'r3', label: 'R3', color: '#168477' },
 { key: 'r4', label: 'R4', color: '#bc743a' },
 { key: 'bags', label: 'Bags', color: '#347fa3' },
];

// Match whole finished-product names, never component/accessory substrings.
export function suggestedProduct(item) {
 const name = item.name.toLowerCase().replace(/[®™]/g, '').replace(/^howl\s+/, '').trim();
 if (/^(?:(?:r[134])\s+)?(?:haul\s?bag|carry\s?bag|bag)s?(?:\s+(?:r[134]))?$/.test(name)) return 'bags';
 const match = name.match(/^(r[134])(?:\s+(?:campfire|mk\s?ii|mkii|mk2))*$/);
 return match?.[1] || 'exclude';
}

export function productForItem(item, mapping = {}) {
 return Object.hasOwn(mapping, item.id) ? mapping[item.id] : suggestedProduct(item);
}

export function productCostAccount(product, accounts = [], mapping = {}) {
 const requested = mapping[product];
 if (requested === 'items') return null;
 if (requested) return accounts.find(account => account.group === 'COGS' && account.id === requested) || null;
 const candidates = accounts.filter(account => account.group === 'COGS' && new RegExp(`\\bCOGS\\s*-\\s*${product}$`, 'i').test(account.name));
 return candidates.length === 1 ? candidates[0] : null;
}

export function revenueAdjustmentProduct(account, mapping = {}) {
 if (Object.hasOwn(mapping,account.id)) return mapping[account.id];
 // R4 recognition was confirmed by the owner. Generic shared income accounts
 // require explicit assignment; never allocate the company revenue remainder.
 return /\br4(?:\s*mk\s*ii)?\b/i.test(account.name) ? 'r4' : 'exclude';
}

export function productMarginRows(periods, data, mapping = {}, accounts = [], costMapping = {}, revenueMapping = {}) {
 return periods.map(month => {
  const source = data?.months?.find(row => row.month === month);
  const row = { month, details: {} };
  for (const product of marginProducts) {
   const items = (data?.items || []).filter(item => productForItem(item, mapping) === product.key);
   const values = source && items.map(item => source.values[item.id]);
   // Missing COGS with recorded revenue cannot be assumed to mean zero cost.
   const available = values?.length > 0 && values.every(value => value && Number.isFinite(value.revenue));
   const itemRevenue = available ? values.reduce((sum, value) => sum + value.revenue, 0) : null;
   const recognitionReady = product.key !== 'r4' || Array.isArray(source?.revenueAdjustments);
   const recognizedRevenue = source && Array.isArray(source.revenueAdjustments) ? source.revenueAdjustments.filter(account=>revenueAdjustmentProduct(account,revenueMapping)===product.key).reduce((sum,account)=>sum+account.amount,0) : 0;
   const revenue = available && recognitionReady ? itemRevenue + recognizedRevenue : null;
   const dealerRevenue = available ? items.reduce((sum, item) => sum + (/DLR/i.test(`${item.sku || ''} ${item.name}`) ? source.values[item.id].revenue : 0), 0) : null;
   const account = productCostAccount(product.key, accounts, costMapping);
   const invalidAccount = costMapping[product.key] && costMapping[product.key] !== 'items' && !account;
   const cogs = !available || invalidAccount ? null : account ? (account.values[month] ?? 0) : values.every(value => Number.isFinite(value.cogs)) ? values.reduce((sum, value) => sum + value.cogs, 0) : null;
   const grossProfit = Number.isFinite(revenue) && Number.isFinite(cogs) ? revenue - cogs : null;
   row[product.key] = ratio(grossProfit, revenue);
   row.details[product.key] = { revenue, itemRevenue, recognizedRevenue: recognitionReady ? recognizedRevenue : null, dealerRevenue, dealerShare: ratio(dealerRevenue, itemRevenue), cogs, grossProfit, itemCount: items.length, costSource: account?.name || 'Item COGS' };
  }
  return row;
 });
}
