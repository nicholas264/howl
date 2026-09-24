import { randomUUID } from 'node:crypto';
import { emptyWorkspace, DEPARTMENTS, STATUSES, dayString, metricHealth } from '../../src/lib/coo.js';
export async function ensureCooWorkspace(sql) {
  await sql`CREATE TABLE IF NOT EXISTS coo_workspace (id TEXT PRIMARY KEY, data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL)`;
}
const fail = message => { throw new Error(message); };
function text(value,label,max=200,required=true) {
  if(typeof value !== 'string' || value.length>max || (required&&!value.trim())) fail(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
function date(value,label) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value) fail(`Enter a valid ${label}.`); return value; }
function num(value,label) { if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12) fail(`Enter a finite ${label} between -1 trillion and 1 trillion.`);return value; }
function ref(state,collection,id,label,optional=false) { if(optional&&!id) return ''; if(!state[collection].some(x=>x.id===id&&!x.archived)) fail(`Select an active ${label}.`);return id; }
export function applyCooCommand(current, command, actor, now = new Date()) {
  const state={...emptyWorkspace(),...structuredClone(current || {})};
  if(!command || typeof command!=='object') fail('A command is required.');
  const {action,kind}=command;
  const timestamp=now.toISOString();
  if(action==='setup') {
    if(state.departments.length||state.cycles.length) fail('The workspace is already set up.');
    state.departments=DEPARTMENTS.map(name=>({id:randomUUID(),name,owner:'',description:'',archived:false,version:1,updatedAt:timestamp,updatedBy:actor}));
    return state;
  }
  const collections={department:'departments',cycle:'cycles',objective:'objectives',metric:'metrics',initiative:'initiatives',review:'reviews'};
  const collection=Object.hasOwn(collections,kind)?collections[kind]:null;
  if(!collection) fail('Unknown record type.');
  const existing=state[collection].find(x=>x.id===command.id);
  if(existing&&['save','archive'].includes(action)&&command.expectedVersion!==(existing.version||1)) fail('This record changed while your form was open. Copy any draft text you need, then close the form and reopen the latest record before editing.');
  if(action==='checkin') {
    if(!['metric','initiative'].includes(kind)||!existing||existing.archived) fail('Select an active metric or initiative.');
    const b=command.values||{};
    const checkDate=date(b.date,'reporting date');
    if(checkDate>dayString(now)) fail('Check-ins cannot be future dated.');
    const cycle=state.cycles.find(c=>c.id===existing.cycleId);
    if(!cycle || cycle.archived || checkDate<cycle.start||checkDate>cycle.end) fail('The check-in date must fall within an active planning cycle.');
    const checkin={id:randomUUID(),kind,entityId:existing.id,date:checkDate,note:text(b.note??'','Context',5000,false),blocker:text(b.blocker??'','Blocker',2000,false),nextStep:text(b.nextStep??'','Next step',2000,false),createdAt:timestamp,createdBy:actor};
    if(kind==='metric') { checkin.value=num(b.value,'actual value');checkin.target=existing.target;checkin.baseline=existing.baseline; }
    else { if(!STATUSES.includes(b.status)) fail('Select a valid initiative status.');checkin.status=b.status; }
    if(state.checkins.length>=20000) fail('Check-in capacity reached. Contact an administrator to extend storage.');
    state.checkins.push(checkin);return state;
  }
  if(action==='archive') {
    if(!existing || existing.archived) fail('Record not found.');
    const referenced = kind==='department' ? [...state.objectives,...state.metrics,...state.initiatives].some(x=>!x.archived&&x.departmentId===existing.id)
      : kind==='cycle' ? [...state.objectives,...state.metrics,...state.initiatives].some(x=>!x.archived&&x.cycleId===existing.id) || state.cycles.some(x=>!x.archived&&x.parentId===existing.id)
      : kind==='objective' ? [...state.metrics,...state.initiatives].some(x=>!x.archived&&x.objectiveId===existing.id) || state.objectives.some(x=>!x.archived&&x.parentId===existing.id)
      : kind==='review' ? state.initiatives.some(x=>!x.archived&&x.reviewId===existing.id)
      : kind==='initiative' ? state.initiatives.some(x=>!x.archived&&(x.dependencyId===existing.id||x.parentInitiativeId===existing.id)) : false;
    if(referenced) fail('Archive or reassign linked records first.');
    existing.archived=true;existing.version=(existing.version||1)+1;existing.updatedAt=timestamp;existing.updatedBy=actor;return state;
  }
  if(action!=='save') fail('Unknown action.');
  if(command.id&&!existing) fail('Record not found.');
  if(existing?.archived) fail('Archived records cannot be edited.');
  if(!existing&&state[collection].length>=2000) fail('Record capacity reached.');
  const b=command.values||{};
  const item={id:existing?.id||randomUUID(),archived:false,version:(existing?.version||0)+1,updatedAt:timestamp,updatedBy:actor};
  item.owner=text(b.owner??'','Owner',150, !['department','cycle'].includes(kind));
  item.description=text(b.description??'','Description',5000,false);
  if(['department','cycle'].includes(kind)) item.name=text(b.name,'Name',150);
  else item.title=text(b.title,'Title');
  if(kind==='department'&&state.departments.some(d=>!d.archived&&d.id!==item.id&&d.name.toLowerCase()===item.name.toLowerCase())) fail('A department with this name already exists.');
  if(kind==='cycle') {
    item.start=date(b.start,'start date');item.end=date(b.end,'end date');if(item.end<=item.start) fail('The cycle must end after it starts.');
    item.parentId=ref(state,'cycles',b.parentId,'annual cycle',true);
    if(item.parentId) {const parent=state.cycles.find(c=>c.id===item.parentId);if(parent.id===item.id||parent.parentId||item.start<parent.start||item.end>parent.end) fail('A quarterly cycle must fall inside its annual cycle.');}
  }
  if(['objective','metric','initiative','review'].includes(kind)) {
    item.departmentId=ref(state,'departments',b.departmentId,'department',['objective','review'].includes(kind));
    item.cycleId=ref(state,'cycles',b.cycleId,'planning cycle');
  }
  if(kind==='objective') {
    item.parentId=ref(state,'objectives',b.parentId,'company objective',true);
    if(item.parentId) { const parent=state.objectives.find(o=>o.id===item.parentId);if(parent.departmentId||parent.parentId||(parent.cycleId!==item.cycleId&&parent.cycleId!==state.cycles.find(c=>c.id===item.cycleId)?.parentId)||parent.id===item.id) fail('Align to a company objective in this cycle or its annual cycle.'); }
  }
  if(kind==='metric'||kind==='initiative') {
    item.objectiveId=ref(state,'objectives',b.objectiveId,'objective',true);
    const objective=state.objectives.find(o=>o.id===item.objectiveId);
    if(objective&&(objective.cycleId!==item.cycleId||(objective.departmentId&&objective.departmentId!==item.departmentId))) fail('Choose an objective in this cycle and department, or a company objective.');
  }
  if(kind==='metric') {
    if(!['kpi','kr'].includes(b.kind)) fail('Select KPI or key result.');
    item.kind=b.kind;
    if(item.kind==='kr'&&!item.objectiveId) fail('Key results must link to an objective.');
    if(!['increase','decrease'].includes(b.direction)) fail('Select a target direction.');
    item.direction=b.direction;item.baseline=num(b.baseline,'baseline');item.target=num(b.target,'target');
    if(item.kind==='kr'&&((item.direction==='increase'&&item.target<item.baseline)||(item.direction==='decrease'&&item.target>item.baseline))) fail('The baseline and target must match the selected direction.');
    if(item.kind==='kr'&&item.target===item.baseline) fail('A key result must improve on its baseline.');
    item.unit=text(b.unit??'','Unit',30,false);item.source=text(b.source??'','Source',500,false);
    if(!Number.isInteger(b.cadence)||b.cadence<1||b.cadence>366) fail('Update cadence must be 1–366 days.');item.cadence=b.cadence;
  }
  if(kind==='review') {
    if(existing) fail('Reviews preserve a point-in-time record. Create a new review to add corrections.');
    item.date=date(b.date,'review date');
    const cycle=state.cycles.find(c=>c.id===item.cycleId);
    if(item.date>dayString(now)||item.date<cycle.start||item.date>cycle.end) fail('Review date must fall within this cycle and cannot be in the future.');
    item.decisions=text(b.decisions??'','Decisions',5000,false);
    item.lessons=text(b.lessons??'','Lessons for the next cycle',5000,false);
    item.snapshot=state.metrics.filter(m=>!m.archived&&m.cycleId===item.cycleId&&(!item.departmentId||m.departmentId===item.departmentId)).map(m=>({id:m.id,title:m.title,owner:m.owner,unit:m.unit,target:m.target,...metricHealth(state,m,item.date)}));
  }
  if(kind==='initiative') {
    item.type=['initiative','milestone','action'].includes(b.type)?b.type:'initiative';
    item.parentInitiativeId=ref(state,'initiatives',b.parentInitiativeId,'parent initiative',true);
    item.reviewId=ref(state,'reviews',b.reviewId,'review',true);
    if(item.type==='milestone'&&!item.parentInitiativeId) fail('Select the initiative for this milestone.');
    if(item.parentInitiativeId) {const parent=state.initiatives.find(i=>i.id===item.parentInitiativeId);if(parent.id===item.id||parent.parentInitiativeId||parent.cycleId!==item.cycleId) fail('Select a top-level initiative in this cycle.');}
    if(item.reviewId&&state.reviews.find(r=>r.id===item.reviewId)?.cycleId!==item.cycleId) fail('Follow-up actions must belong to the review cycle.');
    item.dueDate=date(b.dueDate,'due date');item.dependencyId=ref(state,'initiatives',b.dependencyId,'dependency',true);
    const cycle=state.cycles.find(c=>c.id===item.cycleId);
    if(item.dueDate<cycle.start||item.dueDate>cycle.end) fail('The due date must fall inside the planning cycle.');
    const visited=new Set([item.id]);let dependency=item.dependencyId;
    while(dependency) {if(visited.has(dependency)) fail('Dependencies cannot form a loop.');visited.add(dependency);const dep=state.initiatives.find(i=>i.id===dependency);if(dep?.cycleId!==item.cycleId) fail('Dependencies must be in the same cycle.');dependency=dep?.dependencyId;}
  }
  // Keep historical measurements and relationships meaningful when editing parents.
  if(existing) {
    if(['metric','initiative'].includes(kind)&&state.checkins.some(c=>c.entityId===existing.id)&&['cycleId','departmentId','kind','unit','direction','baseline','target'].some(k=>existing[k]!==item[k])) fail('Records with check-ins retain their measurement definition. Create a new record for a changed target, unit, baseline, or cycle.');
    const children=[...state.objectives,...state.metrics,...state.initiatives].filter(x=>!x.archived&&(x.parentId===item.id||x.objectiveId===item.id));
    if(kind==='objective'&&children.some(x=>(x.cycleId!==item.cycleId&&!(x.parentId===item.id&&state.cycles.find(c=>c.id===x.cycleId)?.parentId===item.cycleId))||(item.departmentId&&x.departmentId!==item.departmentId)||(x.parentId===item.id&&item.departmentId))) fail('Reassign linked records before changing the objective scope.');
    if(kind==='cycle') {
      if(state.cycles.some(c=>!c.archived&&c.parentId===item.id&&(c.start<item.start||c.end>item.end||item.parentId))) fail('Annual dates must contain linked quarterly cycles.');
      if(item.parentId!==existing.parentId&&state.objectives.some(o=>o.cycleId===item.id&&o.parentId&&state.objectives.find(p=>p.id===o.parentId)?.cycleId!==item.id)) fail('Reassign linked annual objectives before changing the parent cycle.');
      const entityIds=new Set([...state.metrics,...state.initiatives].filter(x=>x.cycleId===item.id).map(x=>x.id));
      if(state.checkins.some(c=>entityIds.has(c.entityId)&&(c.date<item.start||c.date>item.end))||state.initiatives.some(i=>!i.archived&&i.cycleId===item.id&&(i.dueDate<item.start||i.dueDate>item.end))||state.reviews.some(r=>r.cycleId===item.id&&(r.date<item.start||r.date>item.end))) fail('Cycle dates must contain existing check-ins and initiative due dates.');
    }
    if(kind==='initiative'&&state.initiatives.some(i=>!i.archived&&(i.dependencyId===item.id||i.parentInitiativeId===item.id)&&(i.cycleId!==item.cycleId||(i.parentInitiativeId===item.id&&item.parentInitiativeId)))) fail('Reassign dependent initiatives before changing the cycle.');
    state[collection]=state[collection].map(x=>x.id===item.id?item:x);
  } else state[collection].push(item);
  return state;
}
