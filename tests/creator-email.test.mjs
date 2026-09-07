import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureOperationJournal} from '../api/_lib/operation-journal.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import handler from '../api/creator-email.js';

test('email receipt replay is creator-bound and local records roll back together',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},previousFetch=globalThis.fetch;
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}});
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test',RESEND_API_KEY:'fixture-only'});
  await initializeSchema(sql);await ensureOperationJournal(sql);await ensureLocalReceipts(sql);
  const creators=await sql`INSERT INTO creators(name,email) VALUES ('One','one@example.test'),('Two','two@example.test') RETURNING id`;
  const [agreement]=await sql`INSERT INTO creator_agreements(creator_id,title,agreement_body) VALUES (${creators[0].id},'Fixture agreement','Fixture terms') RETURNING id`;
  let sends=0,missingReceipt=false;
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');assert.ok(init.headers['Idempotency-Key']);sends++;return Response.json(missingReceipt?{}:{id:'fixture-message'});};
  const req={method:'POST',headers:{},body:{creator_id:creators[0].id,to:'one@example.test',subject:'Fixture',body:'Fixture body',request_key:'email-fixture',agreement_id:agreement.id}};
  await db.exec(`CREATE FUNCTION fail_email_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected activity failure'; END $$; CREATE TRIGGER fail_email_activity BEFORE INSERT ON creator_activity FOR EACH ROW EXECUTE FUNCTION fail_email_activity()`);
  const failed=response();await handler(req,failed);assert.equal(failed.statusCode,500);assert.equal(sends,1);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach`)[0].n,0);
  await db.exec('DROP TRIGGER fail_email_activity ON creator_activity');
  await sql`UPDATE creator_agreements SET status='accepted',accepted_at=now() WHERE id=${agreement.id}`;
  const retry=response();await handler(req,retry);assert.equal(retry.statusCode,201);assert.equal(sends,1);
  const wrongCreator=response();await handler({...req,body:{...req.body,creator_id:creators[1].id}},wrongCreator);assert.equal(wrongCreator.statusCode,409);assert.equal(sends,1);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach`)[0].n,1);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_activity WHERE kind='outreach'`)[0].n,1);
  assert.equal((await sql`SELECT status FROM creator_agreements WHERE id=${agreement.id}`)[0].status,'accepted');
  const newSend=response();await handler({...req,body:{...req.body,request_key:'new-accepted-send'}},newSend);assert.equal(newSend.statusCode,400);assert.equal(sends,1);
  missingReceipt=true;const noReceiptReq={...req,body:{...req.body,request_key:'missing-receipt',agreement_id:null}};
  const noReceipt=response();await handler(noReceiptReq,noReceipt);assert.equal(noReceipt.statusCode,500);assert.equal(sends,2);
  const uncertain=response();await handler(noReceiptReq,uncertain);assert.equal(uncertain.statusCode,409);assert.equal(sends,2);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach`)[0].n,1);
 }finally{restore();globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
