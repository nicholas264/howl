import { suppliedRoster } from './organization-roster.js';
import { randomUUID } from 'node:crypto';
import { descendants } from '../../src/lib/organization.js';
export async function ensureOrganization(sql) {
  await sql`CREATE TABLE IF NOT EXISTS organization_workspace (id TEXT PRIMARY KEY, data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT NOT NULL)`;
}
const fail=message=>{throw new Error(message);};
function text(value,label,max=200,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`${label} ${required?'is required and ':''}must be at most ${max} characters.`);return value.trim();}
function date(value,label){if(!value)return '';if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(`Enter a valid ${label}.`);return value;}
export function normalizeOrganizationTags(value=[]) {
  if(!Array.isArray(value)||value.length>20)fail('Use at most 20 tags per person.');
  const unique=new Map();
  for(const raw of value){const tag=text(raw,'Tag',50);if(tag&&!unique.has(tag.toLowerCase()))unique.set(tag.toLowerCase(),tag);}
  return [...unique.values()];
}
export function applyOrganizationCommand(current,command,actor,now=new Date()) {
  let state=structuredClone(current||{people:[],history:[]});
  if(command?.action==='import-roster'){
    if(state.people.length)fail('The supplied roster can only be added to an empty directory.');
    for(const values of suppliedRoster)state=applyOrganizationCommand(state,{action:'save',values},actor,now);
    return state;
  }
  if(command?.action==='assign-manager'){
    const member=state.people.find(p=>p.id===command.id&&!p.archived);
    if(!member)fail('Choose an active team member.');
    return applyOrganizationCommand(state,{...command,action:'save',values:{...member,managerId:command.managerId}},actor,now);
  }
  if(!command||!['save','archive','restore'].includes(command.action))fail('Unknown organization command.');
  const existing=state.people.find(p=>p.id===command.id);
  if(command.id&&!existing)fail('Person no longer exists. Refresh the directory.');
  if(existing&&command.expectedVersion!==existing.version)fail('This profile changed. Refresh and reopen it before saving.');
  const timestamp=now.toISOString();let person;
  if(command.action==='save'){
    if(existing?.archived)fail('Restore this profile before editing.');
    const b=command.values||{};
    person={tags:normalizeOrganizationTags(b.tags??existing?.tags??[]),id:existing?.id||randomUUID(),name:text(b.name,'Name',200,true),title:text(b.title,'Role / title',200,true),department:text(b.department??'','Department'),managerId:text(b.managerId??'','Manager'),responsibilities:text(b.responsibilities??'','Responsibilities',10000),email:text(b.email??'','Work email',254),location:text(b.location??'','Location'),employmentType:text(b.employmentType??'','Employment type',50),startDate:date(b.startDate,'start date'),endDate:date(b.endDate,'end date'),archived:false};
    if(person.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))fail('Enter a valid work email.');
    if(person.email&&state.people.some(p=>p.id!==person.id&&p.email?.toLowerCase()===person.email.toLowerCase()))fail('A profile already uses this work email.');
    if(person.endDate&&(!person.startDate||person.endDate<person.startDate))fail('End date must be on or after the start date.');
    if(person.managerId){
      if(!state.people.some(p=>p.id===person.managerId&&!p.archived))fail('Choose an active manager.');
      if(person.managerId===person.id||descendants(state.people,person.id).has(person.managerId))fail('Reporting lines cannot form a loop.');
      let id=person.managerId,depth=0;while(id){if(++depth>30)fail('Reporting hierarchy cannot exceed 30 levels.');id=state.people.find(p=>p.id===id)?.managerId;}
    }
    if(!existing&&state.people.length>=2000)fail('Directory capacity reached. Contact an administrator.');
  }else{
    if(!existing)fail('Choose an existing person.');
    if(command.action==='archive'&&state.people.some(p=>!p.archived&&p.managerId===existing.id))fail('Reassign direct reports before archiving this person.');
    person={...existing,archived:command.action==='archive'};
    if(command.action==='restore'&&person.managerId&&!state.people.some(p=>p.id===person.managerId&&!p.archived))person.managerId='';
    if(command.action==='restore'&&descendants(state.people,person.id).has(person.managerId))fail('Reassign the manager before restoring this profile.');
  }
  if(existing?.quickbooksSources)person.quickbooksSources=existing.quickbooksSources;
  person.version=(existing?.version||0)+1;person.updatedAt=timestamp;person.updatedBy=actor;person.createdAt=existing?.createdAt||timestamp;
  if(existing)state.people[state.people.findIndex(p=>p.id===person.id)]=person;else state.people.push(person);
  if(state.history.length>=10000)fail('Directory history capacity reached. Contact an administrator.');
  for(const member of state.people.filter(p=>!p.archived)){let cursor=member,depth=0;const seen=new Set();while(cursor){if(seen.has(cursor.id))fail('Reporting lines cannot form a loop.');seen.add(cursor.id);if(++depth>30)fail('Reporting hierarchy cannot exceed 30 levels.');cursor=state.people.find(p=>p.id===cursor.managerId&&!p.archived);}}
  state.history.push({id:randomUUID(),personId:person.id,action:command.action,at:timestamp,by:actor,managerName:state.people.find(p=>p.id===person.managerId)?.name||'',before:existing||null,after:structuredClone(person)});
  return state;
}
