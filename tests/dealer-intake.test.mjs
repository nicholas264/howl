import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {ensureCrm} from '../api/_lib/crm.js';
import {ensureDealerIntake,intakeData,nextBusinessDay} from '../api/_lib/dealer-intake.js';
import {createDealerIntakeHandler} from '../api/dealer-intake.js';
const input={firstName:'Jane',lastName:'Buyer',email:'BUYER@example.com',phone:'555-0100',company:'Example Outdoor',website:'example.com',address:'100 Example Street',message:'We sell outdoor equipment.',requestId:randomUUID()};
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){return this;}});
async function call(handler,body=input,headers={},method='POST'){const res=response();await handler({method,body,headers:{origin:'https://welcometothecampfire.io','content-type':'application/json',...headers}},res);return res;}
test('dealer form validation preserves fields and enforces bounded safe input',()=>{
 assert.equal(intakeData(input).email,'buyer@example.com');assert.equal(intakeData(input).website,'https://example.com/');
 for(const extra of [{firstName:''},{email:'invalid'},{company:'x'.repeat(201)},{message:''},{website:'javascript:alert(1)'},{website:'https://user:secret@example.com'},{phone:null}])assert.throws(()=>intakeData({...input,...extra}));
 assert.equal(nextBusinessDay(new Date('2026-09-25T17:00:00Z')),'2026-09-28');
 assert.equal(nextBusinessDay(new Date('2026-09-26T02:00:00Z')),'2026-09-28');
});
test('public intake rejects origins, methods, oversize bodies and spam before database access',async()=>{
 const handler=createDealerIntakeHandler({getSql:()=>{throw Error('No database access expected');}});
 assert.equal((await call(handler,input,{origin:'https://evil.example'})).statusCode,403);
 assert.equal((await call(handler,input,{origin:undefined})).statusCode,403);
 assert.equal((await call(handler,input,{},'GET')).statusCode,405);
 assert.equal((await call(handler,input,{},'OPTIONS')).statusCode,204);
 assert.equal((await call(handler,input,{'content-type':'text/plain'})).statusCode,415);
 assert.equal((await call(handler,{...input,message:'x'.repeat(17000)})).statusCode,413);
 assert.deepEqual((await call(handler,{fax:'spam'})).body,{ok:true});
 assert.equal((await call(handler,{...input,requestId:'bad'})).statusCode,400);
});
test('public intake atomically creates a new lead and activity; retries and concurrent submissions deduplicate',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),sql=neon('postgres://test:test@localhost/test');
 try{
  await ensureCrm(sql);await ensureDealerIntake(sql);
  const rates=[];const handler=createDealerIntakeHandler({getSql:()=>sql,limit:async(_sql,args)=>{rates.push(args);return {allowed:true};},now:()=>new Date('2026-09-25T17:00:00Z')});
  const results=await Promise.all([call(handler),call(handler,{...input,requestId:randomUUID()})]);
  assert.deepEqual(results.map(r=>r.statusCode),[200,200]);assert.deepEqual(results[0].body,{ok:true});
  let rows=await sql`SELECT * FROM crm_opportunities`;assert.equal(rows.length,1);const lead=rows[0];
  assert.equal(lead.data.stage,'new');assert.equal(lead.data.owner,'Nicholas');assert.equal(lead.data.value,0);assert.equal(lead.data.followUp,'2026-09-28');assert.equal(lead.created_by,'public:dealer-intake');assert.equal(lead.data.contacts[0].email,'buyer@example.com');assert.match(lead.data.notes,/100 Example Street/);assert.match(lead.data.notes,/Website: https:\/\/example.com/);
  assert.equal((await sql`SELECT * FROM crm_activity`).length,1);assert.equal((await sql`SELECT * FROM crm_intake_submissions`).length,1);
  assert.equal((await call(handler)).statusCode,200);
  const [receipt]=await sql`SELECT id FROM crm_intake_submissions`;assert.equal((await call(handler,{...input,requestId:receipt.id,message:'Changed'})).statusCode,409);
  await sql`UPDATE crm_opportunities SET data=jsonb_set(data,'{stage}','"won"') WHERE id=${lead.id}`;
  assert.equal((await call(handler,{...input,requestId:randomUUID()})).statusCode,200);
  assert.equal((await sql`SELECT data FROM crm_opportunities`)[0].data.stage,'won');
  const rateHandler=createDealerIntakeHandler({getSql:()=>sql,limit:async()=>({allowed:false,retryAfter:60})});
  const rate=await call(rateHandler);assert.equal(rate.statusCode,429);assert.equal(rate.headers['Retry-After'],'60');
  assert.ok(rates.some(r=>r.route==='dealer-intake:total'));assert.ok(rates.some(r=>r.route==='dealer-intake:email'));
  await db.exec("CREATE FUNCTION reject_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected failure'; END $$; CREATE TRIGGER reject_intake BEFORE INSERT ON crm_activity FOR EACH ROW EXECUTE FUNCTION reject_intake_audit()");
  assert.equal((await call(handler,{...input,requestId:randomUUID(),company:'Rollback retailer'})).statusCode,503);
  assert.equal((await sql`SELECT * FROM crm_opportunities`).length,1);assert.equal((await sql`SELECT * FROM crm_intake_submissions`).length,1);
 }finally{restore();await db.close();}
});
