export function creatorRollups(groups) {
  const creators = new Map();
  for (const group of groups) {
    if (!group.creatorId || group.creatorConflict) continue;
    const key = String(group.creatorId);
    const item = creators.get(key) || { id: group.creatorId, name: group.creatorName || 'Creator', groups: [], spend: 0, purchaseValue: 0, purchases: 0 };
    item.groups.push(group);
    for (const metric of ['spend', 'purchaseValue', 'purchases']) item[metric] += Number(group[metric]) || 0;
    creators.set(key, item);
  }
  return [...creators.values()].map(item => ({ ...item, roas: item.spend ? item.purchaseValue / item.spend : null, cpa: item.purchases ? item.spend / item.purchases : null })).sort((a, b) => b.spend - a.spend);
}

export function buildIteration(group, { title, hypothesis, since, until }) {
  if (!group?.groupKey) throw new Error('Select a creative first.');
  if (!group.creatorId || group.creatorConflict) throw new Error('Connect this asset to a confirmed creator first.');
  if (!title?.trim() || !hypothesis?.trim()) throw new Error('Add a title and what you want to test.');
  return {
    title: title.trim(), stage: 'brief', creator_id: group.creatorId,
    source_winner_group_key: group.groupKey,
    format: group.assetKind === 'video' ? 'video' : 'static',
    objective: 'Test a creative iteration against its source',
    concept_json: {
      hypothesis: hypothesis.trim(), source_creative: group.name,
      source_group_key: group.groupKey,
      reporting_window: { since, until },
      observed_performance: { spend: group.spend, purchases: group.purchases, purchase_value: group.purchaseValue, roas: group.roas, cpa: group.cpa },
      // Observation snapshot, never an AI explanation of causal lift.
      evidence_note: 'Observed ad-attributed results in the recorded reporting window.',
    },
  };
}
