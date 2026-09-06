// Isolated UI → actual API handlers → PostgreSQL → PNG → launcher smoke test.
// Provider boundaries use fixtures. Never contacts Meta, Drive, Blob or live DB.
// STUDIO_QA_RUNTIME: directory containing playwright and sharp packages.
// STUDIO_QA_ASSETS: directory containing r1.jpg, r3.jpg, r4mkii.jpg originals.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PGlite } from '@electric-sql/pglite';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import studioHandler from '../api/static-studio.js';
import { applyArtDirectionRepair, COPY } from '../src/lib/static-studio/model.js';
import draftsHandler from '../api/launch-drafts.js';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const runtime=process.env.STUDIO_QA_RUNTIME;
if(!runtime)throw new Error('Set STUDIO_QA_RUNTIME to the bundled node_modules directory.');
const {chromium}=require(path.join(runtime,'playwright'));
const sharp=require(path.join(runtime,'sharp'));
const output=process.env.STUDIO_QA_ASSETS || '/private/tmp/howl-static-qa';
await fs.mkdir(output,{recursive:true});
process.env.NODE_ENV='development';process.env.AUTH_DISABLED='true';process.env.DATABASE_URL='postgresql://test:test@fixture.local/test';
const db=new PGlite(),restore=useTestDatabase(db),uploads=new Map(),requests=[];
let server,browser;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import StaticStudio from '/src/components/static-studio/StaticStudio.jsx';import Launcher from '/src/components/LauncherTool.jsx';import {loadLaunchDrafts,persistLaunchDraft} from '/src/lib/launchDrafts.js';import '/src/styles.css';
function Harness(){const [launch,setLaunch]=React.useState(false),[cart,setCart]=React.useState([]);React.useEffect(()=>{loadLaunchDrafts().then(setCart)},[]);return launch?<Launcher cart={cart}/>:<StaticStudio onOpenLauncher={()=>setLaunch(true)} onAddToCart={async item=>{const saved=await persistLaunchDraft(item);setCart(c=>[saved,...c.filter(row=>row.id!==saved.id)])}}/>}createRoot(document.getElementById('root')).render(<Harness/>);`;
try {
 server=await createServer({configFile:false,root:process.cwd(),envDir:path.join(output,'empty-env'),define:{'import.meta.env.VITE_AUTH_DISABLED':'"true"'},plugins:[react(),{name:'isolated-studio-fixture',resolveId(id){if(id==='/fixture.jsx')return path.join(process.cwd(),'__static_qa__.jsx');},load(id){if(id===path.join(process.cwd(),'__static_qa__.jsx'))return entry;},configureServer(s){s.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(await s.transformIndexHtml('/', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/fixture.jsx"></script></body></html>'));}
  if(!url.pathname.startsWith('/api/'))return next();
  const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};req.query=Object.fromEntries(url.searchParams);
  res.status=n=>{res.statusCode=n;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  requests.push({path:url.pathname,action:req.body.action});
  if(url.pathname==='/api/static-studio') {
    if(req.body.action==='direct')return res.json({choices:[]});
    if(req.body.action==='review'){const row=(await db.query('SELECT payload FROM static_studios')).rows[0];const c=row.payload.concepts.find(c=>c.id===req.body.conceptId);return res.json({review:{fingerprint:c.render.fingerprint,verdict:c.scale===.95?'pass':'revise',summary:'Fixture visual review; not a live provider assessment.',issues:c.scale===.95?[]:['Reduce type size slightly.']}});}
    if(req.body.action==='refine'){const row=(await db.query('SELECT payload FROM static_studios')).rows[0];const c=row.payload.concepts.find(c=>c.id===req.body.conceptId);return res.json({concept:applyArtDirectionRepair(c,row.payload.assets.find(a=>a.id===c.assetId),{copyId:COPY[c.productId][0].id,direction:c.direction,scale:.95,align:'left',storyAlign:'left',reason:'Fixture refinement based on critique.'})});}
    if(req.body.action==='drive-list')return res.json({files:[{id:'fixture_folder_1',name:'R1 photographs',mimeType:'application/vnd.google-apps.folder'},{id:'fixture_image_1',name:'r1.jpg',mimeType:'image/jpeg',size:'50000'}]});
    return studioHandler(req,res);
  }
  if(url.pathname==='/api/launch-drafts')return draftsHandler(req,res);
  if(url.pathname==='/api/blob/upload-token')return res.json({clientToken:'fixture-only-token'});
  return res.json({creators:[],files:[],campaigns:[],pages:[],variants:[],settings:{},adsets:[],data:[]});
 });}}],server:{host:'127.0.0.1',port:5189,strictPort:true}});
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.STUDIO_QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, PUT, OPTIONS','access-control-allow-headers':'*','cross-origin-resource-policy':'cross-origin'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.hostname==='blob.vercel-storage.com'){
    const id=String(uploads.size+1),blobUrl=`https://fixture.public.blob.vercel-storage.com/${id}`;
    uploads.set(blobUrl,{bytes:request.postDataBuffer(),type:request.headers()['x-content-type'] || 'image/png'});
    return route.fulfill({json:{url:blobUrl},headers});
  }
  if(uploads.has(request.url())){const file=uploads.get(request.url());return route.fulfill({body:file.bytes,contentType:file.type,headers});}
  return route.abort();
 });
 await page.goto('http://127.0.0.1:5189/');
 await page.getByRole('heading',{name:'Your source material'}).waitFor();
 await page.screenshot({path:path.join(output,'01-empty-studio.png'),fullPage:true});
 for(const id of ['r1','r3','r4mkii']) {
   const bytes=await fs.readFile(path.join(output,`${id}.jpg`));const metadata=await sharp(bytes).metadata();
   await page.locator('input[type=file]').setInputFiles({name:`${id}.png`,mimeType:'image/png',buffer:bytes});
   await page.getByLabel('Product in this photograph').waitFor();
   await page.waitForFunction(()=>!document.querySelector('.ss-work').disabled);
   await page.getByLabel('Product in this photograph').selectOption(id);
   await page.getByLabel('I verified this is the selected product').check();
   assert.ok(metadata.width>=1080);
 }
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.ss-work').disabled);
 // Render every art direction against every real product source, in both ratios.
 const renderMatrix=await page.evaluate(async()=>{
   const {renderPair}=await import('/src/lib/static-studio/render.js');
   const {generateConcepts,DIRECTIONS}=await import('/src/lib/static-studio/model.js');
   const {payload}=await (await fetch('/api/static-studio')).json();
   const concepts=generateConcepts({...payload,count:1}),results=[];
   for(const c of concepts)for(const d of DIRECTIONS.filter(d=>d.id!=='scene')){
     const source=payload.assets.find(a=>a.id===c.assetId);
     source.features=[{name:c.productId==='r4mkii'?'Jackknife Folding Legs':'Gullwing Legs',x:.5,y:.8,approved:true}];
     const pair=await renderPair({...c,direction:d.id,featureName:source.features[0].name},source);
     results.push({product:c.productId,direction:d.id,errors:pair.checks.filter(c=>c.level==='error')});
   }
   return results;
 });
 assert.equal(renderMatrix.length,12,'Every product must be tested in all four art directions.');
 assert.deepEqual(new Set(renderMatrix.map(row=>row.product)),new Set(['r1','r3','r4mkii']));
 assert.deepEqual(renderMatrix.flatMap(row=>row.errors),[]);
 await fs.writeFile(path.join(output,'render-matrix.json'),JSON.stringify(renderMatrix,null,2));
 await page.getByRole('button',{name:'Art direction',exact:true}).click();
 await page.getByLabel('Creative brief').fill('Fall camping. Short copy. Bold photography. Distinct ideas for each product.');
 await page.getByLabel('Concepts per product').selectOption('2');
 await page.getByRole('button',{name:'Manual layout samples'}).click();
 await page.getByRole('heading',{name:'The contact sheet'}).waitFor();
 await page.locator('.ss-pair img').first().waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.ss-pair img').length===2);
 await page.screenshot({path:path.join(output,'02-paired-workbench.png'),fullPage:true});
 assert.equal(await page.locator('.ss-concept-card').count(),6);
 assert.equal(await page.locator('.ss-check-error').count(),0);
 // Exercise R3, not the default R1, to catch launcher product/copy regression.
 await page.locator('.ss-concept-card').filter({hasText:'R3 / Expedition'}).click();
 await page.getByRole('button',{name:'Save paired renders',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Both exports saved.'}).waitFor();
 await page.getByRole('button',{name:'Run visual review',exact:true}).click();
 await page.getByRole('heading',{name:'Revisions recommended',exact:true}).waitFor();
 await page.getByRole('button',{name:'Refine with art director',exact:true}).click();
 await page.getByRole('heading',{name:'Visual review passed',exact:true}).waitFor();
 await page.getByRole('button',{name:'I reviewed both — approve pair'}).click();
 await page.getByRole('button',{name:'Send pair to launcher',exact:true}).click();
 await page.getByRole('button',{name:'Saved in launcher',exact:true}).waitFor();
 const draft=(await db.query('SELECT payload FROM launch_drafts')).rows[0].payload;
 assert.equal(draft.product,'r3');assert.equal(draft.headline,'Stay for another season.');assert.notEqual(draft.squareUrl,draft.storyUrl);
 assert.equal((await sharp(uploads.get(draft.squareUrl).bytes).metadata()).height,1350);
 assert.equal((await sharp(uploads.get(draft.storyUrl).bytes).metadata()).height,1920);
 await fs.writeFile(path.join(output,'r3-feed.png'),uploads.get(draft.squareUrl).bytes);await fs.writeFile(path.join(output,'r3-story.png'),uploads.get(draft.storyUrl).bytes);
 await page.screenshot({path:path.join(output,'before-edit.png'),fullPage:true});
 await fs.writeFile(path.join(output,'before-edit.txt'),await page.locator('body').innerText());
 await page.getByLabel('Headline',{exact:true}).fill('A changed headline.');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.ss-work').disabled);
 const studio=(await db.query('SELECT payload FROM static_studios')).rows[0].payload;
 assert.equal(studio.concepts.find(c=>c.id===draft.staticStudioConceptId).approval,undefined);
 await page.reload();await page.getByRole('heading',{name:'Your source material'}).waitFor();
 assert.equal(await page.locator('.ss-asset').count(),3);
 await page.getByRole('button',{name:'Contact sheet',exact:false}).click();assert.equal(await page.locator('.ss-concept-card').count(),6);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'03-mobile-sheet.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 await page.setViewportSize({width:1500,height:1100});await page.getByRole('button',{name:'Open launcher',exact:true}).click();
 await page.getByText('R3 / Shoulder season / Expedition',{exact:false}).first().waitFor();
 await page.screenshot({path:path.join(output,'04-launcher.png'),fullPage:true});
 assert.ok((await page.locator('select').evaluateAll(selects=>selects.map(s=>s.value))).includes('r3'));
 assert.ok(await page.locator('input').evaluateAll(inputs=>inputs.some(i=>i.value==='Stay for another season.')));
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({status:'passed',concepts:6,placements:12,actualDatabase:true,providerBoundaries:'fixture only',checks:['original imports','product confirmation','batch composition','actual Canvas exports','persist and reload','approval invalidation','bounded critique and refinement','paired launcher handoff','R3 destination and copy','mobile overflow','browser exceptions'],requests},null,2));
 console.log(`Static Studio browser verification passed. Artifacts: ${output}`);
}finally{await browser?.close();await server?.close();restore();await db.close();}
