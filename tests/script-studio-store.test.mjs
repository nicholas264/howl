import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { initializeSchema } from '../api/db/schema.js';
import { ensureGoogleOAuthTables, saveGoogleConnection } from '../api/_lib/google-user-oauth.js';
import { BREAKDOWN_LABELS, parseBreakdown } from '../api/_lib/script-studio.js';
import { scriptDocumentHtml } from '../api/_lib/script-studio-store.js';
import handler from '../api/script-studio.js';
import { googleReturnPath } from '../api/_lib/google-oauth-routing.js';
const brief={product:'r3',startingPoint:'fresh',delivery:'voiceover',duration:30};
const script={title:'Warmth <without> smoke',angle:'Camp warmth',strategy:'Explain radiant warmth.',script:'Still cold? Meet the R3. See HOWL.',cta:'See HOWL.',hooks:[1,2,3].map(n=>({spoken:`Opening ${n}`,next_line:'Meet the R3.',visual:'Camper outside',on_screen:'Radiant warmth'})),shot_list:[1,2,3,4].map(n=>({time:`${n}s`,visual:'R3 outside',on_screen:'HOWL'})),guardrails:['Follow the manual.']};
script.breakdown=Object.fromEntries(Object.keys(BREAKDOWN_LABELS).map(key=>[key,{used:key==='hook',quote:key==='hook'?'Still cold?':'',purpose:key==='hook'?'Recognize the problem.':'Not needed in this short ad.'}]));
script.breakdown_script=script.script;

test('shared versions, exact attribution, null metrics and idempotent verified Google Docs export',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),oldFetch=globalThis.fetch,previous={...process.env};
 Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@fixture.test/db',GOOGLE_TOKEN_ENCRYPTION_KEY_V2:'isolated-fixture-key',CLERK_SECRET_KEY:'sk_test_fixture',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture'});
 const sql=neon(process.env.DATABASE_URL);
 const call=async(method,body={},query={},status=200)=>{const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};await handler({method,body,query,headers:{}},res);assert.equal(res.statusCode,status,JSON.stringify(res.body));return res.body;};
 try{
  await initializeSchema(sql);await ensureGoogleOAuthTables(sql);
  const {saved:a}=await call('POST',{action:'save',brief,script},{},201);
  const {saved:again}=await call('POST',{action:'save',brief,script},{},201);assert.equal(a.id,again.id);
  const edited={...script,script:'Still cold? Meet the R3. Compare HOWL.',cta:'Compare HOWL.',breakdown_script:'Still cold? Meet the R3. Compare HOWL.'};
  const {saved:b}=await call('POST',{action:'save',brief,script:edited,parent_id:a.id},{},201);assert.notEqual(a.id,b.id);assert.equal(b.parent_id,a.id);
  const {saved:original}=await call('GET',{}, {action:'get',id:a.id});assert.equal(original.script.script,script.script);
  const list=await call('GET');assert.equal(list.scripts.length,2);
  await call('POST',{action:'save',brief,script:{...edited,breakdown_script:script.script}},{},400);
  await call('GET',{}, {action:'get',id:'invalid'},400);
  await sql`INSERT INTO launch_history(ad_id,ad_name) VALUES ('11111','Ad one'),('11111','Duplicate launch record'),('22222','Ad two'),('33333','Waiting for data')`;
  await sql`INSERT INTO creative_insights_daily(ad_id,date,spend,impressions,clicks,purchases,purchase_value,video_3s_views,video_thruplays) VALUES ('11111',current_date,100,1000,20,10,500,400,100),('22222',current_date,50,500,15,1,100,100,50),('11111',current_date-40,999,999,999,99,999,999,999)`;
  const empty=await call('GET',{}, {action:'performance',id:a.id,days:30});assert.equal(empty.totals.spend,null);
  await call('POST',{action:'link_ad',id:a.id,ad_id:'11111',hook_variant:'primary'});
  await call('POST',{action:'link_ad',id:a.id,ad_id:'22222',hook_variant:'first'});
  await call('POST',{action:'link_ad',id:a.id,ad_id:'33333',hook_variant:'primary'});
  await call('POST',{action:'link_ad',id:b.id,ad_id:'11111',hook_variant:'primary'},{},409);
  await call('POST',{action:'link_ad',id:b.id,ad_id:'99999',hook_variant:'primary'},{},400);
  const perf=await call('GET',{}, {action:'performance',id:a.id,days:30});
  assert.equal(perf.totals.spend,150,'launch duplicates must not multiply spend');assert.equal(perf.totals.purchases,11);assert.equal(perf.totals.cpa,150/11);assert.equal(perf.totals.roas,4);assert.equal(perf.totals.hook_rate,500/1500);assert.equal(perf.totals.hold_rate,150/500);assert.equal(perf.ads.find(a=>a.ad_id==='33333').spend,null);assert.equal(perf.variants.length,2);
  const wide=await call('GET',{}, {action:'performance',id:a.id,days:90});assert.equal(wide.totals.spend,1149);
  await call('GET',{}, {action:'performance',id:a.id,days:365},400);
  await call('POST',{action:'unlink_ad',id:a.id,ad_id:'22222'});
  assert.equal((await call('GET',{}, {action:'performance',id:a.id})).totals.spend,100);
  await call('POST',{action:'export_docs',id:a.id},{},409);
  await saveGoogleConnection(sql,{userId:'local-dev',refreshToken:'fixture-refresh',scopes:['https://www.googleapis.com/auth/drive.file']});
  let uploads=0,reads=0,uncertain=false;
  globalThis.fetch=async(url,init)=>{
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access'});
   if(String(url).includes('/upload/drive/')){uploads++;assert.match(init.body,/application\/vnd.google-apps.document/);assert.match(init.body,/Warmth &lt;without&gt; smoke/);assert.match(init.body,/Problem mechanism/);assert.match(init.body,new RegExp(a.id));if(uncertain)throw new Error('Connection lost after upload');return Response.json({id:'fixture-doc',name:'HOWL brief',webViewLink:'https://docs.google.com/document/d/fixture-doc/edit',mimeType:'application/vnd.google-apps.document'});}
   if(String(url).includes('/drive/v3/files/fixture-doc')){reads++;return Response.json({id:'fixture-doc',mimeType:'application/vnd.google-apps.document',trashed:false});}
   throw new Error('Unexpected external request');
  };
  const doc=await call('POST',{action:'export_docs',id:a.id});assert.match(doc.document.url,/docs.google.com/);
  await call('POST',{action:'export_docs',id:a.id});assert.equal(uploads,1,'retry does not duplicate the document');assert.equal(reads,2,'each response verifies the document');
  // Simulate an uncertain create for a different saved version. Retrying must not upload again.
  uncertain=true;
  globalThis.fetch=async(url)=>{if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access'});uploads++;throw new Error('Connection lost after upload');};
  await call('POST',{action:'export_docs',id:b.id},{},500);await call('POST',{action:'export_docs',id:b.id},{},409);assert.equal(uploads,2);
  process.env.NODE_ENV='production';await call('POST',{action:'save',brief,script},{},401);
 }finally{globalThis.fetch=oldFetch;restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});

test('breakdowns quote exact script text and exports escape user content',()=>{
 assert.throws(()=>parseBreakdown({...script.breakdown,hook:{used:true,quote:'Invented claim',purpose:'Bad'}},script.script),/actual script/);
 const html=scriptDocumentHtml({id:'version',product:'r3',delivery:'voiceover',brief,script,created_at:'2026-09-23'});assert.ok(!html.includes('<without>'));assert.match(html,/What each part does/);assert.match(html,/Solution mechanism/);
 assert.equal(googleReturnPath('script_studio'),'/?tab=script-studio&drive_connected=1');assert.equal(googleReturnPath('script_studio','scope_not_granted'),'/?tab=script-studio&drive_error=scope_not_granted');
});
