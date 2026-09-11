import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { seedCreativeAnalytics } from './fixtures/creative-analytics.mjs';
import meta from '../api/meta.js';
import flow from '../api/creative-flow.js';
import { creatorRollups, buildIteration } from '../src/lib/creative-analytics-view.js';
import { loadCreativePerformanceSnapshot } from '../api/_lib/meta/creative-performance-snapshot.js';
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}});
test('creator rollups use ratios of totals and omit unresolved creator conflicts',()=>{
 const rows=creatorRollups([{creatorId:1,creatorName:'One',spend:100,purchaseValue:800,purchases:2},{creatorId:1,spend:900,purchaseValue:900,purchases:3},{creatorId:1,creatorConflict:true,spend:5000}]);
 assert.equal(rows[0].roas,1.7);assert.equal(rows[0].cpa,200);assert.equal(rows[0].groups.length,2);
 assert.throws(()=>buildIteration({groupKey:'a'}, {title:'Test',hypothesis:'New hook'}),/confirmed creator/);
});
test('database roster, source assignment, and iteration retain the actual creator and source identity',async()=>{
 const db=new PGlite(), previous={...process.env};const restore=useTestDatabase(db);
 try {
  Object.assign(process.env,{TZ:'America/Denver',NODE_ENV:'development',AUTH_DISABLED:'true',META_ACCESS_TOKEN:'fixture',META_AD_ACCOUNT_ID:'fixture',FORCE_BOOTSTRAP:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.invalid/fixture'});
  const {sql,archived}=await seedCreativeAnalytics(db);
  await sql`INSERT INTO creative_performance(ad_id,ad_name,group_key) VALUES ('fixture-copy','Copy','fixture-0')`;
  await sql`INSERT INTO creative_insights_daily(ad_id,date,spend,purchases,purchase_value) VALUES ('fixture-copy',current_date,100,2,1000), ('fixture-ad-0',current_date-60,90000,999,999999)`;
  const snapshot=await loadCreativePerformanceSnapshot(sql,'fixture-0');
  assert.equal(snapshot.spend,2500);assert.equal(snapshot.purchases,22);assert.equal(snapshot.purchaseValue,9000);assert.equal(snapshot.roas,3.6);
  assert.equal(snapshot.until,(await sql`SELECT current_date::text AS day`)[0].day);
  const call=async(handler,body)=>{const result=response();await handler({method:'POST',headers:{},query:{},body},result);assert.ok([200,201].includes(result.statusCode),JSON.stringify(result.body));return result.body;};
  const initial=await call(meta,{action:'get_creative_table',sinceDays:14});
  assert.equal(initial.until,(await sql`SELECT current_date::text AS day`)[0].day);
  assert.ok(initial.creators.some(c=>Number(c.id)===Number(archived.id)&&c.archived));
  const target=initial.groups.find(g=>g.groupKey==='fixture-1');
  await call(meta,{action:'assign_creative_creator',groupKey:target.groupKey,creatorId:archived.id});
  const asset=(await sql`SELECT creator_id FROM creative_assets WHERE group_key='fixture-1'`)[0];assert.equal(Number(asset.creator_id),Number(archived.id));
  const refreshed=await call(meta,{action:'get_creative_table',sinceDays:14});
  const linked=refreshed.groups.find(g=>g.groupKey===target.groupKey);assert.equal(Number(linked.creatorId),Number(archived.id));
  const payload=buildIteration(linked,{title:'Shorter opener',hypothesis:'Keep proof, shorten opening',since:refreshed.since,until:refreshed.until});
  const saved=await call(flow,payload);assert.ok(saved.card.id);assert.equal(saved.card.source_winner_group_key,target.groupKey);assert.equal(saved.card.group_key,null);assert.equal(Number(saved.card.creator_id),Number(archived.id));assert.equal(saved.card.concept_json.hypothesis,'Keep proof, shorten opening');assert.equal(saved.card.concept_json.observed_performance.spend,linked.spend);assert.equal(saved.card.stage,'brief');
 }finally{restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
