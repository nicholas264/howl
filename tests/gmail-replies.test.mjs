import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {senderMatches,syncReplies} from '../api/creator-email.js';

test('Gmail reply sync isolates mailbox ownership and records concurrent replies once',async()=>{
 assert.equal(senderMatches('Creator <creator@example.test>','creator@example.test'),true);
 for(const value of ['creator@example.test.attacker.com','othercreator@example.test','"creator@example.test" <attacker@example.test>','creator@example.test, other@example.test'])assert.equal(senderMatches(value,'creator@example.test'),false);
 const db=new PGlite(),previousFetch=globalThis.fetch;
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  await initializeSchema(sql);await ensureLocalReceipts(sql);
  const [creator]=await sql`INSERT INTO creators(name,email) VALUES ('Fixture','creator@example.test') RETURNING id,email`;
  for(const [actor,thread] of [['owner','owner-thread'],['other','other-thread']])await sql`INSERT INTO creator_outreach(creator_id,channel,direction,status,external_id,external_thread_id,created_by,sent_at,body) VALUES (${creator.id},'email','outbound','sent',${actor+'-sent'},${thread},${actor},now()-interval '1 hour','Fixture sent email')`;
  let lookups=0;
  globalThis.fetch=async(url,init)=>{
   assert.ok(url.includes('/owner-thread?'));assert.equal(init.headers.Authorization,'Bearer fixture-token');assert.ok(init.signal);lookups++;
   const message=(id,from)=>({id,internalDate:String(Date.now()),snippet:'Fixture reply',payload:{headers:[{name:'From',value:from}]}});
   return Response.json({messages:[message('reply','Creator <creator@example.test>'),message('spoof','creator@example.test.attacker.com')]});
  };
  const args={sql,access:{userId:'owner'},accessToken:'fixture-token',creator};
  const results=await Promise.all([syncReplies(args),syncReplies(args)]);
  assert.equal(results.reduce((sum,result)=>sum+result.replies,0),1);assert.equal(lookups,2);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach WHERE direction='inbound'`)[0].n,1);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_activity WHERE kind='outreach_reply'`)[0].n,1);
  assert.equal((await sql`SELECT status FROM creator_outreach WHERE created_by='other'`)[0].status,'sent');
  await syncReplies(args);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_outreach WHERE direction='inbound'`)[0].n,1);
 }finally{globalThis.fetch=previousFetch;await db.close();}
});
