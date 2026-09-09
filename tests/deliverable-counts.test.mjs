import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';import {ensureApprovalSnapshots,approveDeliverable} from '../api/_lib/approval-snapshots.js';
import {useTestDatabase} from './neon-test-adapter.mjs';import workflow from '../api/creator-workflow.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}});

test('single-output approval and status changes do not credit all expected assets',async()=>{
 const db=new PGlite(),previous={...process.env},restore=useTestDatabase(db);
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 try{
  Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db'});
  await initializeSchema(sql);await ensureApprovalSnapshots(sql);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Count fixture') RETURNING id`;
  const [deliverable]=await sql`INSERT INTO creator_deliverables(creator_id,title,expected_asset_count,output_url,due_at) VALUES (${creator.id},'Three expected outputs',3,'https://example.test/one.mp4',now()-interval '1 day') RETURNING *`;
  const patch=async body=>{const res=response();await workflow({method:'PATCH',headers:{},query:{},body:{creator_id:creator.id,resource:'deliverable',id:deliverable.id,...body}},res);assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body.deliverable;};
  const complete=await patch({status:'complete'});
  assert.equal(complete.approved_asset_count,0,'completion is not output approval');assert.equal(complete.completed_asset_count,1);assert.equal(complete.expected_asset_count,3);
  const launched=await patch({status:'launched'});assert.equal(launched.approved_asset_count,0);assert.equal(launched.shipped_asset_count,1);
  const summary=response();await workflow({method:'GET',headers:{},query:{creator_id:creator.id}},summary);assert.equal(summary.statusCode,200);assert.equal(summary.body.production_summary.overdue,2,'remaining assets stay overdue even when the linked output is launched');
  const approved=await approveDeliverable(sql,deliverable.id,creator.id,launched.updated_at,'reviewer',{sha256:'a'.repeat(64)});
  assert.equal(approved.approved_asset_count,1);assert.equal(approved.expected_asset_count,3);
  const again=await approveDeliverable(sql,deliverable.id,creator.id,approved.updated_at,'reviewer',{sha256:'a'.repeat(64)});
  assert.equal(again.approved_asset_count,1,'reviewing the same output twice is not two approved assets');
  const manual=await patch({approved_asset_count:2,completed_asset_count:2,shipped_asset_count:2});assert.equal(manual.approved_asset_count,2);
  const preserved=await patch({status:'launched'});for(const key of ['approved_asset_count','completed_asset_count','shipped_asset_count'])assert.equal(preserved[key],2,'preserve explicitly recorded counts');
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
