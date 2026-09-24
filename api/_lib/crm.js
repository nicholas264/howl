import { createHash } from 'node:crypto';
import { CRM_STAGES } from '../../src/lib/crm.js';
export const crmError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function text(value,label,max=200,required=false) {
  if(typeof value!=='string'||value.length>max||(required&&!value.trim())||value.includes('\u0000'))throw crmError(`${label} ${required?'is required and ':''}must be at most ${max} characters.`);
  return value.trim();
}
export function date(value,label) {
  if(value===''||value==null)return '';
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw crmError(`Enter a valid ${label}.`);
  return value;
}
export function email(value) {
  const v=text(value,'Email',254,true);
  if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(v))throw crmError('Enter one valid email address.');
  return v;
}
export function opportunityData(b={}) {
  if(!CRM_STAGES.some(s=>s.id===b.stage))throw crmError('Choose a valid pipeline stage.');
  if(typeof b.value!=='number'||!Number.isFinite(b.value)||b.value<0||b.value>1e10||Math.abs(b.value*100-Math.round(b.value*100))>0.001)throw crmError('Value must be a positive USD amount with at most two decimal places, or zero.');
  if(!Array.isArray(b.contacts)||b.contacts.length>20)throw crmError('Add up to 20 contacts.');
  const contacts=b.contacts.map(c=>({name:text(c.name??'','Contact name'),email:c.email?email(c.email):'',phone:text(c.phone??'','Phone',80)})).filter(c=>c.name||c.email||c.phone);
  if(new Set(contacts.filter(c=>c.email).map(c=>c.email.toLowerCase())).size!==contacts.filter(c=>c.email).length)throw crmError('Each contact email should appear only once.');
  const data={title:text(b.title,'Opportunity name',200,true),company:text(b.company,'Company',200,true),stage:b.stage,value:b.value,owner:text(b.owner,'Owner',200,true),nextAction:text(b.nextAction??'','Next action',500),followUp:date(b.followUp,'follow-up date'),closeDate:date(b.closeDate,'expected close date'),contacts,notes:text(b.notes??'','Notes',20000)};
  if(!['won','lost'].includes(data.stage)&&(!data.nextAction||!data.followUp))throw crmError('Open opportunities need a next action and follow-up date.');
  return data;
}
export function draftData(b={}) {
  const to=text(b.to??'','Recipient',254),subject=text(b.subject??'','Subject',300),body=text(b.body??'','Message',40000);
  if(/[\r\n]/.test(to+subject))throw crmError('Recipient and subject must each be a single line.');
  return {to,subject,body};
}
export async function ensureCrm(sql) {
  await sql`CREATE TABLE IF NOT EXISTS crm_opportunities (
    id UUID PRIMARY KEY, data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    archived BOOLEAN NOT NULL DEFAULT false, created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS crm_activity (
    id UUID PRIMARY KEY, opportunity_id UUID NOT NULL REFERENCES crm_opportunities(id),
    actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail JSONB NOT NULL,
    request_id UUID NOT NULL UNIQUE, request_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS crm_activity_opportunity ON crm_activity(opportunity_id,created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS crm_emails (
    id UUID PRIMARY KEY, opportunity_id UUID NOT NULL REFERENCES crm_opportunities(id), actor_id TEXT NOT NULL,
    data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','uncertain','failed','confirmed_sent','confirmed_not_sent')),
    sender TEXT, provider_id TEXT, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS crm_emails_opportunity ON crm_emails(opportunity_id,created_at DESC)`;
}
