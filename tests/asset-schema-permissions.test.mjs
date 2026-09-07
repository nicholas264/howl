import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {upsertDriveAsset} from '../api/_lib/creative-assets.js';
import {claimManualCreativeAnalysis,completeCreativeAnalysisJob} from '../api/_lib/creative-analysis-queue.js';
import {claimSync,checkpointSync} from '../api/_lib/sync-state.js';
import {saveMapSettings,getMapSettings} from '../api/_lib/map-monitor.js';

test('asset ingestion, analysis ownership, sync checkpoints and MAP settings work without DDL privileges',async()=>{
 const db=new PGlite();
 const sql=async(parts,...values)=>(await db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
 try{
  await initializeSchema(sql);
  await db.exec(`CREATE ROLE asset_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO asset_runtime;
   GRANT SELECT,INSERT,UPDATE ON creative_assets,creative_analysis_queue,app_sync_state,map_monitor_settings,map_monitor_dealers TO asset_runtime;
   GRANT USAGE ON SEQUENCE creative_assets_id_seq TO asset_runtime; SET ROLE asset_runtime;`);
  await assert.rejects(sql`ALTER TABLE creative_assets ADD COLUMN forbidden int`,{code:'42501'});
  const first=await upsertDriveAsset(sql,{id:'drive-fixture',name:'Original'});
  await sql`UPDATE creative_assets SET durable_url='https://example.test/retained' WHERE id=${first.id}`;
  const second=await upsertDriveAsset(sql,{id:'drive-fixture',name:'Renamed'});
  assert.equal(second.id,first.id);assert.equal(second.durable_url,'https://example.test/retained');
  const job=await claimManualCreativeAnalysis(sql,'asset-fixture');assert.ok(job);
  assert.equal(await claimManualCreativeAnalysis(sql,'asset-fixture'),null);
  assert.equal(await completeCreativeAnalysisJob(sql,'asset-fixture',{...job,lease_token:'wrong'}),false);
  assert.equal(await completeCreativeAnalysisJob(sql,'asset-fixture',job),true);
  const sync=await claimSync(sql,'fixture-sync',{phase:'metadata'});assert.ok(sync);
  assert.equal(await claimSync(sql,'fixture-sync',{phase:'metadata'}),null);
  await checkpointSync(sql,sync,{phase:'done'},true);
  assert.equal((await sql`SELECT state FROM app_sync_state WHERE name='fixture-sync'`)[0].state.phase,'done');
  await saveMapSettings(sql,{mapPrice:123,dealers:[],products:[],alertEmails:[],useSearch:false});
  const settings=await getMapSettings(sql);assert.equal(settings.mapPrice,123);assert.equal(settings.useSearch,false);
 }finally{await db.close();}
});
