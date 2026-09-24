import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {ensureCrm,opportunityData,draftData,hash} from '../api/_lib/crm.js';
import {createCrmHandler} from '../api/crm.js';
import {createCrmEmailHandler,gmailMime,canSendGmail} from '../api/crm-email.js';
import {ROLE_PERMISSIONS,hasPermission} from '../api/_lib/app-access.js';
import {crmCsv,followUpState} from '../src/lib/crm.js';
import {googleReturnPath} from '../api/_lib/google-oauth-routing.js';
const values={title:'Opening order',company:'Test retailer',stage:'new',value:2400,owner:'Roy',nextAction:'Call buyer',followUp:'2026-09-25',closeDate:'',contacts:[{name:'Buyer',email:'buyer@example.com',phone:''}],notes:''};
const message={to:'buyer@example.com',subject:'Opening assortment',body:'Hello — here are the details.\nThanks!'};
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
async function call(handler,body,query){const r=response();await handler({method:body?'POST':'GET',body,query},r);return r;}
async function fixture(work){const db=new PGlite();const restore=useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');await ensureCrm(sql);let actor='roy';const authorize=async(_req,_res,permission)=>({sql,userId:actor,role:"owner",permissions:ROLE_PERMISSIONS.owner});const crm=createCrmHandler({authorize});const id=randomUUID();const created=await call(crm,{action:'create',id,requestId:randomUUID(),data:values});assert.equal(created.statusCode,200,JSON.stringify(created.body));try{await work({db,sql,authorize,crm,id,actor:v=>{actor=v;}});}finally{restore();await db.close();}}
const connection={google_email:'roy@example.com',scopes:['https://www.googleapis.com/auth/gmail.send']};
function mailHandler(authorize,fetchImpl,getToken=async()=>'test-only-token'){return createCrmEmailHandler({authorize,fetchImpl,getToken,getConnection:async()=>connection});}
async function draft(handler,opportunityId,data=message){const id=randomUUID();const r=await call(handler,{action:'save',id,opportunityId,revision:0,data});assert.equal(r.statusCode,200,JSON.stringify(r.body));return r.body.email;}

test('validation requires next actions; rejects invalid dates, values, contact duplicates and header injection',()=>{
  assert.equal(opportunityData(values).value,2400);
  for(const change of [{stage:'wrong'},{value:-1},{value:1.234},{value:Infinity},{followUp:'2026-02-30'},{nextAction:''},{contacts:[values.contacts[0],values.contacts[0]]}])assert.throws(()=>opportunityData({...values,...change}));
  assert.doesNotThrow(()=>opportunityData({...values,stage:'won',nextAction:'',followUp:''}));
  assert.throws(()=>draftData({...message,subject:'Hello\r\nBcc: somebody@example.com'}));
  assert.throws(()=>gmailMime({...message,to:'buyer@example.com\r\nBcc: bad@example.com'},randomUUID()));
  const mime=gmailMime(message,randomUUID());assert.match(mime,/Content-Transfer-Encoding: base64/);assert.match(mime,/Subject: =\?UTF-8\?B\?/);
  assert.equal(hash({b:1,a:2}),hash({a:2,b:1}));
});
test('CRM permissions are owner-only and Gmail return routing requests CRM',()=>{
  assert.deepEqual(ROLE_PERMISSIONS.sales,['crm.read','crm.write','crm.send']);
  assert.equal(hasPermission({permissions:ROLE_PERMISSIONS.viewer},'crm.read'),false);
  for(const role of Object.keys(ROLE_PERMISSIONS)){
    for(const permission of ['crm.read','crm.write','crm.send']){
      assert.equal(hasPermission({role,permissions:ROLE_PERMISSIONS[role]},permission),role==='owner');
      assert.equal(hasPermission({role,permissions:['*']},permission),role==='owner');
    }
  }
  assert.equal(canSendGmail(connection),true);assert.equal(canSendGmail({...connection,scopes:[]}),false);
  assert.equal(googleReturnPath('crm_email'),'/?tab=crm&gmail_connected=1');
});
test('SQL persistence, retry receipts, conflict detection, note history, archive and restore',()=>fixture(async({crm,id,sql})=>{
  let r=await call(crm,null,{id});assert.equal(r.body.activity.length,1);
  const body={action:'save',id,revision:1,requestId:randomUUID(),data:{...values,stage:'qualified'}};
  r=await call(crm,body);assert.equal(r.body.opportunity.revision,2);
  r=await call(crm,body);assert.equal(r.body.replayed,true);
  r=await call(crm,{...body,data:{...values,title:'different'}});assert.equal(r.statusCode,409);
  r=await call(crm,{...body,requestId:randomUUID()});assert.equal(r.statusCode,409);
  r=await call(crm,{action:'note',id,revision:2,requestId:randomUUID(),note:'Buyer called back'});assert.equal(r.body.opportunity.revision,3);
  r=await call(crm,{action:'archive',id,revision:3,requestId:randomUUID()});assert.equal(r.body.opportunity.archived,true);
  r=await call(crm,{action:'save',id,revision:4,requestId:randomUUID(),data:values});assert.equal(r.statusCode,400);
  r=await call(crm,{action:'restore',id,revision:4,requestId:randomUUID()});assert.equal(r.body.opportunity.archived,false);
  r=await call(crm,null,{id});assert.equal(r.body.activity.length,5);assert.equal(r.body.opportunity.revision,5);
  assert.equal((await sql`SELECT count(*) FROM crm_opportunities`)[0].count,'1');
}));
test('concurrent edits admit one winner and preserve one matching audit entry',()=>fixture(async({crm,id})=>{
  const r=await Promise.all(['qualified','contacted'].map(stage=>call(crm,{action:'stage',id,revision:1,requestId:randomUUID(),stage})));
  assert.deepEqual(r.map(x=>x.statusCode).sort(),[200,409]);
  const current=await call(crm,null,{id});assert.equal(current.body.opportunity.revision,2);assert.equal(current.body.activity.length,2);
}));
test('duplicate and concurrent email send requests invoke Gmail exactly once and persist sent history',()=>fixture(async({authorize,id,crm})=>{
  let sends=0;const handler=mailHandler(authorize,async(url,init)=>{sends++;assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');const raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();assert.match(raw,/To: buyer@example.com/);return Response.json({id:'gmail-1',threadId:'thread-1'});});
  const d=await draft(handler,id);const body={action:'send',sender:'roy@example.com',id:d.id,opportunityId:id,revision:d.revision};
  await Promise.all([call(handler,body),call(handler,body)]);assert.equal(sends,1);
  let r=await call(handler,body);assert.equal(r.body.email.status,'sent');assert.equal(sends,1);
  r=await call(crm,null,{id});assert.equal(r.body.activity.filter(a=>a.kind==='email_sent').length,1);
}));
test('timeouts never retry and require a deliberate, delayed manual resolution',()=>fixture(async({authorize,id,sql})=>{
  let sends=0;const handler=mailHandler(authorize,async()=>{sends++;throw new Error('timeout');});const d=await draft(handler,id);
  const body={action:'send',sender:'roy@example.com',id:d.id,opportunityId:id,revision:d.revision};let r=await call(handler,body);assert.equal(r.body.email.status,'uncertain');
  await call(handler,body);assert.equal(sends,1);
  const resolve={action:'resolve',id:d.id,opportunityId:id,outcome:'confirmed_not_sent',checkedGmail:true};
  r=await call(handler,resolve);assert.equal(r.statusCode,409);
  await sql`UPDATE crm_emails SET updated_at=now()-interval '3 minutes' WHERE id=${d.id}`;
  r=await call(handler,{...resolve,checkedGmail:false});assert.equal(r.statusCode,400);
  r=await call(handler,resolve);assert.equal(r.body.email.status,'confirmed_not_sent');
  await call(handler,body);assert.equal(sends,1);
}));
test('draft updates reject stale writers, repeat identical saves safely, and remain private',()=>fixture(async({authorize,id,actor})=>{
  const handler=mailHandler(authorize,async()=>Response.json({id:'unused'}));const d=await draft(handler,id);
  let r=await call(handler,{action:'save',id:d.id,opportunityId:id,revision:0,data:message});assert.equal(r.statusCode,200);
  r=await call(handler,{action:'save',id:d.id,opportunityId:id,revision:0,data:{...message,body:'changed'}});assert.equal(r.statusCode,409);
  actor('another-rep');r=await call(handler,null,{opportunityId:id});assert.equal(r.body.emails.length,0);
  r=await call(handler,{action:'send',sender:'roy@example.com',id:d.id,opportunityId:id,revision:1});assert.equal(r.statusCode,404);
}));
test('expired Gmail token leaves the draft unsent and a Gmail rejection is definitive',()=>fixture(async({authorize,id})=>{
  let sends=0;const expired=mailHandler(authorize,async()=>{sends++;},async()=>{throw Object.assign(new Error('expired'),{reconnectRequired:true});});
  const d=await draft(expired,id);const body={action:'send',sender:'roy@example.com',id:d.id,opportunityId:id,revision:1};let r=await call(expired,body);assert.equal(r.statusCode,409);assert.equal(sends,0);
  const reject=mailHandler(authorize,async()=>Response.json({error:{message:'rate limit'}},{status:429}));r=await call(reject,body);assert.equal(r.body.email.status,'failed');
}));
test('CSV neutralizes spreadsheet formulas and due dates use supplied local calendar day',()=>{
  const o={data:{...values,title:'=HYPERLINK("bad")'},archived:false};assert.match(crmCsv([o]),/'=HYPERLINK/);
  assert.equal(followUpState(o,'2026-09-25'),'Due today');assert.equal(followUpState(o,'2026-09-26'),'Overdue');
});

test('an unresolved email blocks another saved draft from being sent',()=>fixture(async({authorize,id})=>{
  let sends=0;const handler=mailHandler(authorize,async()=>{sends++;throw new Error('timeout');});const a=await draft(handler,id),b=await draft(handler,id);
  await call(handler,{action:'send',sender:'roy@example.com',id:a.id,opportunityId:id,revision:1});
  const r=await call(handler,{action:'send',sender:'roy@example.com',id:b.id,opportunityId:id,revision:1});assert.equal(r.statusCode,409);assert.equal(sends,1);
}));
test('an audit failure rolls back the opportunity mutation',()=>fixture(async({crm,id,db})=>{
  await db.exec("CREATE FUNCTION reject_crm_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON crm_activity FOR EACH ROW EXECUTE FUNCTION reject_crm_audit()");
  const r=await call(crm,{action:'save',id,revision:1,requestId:randomUUID(),data:{...values,title:'Must not commit'}});assert.equal(r.statusCode,503);
  const state=await call(crm,null,{id});assert.equal(state.body.opportunity.data.title,values.title);assert.equal(state.body.opportunity.revision,1);
}));
test('post-send database failure preserves a claimed attempt and never resends',()=>fixture(async({authorize,id,db})=>{
  let sends=0;const handler=mailHandler(authorize,async()=>{sends++;return Response.json({id:'accepted-by-gmail'});});const d=await draft(handler,id);
  await db.exec("CREATE FUNCTION reject_sent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='email_sent' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_sent BEFORE INSERT ON crm_activity FOR EACH ROW EXECUTE FUNCTION reject_sent_audit()");
  const body={action:'send',sender:'roy@example.com',id:d.id,opportunityId:id,revision:1};let r=await call(handler,body);assert.equal(r.statusCode,503);
  r=await call(handler,body);assert.equal(r.body.email.status,'sending');assert.equal(sends,1);
}));
test('denied requests stop before CRM storage or email providers',async()=>{
  const permissions=[];const authorize=async(req,res,permission)=>{permissions.push(permission);res.status(403).json({error:'Denied'});return null;};
  for(const handler of [createCrmHandler({authorize}),createCrmEmailHandler({authorize,getConnection:()=>{throw Error('Should not connect');}})]){
    assert.equal((await call(handler)).statusCode,403);assert.equal((await call(handler,{action:'send'})).statusCode,403);
  }
  assert.deepEqual(permissions,['crm.read','crm.write','crm.read','crm.send']);
});
test('sending requires the exact Gmail account the user reviewed',()=>fixture(async({authorize,id})=>{
  let sends=0;const handler=mailHandler(authorize,async()=>{sends++;return Response.json({id:'wrong'});});const d=await draft(handler,id);
  const r=await call(handler,{action:'send',sender:'someone-else@example.com',id:d.id,opportunityId:id,revision:1});assert.equal(r.statusCode,409);assert.equal(sends,0);
}));

 test('all non-owner roles are denied CRM APIs even with wildcard grants',async()=>{
  for(const role of [...Object.keys(ROLE_PERMISSIONS).filter(r=>r!=='owner'),undefined]){
    const forbidden=()=>{throw Error('Non-owner must not access storage or Google');};
    const authorize=async()=>({role,permissions:['*','crm.read','crm.write','crm.send'],sql:forbidden,userId:'other'});
    for(const handler of [createCrmHandler({authorize}),createCrmEmailHandler({authorize,getConnection:forbidden,getToken:forbidden,fetchImpl:forbidden})]){
      assert.equal((await call(handler)).statusCode,403);
      assert.equal((await call(handler,{action:'send'})).statusCode,403);
    }
  }
});
