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
export const LABELS = { 'no-plan':'Plan needed', 'no-forecast':'Forecast needed', open:'Open', 'in-progress':'In progress', resolved:'Resolved', 'no-data':'No update', stale:'Update due', 'on-track':'On track', 'at-risk':'At risk', 'off-track':'Off track', planned:'Planned', blocked:'Blocked', done:'Done', overdue:'Overdue', 'not-started':'Not started' };
export function emptyWorkspace() { return { departments: [], cycles: [], objectives: [], metrics: [], initiatives: [], reviews: [], constraints: [], checkins: [] }; }
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
export function plannedValue(metric, asOf) {
  const checkpoints = (metric.plan || []).filter(p => p.date <= asOf);
  return checkpoints.length ? checkpoints.at(-1).value : null;
}
export function comparisonStatus(value, expected, direction, tolerance = 0) {
  if (value == null || expected == null) return null;
  const unfavorable = direction === 'increase' ? expected - value : value - expected;
  return unfavorable <= 0 ? 'on-track' : unfavorable <= tolerance ? 'at-risk' : 'off-track';
}
export function metricHealth(state, metric, today = dayString()) {
  const cycle = state.cycles.find(c => c.id === metric.cycleId);
  const asOf = cycle && today > cycle.end ? cycle.end : today;
  const latest = latestCheckin(state, 'metric', metric.id, asOf);
  const value = latest?.value ?? null;
  const forecast = latest?.forecast ?? null;
  const plannedNow = plannedValue(metric, asOf);
  const planned = plannedValue(metric, latest?.date || asOf);
  const tolerance = metric.tolerance || 0;
  const planStatus = comparisonStatus(value, planned, metric.direction, tolerance) || (planned === null ? 'no-plan' : 'no-data');
  const forecastStatus = comparisonStatus(forecast, metric.target, metric.direction, tolerance) || 'no-forecast';
  const stale = !!latest && daysBetween(latest.date, asOf) > metric.cadence;
  const completed = !!cycle && today >= cycle.end;
  const goalStatus = comparisonStatus(completed ? value : forecast, metric.target, metric.direction, tolerance) || (completed ? 'no-data' : 'no-forecast');
  let status;
  if (cycle && today < cycle.start) status = 'not-started';
  else if (!latest) status = 'no-data';
  else if (stale) status = 'stale';
  else if ([planStatus, goalStatus].includes('off-track')) status = 'off-track';
  else if ([planStatus, goalStatus].includes('at-risk')) status = 'at-risk';
  else if (completed || (planStatus === 'on-track' && goalStatus === 'on-track')) status = 'on-track';
  else status = planStatus === 'no-plan' ? 'no-plan' : 'no-forecast';
  return {status, value, progress: metricProgress(metric,value), latest, forecast, planned, plannedNow,
    variance:value === null || planned === null ? null : value-planned,
    forecastGap:forecast === null ? null : forecast-metric.target,
    planStatus, forecastStatus, goalStatus, stale};
}
export const CONSTRAINT_STATUSES = ['open','in-progress','blocked','resolved'];
export function constraintHealth(state, item, today = dayString()) {
  const cycle=state.cycles.find(c=>c.id===item.cycleId);
  const asOf=cycle&&today>cycle.end?cycle.end:today;
  const latest=latestCheckin(state,'constraint',item.id,asOf);
  const reportedStatus=latest?.status||'open';
  return {latest,reportedStatus,status:reportedStatus!=='resolved'&&item.dueDate<asOf?'overdue':reportedStatus};
}
export function constraintsForMetric(state, metric) {
  return (state.constraints||[]).filter(c=>!c.archived&&((c.metricIds||[]).includes(metric.id)||(metric.objectiveId&&(c.objectiveIds||[]).includes(metric.objectiveId))));
}
// Import only additive financial fields, never ratios. Month-end values are cumulative.
export const FORECAST_FIELDS = {dtcRevenue:'DTC revenue',retailRevenue:'Retail revenue',netRevenue:'Net revenue',totalRevenue:'Total revenue',grossProfit:'Gross profit',contributionProfit:'Contribution profit',ebitda:'EBITDA',units:'Units sold'};
export function forecastPlan(forecast, field, cycle) {
  if(!Object.hasOwn(FORECAST_FIELDS,field)||!cycle) throw new Error('Choose a forecast field and planning cycle.');
  if(cycle.start.slice(8)!=='01'||cycle.end!==new Date(Date.UTC(Number(cycle.end.slice(0,4)),Number(cycle.end.slice(5,7)),0)).toISOString().slice(0,10)) throw new Error('Monthly forecast import requires a cycle covering whole calendar months. Enter custom checkpoints for a partial month.');
  let month=cycle.start.slice(0,7), total=0;const plan=[];
  while(month<=cycle.end.slice(0,7)) {
    const rows=(forecast?.months||[]).filter(m=>m.month===month);
    const value=rows[0]?.[field];
    if(rows.length!==1||typeof value!=='number'||!Number.isFinite(value)) throw new Error(`Missing or ambiguous ${FORECAST_FIELDS[field]} for ${month}. Refresh the business forecast or enter the plan manually.`);
    total+=value;
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
    plan.push({date:end,value:total});
    month=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,7);
  }
  return {plan,target:total,unit:field==='units'?'units':'USD',baseline:0};
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
  const rows=[['Department','Metric','Type','Owner','Cycle','Baseline','Goal','Planned by reporting date','Actual','Variance (actual minus plan)','Forecast finish','Forecast gap (forecast minus goal)','Unit','Status','Pace','Goal outlook','Last update','Source','Definition']];
  for(const m of metrics) { const h=metricHealth(state,m,today); rows.push([state.departments.find(d=>d.id===m.departmentId)?.name,m.title,m.kind,m.owner,state.cycles.find(c=>c.id===m.cycleId)?.name,m.baseline,m.target,h.planned,h.value,h.variance,h.forecast,h.forecastGap,m.unit,LABELS[h.status],LABELS[h.planStatus],LABELS[h.goalStatus],h.latest?.date,m.source,m.description]); }
  return rows.map(r=>r.map(cell).join(',')).join('\r\n');
}

// Infer periods for existing plans without rewriting saved history.
export function cycleLevel(cycle) {
  if (cycle?.level) return cycle.level;
  if (!cycle) return '';
  const months = (Number(cycle.end.slice(0,4))-Number(cycle.start.slice(0,4)))*12 + Number(cycle.end.slice(5,7))-Number(cycle.start.slice(5,7))+1;
  return months <= 1 ? 'monthly' : months <= 3 ? 'quarterly' : 'annual';
}
export function ancestorCycleIds(state, id) {
  const ids = new Set();
  let cycle = state.cycles.find(c => c.id === id);
  while(cycle?.parentId && !ids.has(cycle.parentId)) {
    ids.add(cycle.parentId); cycle = state.cycles.find(c => c.id === cycle.parentId);
  }
  return ids;
}
export function measurementValue(metric, values) {
  if (!metric.measurement || metric.measurement === 'direct') return values.value;
  if (!Number.isFinite(values.numerator) || !Number.isFinite(values.denominator) || values.denominator <= 0) throw new Error('Enter a finite numerator and a denominator greater than zero.');
  return values.numerator / values.denominator * (metric.measurement === 'percentage' ? 100 : 1);
}

export function periodDates(level, reference = dayString()) {
  const [year, month] = reference.split('-').map(Number);
  const startMonth = level === 'annual' ? 1 : level === 'quarterly' ? Math.floor((month-1)/3)*3+1 : month;
  const duration = level === 'annual' ? 12 : level === 'quarterly' ? 3 : 1;
  return {start:`${year}-${String(startMonth).padStart(2,'0')}-01`,end:new Date(Date.UTC(year,startMonth-1+duration,0)).toISOString().slice(0,10)};
}
