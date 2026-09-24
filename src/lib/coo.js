export const DEPARTMENTS = ['Manufacturing', 'Sales & Marketing', 'Sourcing & Parts'];
export const KPI_TEMPLATES = [
  { title: 'Production output', department: 'Manufacturing', unit: 'units', direction: 'increase', cadence: 7, description: 'Finished units released during the reporting period.' },
  { title: 'On-time production', department: 'Manufacturing', unit: '%', direction: 'increase', cadence: 7, description: 'Production orders completed on time / orders due × 100.' },
  { title: 'Defect rate', department: 'Manufacturing', unit: '%', direction: 'decrease', cadence: 7, description: 'Defective units / units inspected × 100.' },
  { title: 'Revenue', department: 'Sales & Marketing', unit: 'USD', direction: 'increase', cadence: 7, description: 'Net revenue for the reporting period, after discounts and returns.' },
  { title: 'Marketing efficiency ratio', department: 'Sales & Marketing', unit: 'ratio', direction: 'increase', cadence: 7, description: 'Net revenue / total marketing spend for the same reporting period.' },
  { title: 'Qualified sales pipeline', department: 'Sales & Marketing', unit: 'USD', direction: 'increase', cadence: 7, description: 'Value of open opportunities meeting your qualification criteria.' },
  { title: 'Supplier on-time delivery', department: 'Sourcing & Parts', unit: '%', direction: 'increase', cadence: 7, description: 'Purchase order lines received by the agreed date / lines due × 100.' },
  { title: 'Supplier lead time', department: 'Sourcing & Parts', unit: 'days', direction: 'decrease', cadence: 7, description: 'Average elapsed days from purchase order to receipt.' },
  { title: 'Part stockouts', department: 'Sourcing & Parts', unit: 'count', direction: 'decrease', cadence: 7, description: 'Count of parts with demand that cannot be supplied from available stock.' },
];
export const STATUSES = ['planned', 'on-track', 'at-risk', 'blocked', 'done'];
export const LABELS = { 'no-data':'No update', stale:'Update due', 'on-track':'On track', 'at-risk':'At risk', 'off-track':'Off track', planned:'Planned', blocked:'Blocked', done:'Done', overdue:'Overdue', 'not-started':'Not started' };
export function emptyWorkspace() { return { departments: [], cycles: [], objectives: [], metrics: [], initiatives: [], reviews: [], checkins: [] }; }
export function dayString(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export const daysBetween = (a,b) => (Date.parse(b)-Date.parse(a))/86400000;
export function latestCheckin(state, kind, id, today = dayString()) {
  return [...state.checkins].reverse().filter(c=>c.kind===kind && c.entityId===id && c.date<=today)
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))[0] || null;
}
export function metricProgress(metric, value) {
  if (value === null || value === undefined) return null;
  if(metric.kind==='kpi') return (metric.direction==='increase'?value>=metric.target:value<=metric.target)?1:0;
  const range = metric.target - metric.baseline;
  if (!range) return metric.direction === 'increase' ? (value >= metric.target ? 1 : 0) : (value <= metric.target ? 1 : 0);
  return Math.max(0, Math.min(1, (value-metric.baseline)/range));
}
export function metricHealth(state, metric, today = dayString()) {
  const cycle = state.cycles.find(c=>c.id===metric.cycleId);
  const asOf = cycle && today > cycle.end ? cycle.end : today;
  const latest = latestCheckin(state, 'metric', metric.id, asOf);
  const value = latest?.value ?? null;
  const progress = metricProgress(metric, value);
  if (cycle && today < cycle.start) return {status:'not-started',value,progress,latest};
  if (!latest) return {status:'no-data',value,progress,latest};
  // Ended cycles are assessed as of their end date, never against today's cadence.
  if (daysBetween(latest.date,asOf)>metric.cadence) return {status:'stale',value,progress,latest};
  if (metric.kind === 'kpi') {
    const meets = metric.direction === 'increase' ? value >= metric.target : value <= metric.target;
    return {status:meets?'on-track':'off-track',value,progress,latest};
  }
  const elapsed = cycle ? Math.max(0,Math.min(1,daysBetween(cycle.start,asOf)/Math.max(1,daysBetween(cycle.start,cycle.end)))) : 1;
  const status = cycle && asOf === cycle.end && progress < 1 ? 'off-track' : progress >= elapsed ? 'on-track' : progress >= elapsed * .8 ? 'at-risk' : 'off-track';
  return {status,value,progress,latest};
}
export function objectiveProgress(state, objective, today) {
  const metrics = state.metrics.filter(m=>(!m.archived||objective.archived) && m.kind==='kr' && m.objectiveId===objective.id);
  const results = metrics.map(m=>metricHealth(state,m,today));
  return {total:results.length, reported:results.filter(r=>r.value!==null).length, progress:results.length ? results.reduce((n,r)=>n+(r.progress??0),0)/results.length : null};
}
export function initiativeHealth(state, item, today = dayString()) {
  const cycle=state.cycles.find(c=>c.id===item.cycleId);
  const asOf=cycle && today>cycle.end?cycle.end:today;
  const latest = latestCheckin(state,'initiative',item.id,asOf);
  const status = latest?.status || 'planned';
  return {status: status !== 'done' && item.dueDate < asOf ? 'overdue' : status, reportedStatus:status, latest};
}
export function formatValue(value, unit='') {
  if (value === null || value === undefined) return '—';
  const n = new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value);
  if(unit==='USD') return `$${n}`;
  return unit==='%'?`${n}%`:`${n}${unit ? ` ${unit}` : ''}`;
}
export function scorecardCsv(state, metrics, today=dayString()) {
  const cell = value => { const s=String(value??''); return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"'; };
  const rows=[['Department','Metric','Type','Owner','Cycle','Baseline','Target','Current','Unit','Status','Last update','Source','Definition']];
  for(const m of metrics) { const h=metricHealth(state,m,today); rows.push([state.departments.find(d=>d.id===m.departmentId)?.name,m.title,m.kind,m.owner,state.cycles.find(c=>c.id===m.cycleId)?.name,m.baseline,m.target,h.value,m.unit,LABELS[h.status],h.latest?.date,m.source,m.description]); }
  return rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
