import { text, email, opportunityData, crmError } from './crm.js';
export function intakeData(body) {
  if(!body || typeof body!=='object' || Array.isArray(body))throw crmError('Enter your business details.');
  const data={firstName:text(body.firstName,'First name',100,true),lastName:text(body.lastName,'Last name',100,true),email:email(body.email).toLowerCase(),phone:text(body.phone,'Phone',80,true),company:text(body.company,'Company name',200,true),website:text(body.website??'','Website',500),address:text(body.address??'','Address',1000),message:text(body.message,'Business description',5000,true)};
  if(data.website){let url;try{url=new URL(/^https?:\/\//i.test(data.website)?data.website:`https://${data.website}`);}catch{throw crmError('Enter a valid website address.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname.includes('.'))throw crmError('Enter a valid website address.');data.website=url.href;}
  return data;
}
export function nextBusinessDay(now=new Date()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const date=new Date(`${today}T12:00:00Z`);do{date.setUTCDate(date.getUTCDate()+1);}while([0,6].includes(date.getUTCDay()));return date.toISOString().slice(0,10);
}
export function intakeOpportunity(data,now) {
  return opportunityData({title:'Dealer inquiry',company:data.company,stage:'new',value:0,owner:'Nicholas',nextAction:'Review dealer inquiry and contact the buyer',followUp:nextBusinessDay(now),closeDate:'',contacts:[{name:`${data.firstName} ${data.lastName}`,email:data.email,phone:data.phone}],notes:[`Campfire dealer inquiry`,`Source: https://welcometothecampfire.io/dealer-intake`,data.website&&`Website: ${data.website}`,data.address&&`Address: ${data.address}`,'',data.message].filter(v=>v!==false).join('\n')});
}
export async function ensureDealerIntake(sql) {
  await sql`CREATE TABLE IF NOT EXISTS crm_intake_submissions (id UUID PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, opportunity_id UUID NOT NULL UNIQUE REFERENCES crm_opportunities(id) DEFERRABLE INITIALLY DEFERRED, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
}
