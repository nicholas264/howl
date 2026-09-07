export function reportMonths(report, anchor = report.as_of.slice(0, 7)) {
  const current = report.as_of.slice(0, 7);
  const recorded = [...report.monthly, ...report.budgets, ...report.performance]
    .map(r => r.month).filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m));
  const keys = [...recorded, current, anchor].sort();
  const first = keys[0], last = keys[keys.length - 1];
  const months = [];
  let [year, month] = first.split('-').map(Number);
  for (let key = first; key <= last; key = `${year}-${String(month).padStart(2, '0')}`) {
    months.push(key);
    if (++month > 12) { month = 1; year++; }
  }
  return months;
}
export function summarizeMonth(report, month) {
  const cost = report.monthly.find(r => r.month === month) || { seeding: 0, creator: 0, scheduled: 0 };
  const budget = report.budgets.find(r => r.month === month);
  const ads = report.performance.find(r => r.month === month);
  const investment = Number(cost.seeding) + Number(cost.creator);
  const spend = ads ? Number(ads.spend) : 0;
  const revenue = ads ? Number(ads.revenue) : 0;
  const denominator = spend + investment;
  return { ...cost, budget, ads, investment, spend, revenue,
    roas: ads && spend > 0 ? revenue / spend : null,
    roi: ads && denominator > 0 ? (revenue - denominator) / denominator * 100 : null };
}
