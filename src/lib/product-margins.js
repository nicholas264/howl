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

export function productMarginRows(periods, data, mapping = {}) {
 return periods.map(month => {
  const source = data?.months?.find(row => row.month === month);
  const row = { month, details: {} };
  for (const product of marginProducts) {
   const items = (data?.items || []).filter(item => productForItem(item, mapping) === product.key);
   const values = source && items.map(item => source.values[item.id]);
   // Missing COGS with recorded revenue cannot be assumed to mean zero cost.
   const available = values?.length > 0 && values.every(value => value && Number.isFinite(value.revenue) && Number.isFinite(value.cogs));
   const revenue = available ? values.reduce((sum, value) => sum + value.revenue, 0) : null;
   const cogs = available ? values.reduce((sum, value) => sum + value.cogs, 0) : null;
   const grossProfit = available ? revenue - cogs : null;
   row[product.key] = ratio(grossProfit, revenue);
   row.details[product.key] = { revenue, cogs, grossProfit, itemCount: items.length };
  }
  return row;
 });
}
