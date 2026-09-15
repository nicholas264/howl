export const CORE_UNIT_SKUS = new Set(['R1 Campfire', 'R3 Campfire', 'R4 Campfire']);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function modelSku(item, assumption, monthIndex, monthReturningRevenue, monthRevenue, monthPacing, metaSpend = null, shopifyUnits = null) {
  const forecastUnits = Number(item.units[monthIndex]) || 0;
  const override = assumption.unitOverride === '' ? null : Number(assumption.unitOverride);
  const plannedUnits = Math.max(0, override ?? forecastUnits * ((Number(assumption.unitMultiplier) || 0) / 100));
  const soldUnits = plannedUnits * (1 - (Number(assumption.returnRate) || 0) / 100);
  const realizedPrice = Math.max(0, Number(assumption.price) || 0) * (1 - (Number(assumption.discountPct) || 0) / 100);
  const revenue = soldUnits * realizedPrice;
  const returningPctOverride = assumption.returningRevenuePct === '' ? null : clamp(assumption.returningRevenuePct, 0, 75) / 100;
  const revenueShare = monthRevenue > 0 ? revenue / monthRevenue : 0;
  const returningRevenue = Math.min(revenue, returningPctOverride == null
    ? monthReturningRevenue * revenueShare
    : revenue * returningPctOverride);
  const newRevenue = Math.max(0, revenue - returningRevenue);
  const acquiredUnits = realizedPrice > 0 ? newRevenue / realizedPrice : 0;
  const cogs = revenue * ((Number(assumption.cogsPct) || 0) / 100);
  const variableCost = revenue * ((Number(assumption.variablePct) || 0) / 100);
  const fulfillment = soldUnits * (Number(assumption.fulfillment) || 0);
  const contributionBeforeMedia = revenue - cogs - variableCost - fulfillment;
  const targetContribution = revenue * (clamp(assumption.targetCmPct, 35, 80) / 100);
  const mediaBudget = Math.max(0, contributionBeforeMedia - targetContribution);
  const costCap = acquiredUnits > 0 ? mediaBudget / acquiredUnits : 0;
  const spendOverride = assumption.spendToDate === '' ? null : Math.max(0, Number(assumption.spendToDate) || 0);
  const spendToDate = spendOverride ?? Math.max(0, Number(metaSpend) || 0);
  const orderedUnits = Math.max(0, Number(shopifyUnits?.units || 0));
  const orderedRevenue = Math.max(0, Number(shopifyUnits?.revenue || 0));
  const unitTargetToDate = monthPacing.daysInMonth > 0
    ? plannedUnits * (monthPacing.elapsedDays / monthPacing.daysInMonth)
    : 0;
  const projectedUnits = monthPacing.elapsedDays > 0
    ? orderedUnits * (monthPacing.daysInMonth / monthPacing.elapsedDays)
    : orderedUnits;
  const unitGap = projectedUnits - plannedUnits;
  const unitPaceDelta = orderedUnits - unitTargetToDate;
  const dailyTarget = monthPacing.daysInMonth > 0 ? mediaBudget / monthPacing.daysInMonth : 0;
  const paceTargetToDate = dailyTarget * monthPacing.elapsedDays;
  const remainingSpend = Math.max(0, mediaBudget - spendToDate);
  const requiredDaily = monthPacing.remainingDays > 0 ? remainingSpend / monthPacing.remainingDays : 0;
  const paceDelta = spendToDate - paceTargetToDate;
  const paceRatio = paceTargetToDate > 0 ? spendToDate / paceTargetToDate : null;
  const postMediaContribution = revenue - cogs - variableCost - fulfillment - mediaBudget;
  const cmPct = revenue > 0 ? postMediaContribution / revenue : 0;

  return {
    sku: item.sku,
    hasSpendData: spendOverride != null || metaSpend != null,
    hasUnitData: shopifyUnits != null,
    forecastUnits,
    plannedUnits,
    acquiredUnits,
    returningUnits: Math.max(0, plannedUnits - acquiredUnits),
    revenue,
    newRevenue,
    returningRevenue,
    mediaBudget,
    metaSpend,
    spendOverride,
    orderedUnits,
    orderedRevenue,
    projectedUnits,
    unitTargetToDate,
    unitGap,
    unitPaceDelta,
    costCap,
    spendToDate,
    dailyTarget,
    paceTargetToDate,
    remainingSpend,
    requiredDaily,
    paceDelta,
    paceRatio,
    postMediaContribution,
    cmPct,
  };
}

export function applyMediaBudget(row, mediaBudget, spendToDate, monthPacing) {
  const dailyTarget = monthPacing.daysInMonth > 0 ? mediaBudget / monthPacing.daysInMonth : 0;
  const paceTargetToDate = dailyTarget * monthPacing.elapsedDays;
  const remainingSpend = Math.max(0, mediaBudget - spendToDate);
  const requiredDaily = monthPacing.remainingDays > 0 ? remainingSpend / monthPacing.remainingDays : 0;
  const paceDelta = spendToDate - paceTargetToDate;
  const paceRatio = paceTargetToDate > 0 ? spendToDate / paceTargetToDate : null;
  const postMediaContribution = row.postMediaContribution + row.mediaBudget - mediaBudget;

  return {
    ...row,
    mediaBudget,
    costCap: row.acquiredUnits > 0 ? mediaBudget / row.acquiredUnits : 0,
    spendToDate,
    dailyTarget,
    paceTargetToDate,
    remainingSpend,
    requiredDaily,
    paceDelta,
    paceRatio,
    postMediaContribution,
    cmPct: row.revenue > 0 ? postMediaContribution / row.revenue : 0,
  };
}

export function sumRows(rows) {
  return rows.reduce((acc, row) => ({
    plannedUnits: acc.plannedUnits + row.plannedUnits,
    acquiredUnits: acc.acquiredUnits + row.acquiredUnits,
    returningUnits: acc.returningUnits + row.returningUnits,
    revenue: acc.revenue + row.revenue,
    newRevenue: acc.newRevenue + row.newRevenue,
    returningRevenue: acc.returningRevenue + row.returningRevenue,
    mediaBudget: acc.mediaBudget + row.mediaBudget,
    spendToDate: acc.spendToDate + row.spendToDate,
    orderedUnits: acc.orderedUnits + row.orderedUnits,
    orderedRevenue: acc.orderedRevenue + row.orderedRevenue,
    projectedUnits: acc.projectedUnits + row.projectedUnits,
    unitTargetToDate: acc.unitTargetToDate + row.unitTargetToDate,
    paceTargetToDate: acc.paceTargetToDate + row.paceTargetToDate,
    remainingSpend: acc.remainingSpend + row.remainingSpend,
    postMediaContribution: acc.postMediaContribution + row.postMediaContribution,
  }), {
    plannedUnits: 0,
    acquiredUnits: 0,
    returningUnits: 0,
    revenue: 0,
    newRevenue: 0,
    returningRevenue: 0,
    mediaBudget: 0,
    spendToDate: 0,
    orderedUnits: 0,
    orderedRevenue: 0,
    projectedUnits: 0,
    unitTargetToDate: 0,
    paceTargetToDate: 0,
    remainingSpend: 0,
    postMediaContribution: 0,
  });
}


export function allocateCoreMedia(modeledRows, monthPacing) {
  // Accessories support the shared acquisition budget but have no paid target.
  const accessoryMediaBudget = modeledRows.reduce(
    (sum, row) => sum + (CORE_UNIT_SKUS.has(row.sku) ? 0 : row.mediaBudget),
    0,
  );
  const coreMediaBudget = modeledRows.reduce(
    (sum, row) => sum + (CORE_UNIT_SKUS.has(row.sku) ? row.mediaBudget : 0),
    0,
  );
  const coreAcquiredUnits = modeledRows.reduce(
    (sum, row) => sum + (CORE_UNIT_SKUS.has(row.sku) ? row.acquiredUnits : 0),
    0,
  );
  const corePlannedUnits = modeledRows.reduce(
    (sum, row) => sum + (CORE_UNIT_SKUS.has(row.sku) ? row.plannedUnits : 0),
    0,
  );
  const paidMediaRows = modeledRows.map(row => {
    if (!CORE_UNIT_SKUS.has(row.sku)) {
      return applyMediaBudget(row, 0, row.spendToDate, monthPacing);
    }
    const allocationWeight = coreMediaBudget > 0
      ? row.mediaBudget / coreMediaBudget
      : coreAcquiredUnits > 0
        ? row.acquiredUnits / coreAcquiredUnits
        : corePlannedUnits > 0
          ? row.plannedUnits / corePlannedUnits
          : 0;
    return applyMediaBudget(
      row,
      row.mediaBudget + accessoryMediaBudget * allocationWeight,
      row.spendToDate,
      monthPacing,
    );
  });
  const coreOrderedUnits = modeledRows.reduce(
    (sum, row) => sum + (CORE_UNIT_SKUS.has(row.sku) ? row.orderedUnits : 0),
    0,
  );
  return paidMediaRows.map(row => ({
    ...row,
    isCoreProduct: CORE_UNIT_SKUS.has(row.sku),
    coreOrderedUnits,
    productMix: CORE_UNIT_SKUS.has(row.sku) && coreOrderedUnits > 0 ? row.orderedUnits / coreOrderedUnits : null,
  }));
}

export function coreCostCap(rows) {
  const core = rows.filter(row => CORE_UNIT_SKUS.has(row.sku));
  const units = core.reduce((sum, row) => sum + row.acquiredUnits, 0);
  return units > 0 ? core.reduce((sum, row) => sum + row.mediaBudget, 0) / units : 0;
}
