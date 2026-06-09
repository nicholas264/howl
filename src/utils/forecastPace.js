function getMonthDays(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getPlanEquivalentDays(actualRevenue, monthlyTargets, year) {
  let remaining = actualRevenue;
  let equivalentDays = 0;

  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const monthTarget = monthlyTargets[monthIndex] || 0;
    const daysInMonth = getMonthDays(year, monthIndex);
    if (remaining <= monthTarget || monthIndex === 11) {
      const dailyTarget = monthTarget / daysInMonth;
      return equivalentDays + (dailyTarget > 0 ? remaining / dailyTarget : 0);
    }
    remaining -= monthTarget;
    equivalentDays += daysInMonth;
  }

  return equivalentDays;
}

export function getAnnualRevenuePace(actualRevenue, annualTarget, asOf = new Date(), monthlyCurve = null) {
  const target = Number(annualTarget) || 0;
  const actual = Number(actualRevenue) || 0;
  if (target <= 0) return null;

  const year = asOf.getFullYear();
  const startMs = Date.UTC(year, 0, 1);
  const todayMs = Date.UTC(year, asOf.getMonth(), asOf.getDate());
  const nextYearMs = Date.UTC(year + 1, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.floor((todayMs - startMs) / dayMs) + 1;
  const totalDays = Math.floor((nextYearMs - startMs) / dayMs);
  const curve = Array.isArray(monthlyCurve) && monthlyCurve.length === 12
    ? monthlyCurve.map(value => Math.max(Number(value) || 0, 0))
    : null;
  const curveTotal = curve?.reduce((sum, value) => sum + value, 0) || 0;
  const monthlyTargets = curveTotal > 0
    ? curve.map(value => value * (target / curveTotal))
    : Array.from({ length: 12 }, (_, monthIndex) => target * (getMonthDays(year, monthIndex) / totalDays));
  const currentMonth = asOf.getMonth();
  const completedTarget = monthlyTargets
    .slice(0, currentMonth)
    .reduce((sum, value) => sum + value, 0);
  const currentMonthTarget = monthlyTargets[currentMonth];
  const expectedRevenue = completedTarget
    + currentMonthTarget * (asOf.getDate() / getMonthDays(year, currentMonth));
  const revenueDays = getPlanEquivalentDays(actual, monthlyTargets, year);

  return {
    actualRevenue: actual,
    annualTarget: target,
    elapsedDays,
    totalDays,
    expectedRevenue,
    percentToPace: expectedRevenue > 0 ? actual / expectedRevenue : null,
    daysDelta: revenueDays - elapsedDays,
    usesSeasonalCurve: curveTotal > 0,
  };
}
