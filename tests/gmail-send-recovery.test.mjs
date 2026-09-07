import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureOperationJournal} from '../api/_lib/operation-journal.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {ensureGoogleOAuthTables,saveGoogleConnection} from '../api/_lib/google-user-oauth.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import {verifyGmailSend} from '../api/_lib/gmail-send-recovery.js';
import handler from '../api/creator-email.js';

test('Gmail send recovery verifies message content and rejects unrelated evidence',()=>{
 const time=new Date().toISOString(),payload={provider:'gmail',gmailMessageId:'<fixture@test>',to:'to@example.test',subject:'Subject',body:'Message'};
 const step={created_at:time,updated_at:time,request_payload:payload};
 const message={id:'receipt',threadId:'thread',internalDate:String(Date.parse(time)),labelIds:['SENT'],payload:{mimeType:'text/plain',body:{data:Buffer.from('Message').toString('base64url')},headers:[{name:'Message-ID',value:payload.gmailMessageId},{name:'To',value:payload.to},{name:'Subject',value:payload.subject}]}};
 assert.equal(verifyGmailSend(step,message).externalId,'receipt');
 for(const bad of [{...message,labelIds:[]},{...message,internalDate:'0'},{...message,payload:{...message.payload,body:{data:Buffer.from('Other').toString('base64url')}}},{...message,payload:{...message.payload,headers:message.payload.headers.filter(h=>h.name!=='To')}}])assert.throws(()=>verifyGmailSend(step,bad));
});

test('the email endpoint recovers a lost Gmail send response without resending',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},previousFetch=globalThis.fetch;
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}});
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_TOKEN_ENCRYPTION_KEY:'fixture'});delete process.env.RESEND_API_KEY;delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2;
  await initializeSchema(sql);await ensureOperationJournal(sql);await ensureLocalReceipts(sql);await ensureGoogleOAuthTables(sql);
  await saveGoogleConnection(sql,{userId:'local-dev',refreshToken:'fixture-only'});
  const [creator]=await sql`INSERT INTO creators(name,email) VALUES ('Fixture','to@example.test') RETURNING id`;
  let sends=0,message,searches=0,unique=false;
  globalThis.fetch=async(url,init)=>{
   const target=new URL(url);
   if(target.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture-access',expires_in:3600});
   assert.equal(target.hostname,'gmail.googleapis.com');
   if(target.pathname.endsWith('/send')){
    sends++;const raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString('utf8');const [headers,body]=raw.split('\r\n\r\n');
    message={id:'receipt',threadId:'thread',internalDate:String(Date.now()-11*60000),labelIds:['SENT'],payload:{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')},headers:headers.split('\r\n').map(line=>({name:line.slice(0,line.indexOf(':')),value:line.slice(line.indexOf(':')+1).trim()}))}};
    assert.match(raw,/Message-ID: <howl\.[a-f0-9]{64}@welcometothecampfire.io>/);throw new Error('Injected lost send response');
   }
   if(target.pathname.endsWith('/messages')){searches++;assert.match(target.searchParams.get('q'),/in:sent rfc822msgid:<howl\./);return Response.json({messages:unique?[{id:'receipt'}]:[]});}
   assert.ok(target.pathname.endsWith('/messages/receipt'));return Response.json(message);
  };
  const req={method:'POST',headers:{},body:{creator_id:creator.id,to:'to@example.test',subject:'Fixture',body:'Fixture message',request_key:'gmail-lost'}};
  const failed=response();await handler(req,failed);assert.equal(failed.statusCode,500);assert.equal(sends,1);
  const fresh=response();await handler(req,fresh);assert.equal(fresh.statusCode,409);assert.equal(searches,0);
  await sql`UPDATE app_operation_steps SET created_at=now()-interval '12 minutes',updated_at=now()-interval '11 minutes' WHERE status='uncertain'`;
  const absent=response();await handler(req,absent);assert.equal(absent.statusCode,409);assert.equal(sends,1);
  unique=true;const recovered=response();await handler(req,recovered);assert.equal(recovered.statusCode,201);assert.equal(sends,1);
  const replay=response();await handler(req,replay);assert.equal(replay.statusCode,201);assert.equal(sends,1);assert.equal(searches,2);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach`)[0].n,1);
  assert.equal((await sql`SELECT count(*) AS n FROM app_admin_audit WHERE action='operation.reconciled'`)[0].n,1);
 }finally{restore();globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
