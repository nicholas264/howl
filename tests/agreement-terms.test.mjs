import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {useTestDatabase} from './neon-test-adapter.mjs';import workflow from '../api/creator-workflow.js';import accept from '../api/creator-agreement.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});
test('agreements retain prepared terms through viewing and acceptance and reject a racing preparation',async()=>{
 const db=new PGlite(),previous={...process.env};let race=false;
 const restore=useTestDatabase(db,async(query)=>{if(race&&query.includes('INSERT INTO creator_agreements')){race=false;await db.exec('UPDATE creator_engagements SET fee_amount=777');}});
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
  await initializeSchema(sql);await ensureRateLimits(sql);
  const [creator]=await sql`INSERT INTO creators(name,email) VALUES ('Fixture','fixture@example.test') RETURNING id`;
  const [engagement]=await sql`INSERT INTO creator_engagements(creator_id,status,fee_amount,usage_term_months) VALUES (${creator.id},'approved',100,3) RETURNING id`;
  const request={method:'POST',headers:{},query:{},body:{creator_id:creator.id,action:'create_agreement',engagement_id:engagement.id,title:'Fixture terms',agreement_body:'Fixture prepared text'}};
  const created=response();await workflow(request,created);assert.equal(created.statusCode,201,JSON.stringify(created.body));
  const token=new URL(created.body.agreement_path,'https://fixture.test').searchParams.get('token'),id=created.body.agreement.id;
  await sql`UPDATE creator_agreements SET status='sent',sent_to='fixture@example.test' WHERE id=${id}`;
  await sql`UPDATE creator_engagements SET fee_amount=999,usage_term_months=99 WHERE id=${engagement.id}`;
  await sql`UPDATE creators SET name='Changed name',email='changed@example.test' WHERE id=${creator.id}`;
  const viewed=response();await accept({method:'GET',headers:{},query:{token}},viewed);assert.equal(viewed.statusCode,200,JSON.stringify(viewed.body));assert.equal(viewed.body.agreement.creator_name,'Fixture');assert.equal(viewed.body.agreement.creator_email,'fixture@example.test');assert.equal(Number(viewed.body.agreement.engagement.fee_amount),100);assert.equal(viewed.body.agreement.engagement.usage_term_months,3);
  await sql`UPDATE creator_agreements SET agreement_body='Changed text' WHERE id=${id}`;
  const changed=response();await accept({method:'POST',headers:{},body:{token,consent_digest:viewed.body.agreement.consent_digest,accepted_name:'Fixture Person',accepted_email:'fixture@example.test',confirmed:true}},changed);assert.equal(changed.statusCode,409);
  await sql`UPDATE creator_agreements SET agreement_body='Fixture prepared text' WHERE id=${id}`;
  const signed=response();await accept({method:'POST',headers:{},body:{token,consent_digest:viewed.body.agreement.consent_digest,accepted_name:'Fixture Person',accepted_email:'fixture@example.test',confirmed:true}},signed);assert.equal(signed.statusCode,201,JSON.stringify(signed.body));assert.equal(signed.body.agreement.engagement.usage_term_months,3);
  const [record]=await sql`SELECT status,source_metadata FROM creator_agreements WHERE id=${id}`;assert.equal(record.status,'accepted');assert.equal(record.source_metadata.engagement_snapshot.usage_term_months,3);
  race=true;const conflict=response();await workflow(request,conflict);assert.equal(conflict.statusCode,409,JSON.stringify(conflict.body));assert.equal((await sql`SELECT count(*)::int AS n FROM creator_agreements`)[0].n,1);
  await sql`UPDATE creator_agreements SET source_metadata='{}'::jsonb WHERE id=${id}`;
  const legacy=response();await accept({method:'GET',headers:{},query:{token}},legacy);assert.equal(legacy.statusCode,409);
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
