import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { blankWorkspace, normalizeWorkspace, normalizeAsset, generateConcepts, conceptFingerprint, containRect, designGeometry, DIRECTIONS, applyArtDirectionRepair } from '../src/lib/static-studio/model.js';
import { loadStudio, saveStudio } from '../api/_lib/static-studio-store.js';
import { folderId } from '../api/static-studio.js';
const fixture=(id='r1')=>({id:`asset-${id}`,url:`https://test.public.blob.vercel-storage.com/${id}.png`,name:`${id}.png`,sha256:'a'.repeat(64),width:2400,height:1800,productId:id,approved:true,role:'product',features:[],notes:'',analysis:''});
function workspace(){return {...blankWorkspace(),assets:['r1','r3','r4mkii'].map(fixture)};}

test('batch covers each selected product in grounded, distinct concepts',()=>{
 const w=workspace(),concepts=generateConcepts(w);assert.equal(concepts.length,9);
 for(const id of w.selectedProducts){const rows=concepts.filter(c=>c.productId===id);assert.equal(rows.length,3);assert.equal(new Set(rows.map(c=>c.headline)).size,3);assert.ok(rows.every(c=>c.assetId===`asset-${id}`));}
 assert.equal(new Set(concepts.map(c=>c.id)).size,9);
});
test('unapproved or reference photographs never become product creatives',()=>{
 const w=workspace();w.assets[0].approved=false;w.assets[1].role='reference';const concepts=generateConcepts(w);assert.equal(concepts.length,3);assert.ok(concepts.every(c=>c.productId==='r4mkii'));
});
test('model choices cannot cross product identity or invent copy and callout anchors',()=>{
 const w=workspace();w.direction='technical';const c=generateConcepts(w,[{productId:'r1',assetId:'asset-r4mkii',copyId:'made-up-discount',direction:'technical'}])[0];
 assert.equal(c.assetId,'asset-r1');assert.equal(c.direction,'field');assert.equal(c.featureName,'');assert.equal(c.headline,'Pack small.\nStay out.');
 w.assets[0].features=[{name:'Gullwing Legs',x:.4,y:.6,approved:true}];assert.equal(generateConcepts(w)[0].featureName,'Gullwing Legs');
});
test('product feature validation rejects anchors from another product and out-of-frame coordinates',()=>{
 assert.throws(()=>normalizeAsset({...fixture(),features:[{name:'Jackknife Folding Legs',x:.5,y:.5}]}),/does not belong/);
 assert.throws(()=>normalizeAsset({...fixture(),features:[{name:'Gullwing Legs',x:1.1,y:.5}]}),/inside/);
 assert.throws(()=>normalizeAsset({...fixture(),features:[{name:'Gullwing Legs',x:NaN,y:.5}]}),/inside/);
});
test('any design or asset approval change invalidates render and approval on save',()=>{
 const w=workspace();const c=generateConcepts(w)[0],fingerprint=conceptFingerprint(c,w.assets[0]);
 c.render={fingerprint,feedUrl:'https://test.public.blob.vercel-storage.com/feed.png',storyUrl:'https://test.public.blob.vercel-storage.com/story.png',checks:[]};c.approval={fingerprint,at:'2026-09-06'};c.review={fingerprint,summary:'Pass',verdict:'pass',issues:[]};w.concepts=[c];
 assert.ok(normalizeWorkspace(w).concepts[0].approval);
 for(const patch of [{headline:'Edited headline'},{scale:1.1},{storyAlign:'center'},{cta:'New CTA'},{direction:'field'}]) assert.equal(normalizeWorkspace({...w,concepts:[{...c,...patch}]}).concepts[0].approval,undefined);
 assert.equal(normalizeWorkspace({...w,assets:w.assets.map(a=>({...a,approved:false}))}).concepts[0].render,undefined);
});
test('server validation rejects local URLs, unsupported products, oversized images and duplicate identities',()=>{
 assert.throws(()=>normalizeAsset({...fixture(),url:'http://127.0.0.1/private'}),/media store/);
 assert.throws(()=>normalizeAsset({...fixture(),url:'data:image/png;base64,a'}),/media store/);
 assert.throws(()=>normalizeAsset({...fixture(),productId:'r99'}),/Unknown product/);
 assert.throws(()=>normalizeAsset({...fixture(),width:50000,height:50000}),/dimensions/);
 const w=workspace();w.assets.push(w.assets[0]);assert.throws(()=>normalizeWorkspace(w),/Duplicate asset/);
});
test('geometry preserves full photographs and keeps independent format regions separated',()=>{
 const w=workspace(),c=generateConcepts(w)[0];
 for(const direction of DIRECTIONS.filter(d=>d.id!=='scene'))for(const format of ['feed','story']){
 const g=designGeometry({...c,direction:direction.id},format);
 assert.ok(g.photo.x>=g.headline.x+g.headline.w || g.photo.y>=g.headline.y+g.headline.h || g.headline.y>=g.photo.y+g.photo.h);assert.ok(g.photo.h>200);assert.ok(g.body.y+g.body.h<=g.footerY-24);assert.ok(g.footerY+26<=g.h-g.bottom);
 for(const [iw,ih] of [[2400,1800],[1800,2400],[4000,900],[500,500]]){
 const r=containRect(iw,ih,g.photo);assert.ok(Math.abs(r.w/r.h-iw/ih)<1e-9);assert.ok(r.x>=g.photo.x-1e-9 && r.y>=g.photo.y-1e-9);assert.ok(r.x+r.w<=g.photo.x+g.photo.w+1e-9 && r.y+r.h<=g.photo.y+g.photo.h+1e-9);
 }
 }
 assert.notEqual(designGeometry(c,'feed').photo.h,designGeometry(c,'story').photo.h);
});
test('capacity limits never silently discard existing creative work',()=>{
 const w=workspace();w.concepts=Array.from({length:119},()=>({}));assert.throws(()=>generateConcepts(w),/exceed 120/);
});
test('Drive folder parsing accepts canonical links and rejects injected queries',()=>{
 assert.equal(folderId('https://drive.google.com/drive/u/0/folders/abcdefghijk?usp=sharing'),'abcdefghijk');
 assert.equal(folderId('abcdefghijk'),'abcdefghijk');
 for(const s of ["abc' or trashed=true",'https://evil.test/abcdefghijk','abc'])assert.throws(()=>folderId(s));
});
test('studio persistence is isolated per user and rejects stale concurrent writes',async()=>{
 const db=new PGlite();const sql=async(parts,...values)=>(await db.query(parts.reduce((t,p,i)=>t+(i?`$${i}`:'')+p,''),values)).rows;
 try {
 assert.equal((await loadStudio(sql,'owner-a')).revision,0);
 const first=await saveStudio(sql,'owner-a',workspace(),0);assert.equal(first.revision,1);
 assert.equal((await loadStudio(sql,'owner-b')).payload.assets.length,0);
 const writes=await Promise.allSettled([saveStudio(sql,'owner-a',{...workspace(),brief:'First edit'},1),saveStudio(sql,'owner-a',{...workspace(),brief:'Concurrent edit'},1)]);
 assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.find(r=>r.status==='rejected').reason.status,409);
 assert.equal((await loadStudio(sql,'owner-a')).revision,2);
 await assert.rejects(saveStudio(sql,'owner-a',workspace(),0),/another tab/);
 }finally{await db.close();}
});


test('art director repairs stay within grounded copy and reset prior approval',()=>{
 const w=workspace(),c=generateConcepts(w)[0];c.approval={fingerprint:'old'};
 const repair={copyId:'r1-pack',direction:'field',scale:.95,align:'left',storyAlign:'center',reason:'Improve hierarchy'};
 const next=applyArtDirectionRepair(c,w.assets[0],repair);assert.equal(next.approval,undefined);assert.equal(next.assetId,c.assetId);assert.equal(next.productId,c.productId);assert.equal(next.scale,.95);
 for(const patch of [{copyId:'r4-cold'},{direction:'technical'},{scale:10},{align:'anything'}])assert.throws(()=>applyArtDirectionRepair(c,w.assets[0],{...repair,...patch}));
});

test('AI art direction rejects partial batches and cross-product substitutions rather than silently composing defaults',async()=>{
 const {validateArtDirectorPlan,artDirectorVisualAssets,COPY}=await import('../src/lib/static-studio/model.js');
 const w=workspace();w.count=1;
 const ideas=[['The trunk gets a plus-one.','Packing rituals make a small campfire feel like another member of the trip.'],['Nobody called last call.','A late campsite conversation borrows the language of closing time.'],['The chairs moved closer.','An intimate gathering becomes the visual expression of connection.']];
 const choices=w.selectedProducts.map((id,i)=>({productId:id,assetId:`asset-${id}`,headline:ideas[i][0],body:'',cta:'Explore HOWL',angle:`Idea ${i}`,premise:ideas[i][1],visualIdea:'Use the original photograph with a short readable headline.',claimIds:[],direction:'expedition',rationale:'Original photograph leads.'}));
 assert.equal(validateArtDirectorPlan(w,choices).length,3);
 assert.throws(()=>validateArtDirectorPlan(w,choices.slice(0,2)),/incomplete batch/);
 assert.throws(()=>validateArtDirectorPlan(w,[{...choices[0],assetId:'asset-r3'},...choices.slice(1)]),/not approved/);
 assert.throws(()=>validateArtDirectorPlan({...w,direction:'field'},choices),/selected layout/);
 w.assets.unshift(...Array.from({length:6},(_,i)=>({...fixture(),id:`extra-${i}`})));
 const visuals=artDirectorVisualAssets(w);assert.equal(visuals.length,9);assert.deepEqual(new Set(visuals.map(a=>a.productId)),new Set(w.selectedProducts));
});


test('original creative copy survives generation and persistence without a copy-bank substitution',async()=>{
 const {validateArtDirectorPlan}=await import('../src/lib/static-studio/model.js');
 const w=workspace();w.selectedProducts=['r1'];w.count=1;
 const idea={productId:'r1',assetId:'asset-r1',headline:'The trunk gets a plus-one.',body:'',cta:'Explore the R1',angle:'An extra passenger',premise:'The packing ritual becomes a playful invitation to bring a campfire.',visualIdea:'A packed car and restrained copy make the fire feel like a travel companion.',claimIds:['identity'],direction:'field',rationale:'A concrete packing moment.'};
 const choices=validateArtDirectorPlan(w,[idea]);w.concepts=generateConcepts(w,choices);
 assert.equal(w.concepts[0].headline,idea.headline);assert.equal(w.concepts[0].body,'');
 assert.equal(normalizeWorkspace(w).concepts[0].premise,idea.premise);
 assert.throws(()=>validateArtDirectorPlan(w,[idea]),/recycled/);
 assert.throws(()=>validateArtDirectorPlan({...w,concepts:[]},[{...idea,headline:'Save 50% today'}]),/unsupported measurable/);
 assert.throws(()=>validateArtDirectorPlan({...w,concepts:[]},[{...idea,claimIds:['imaginary-proof']}]),/not verified/);
 assert.throws(()=>validateArtDirectorPlan({...w,concepts:[]},[{...idea,headline:undefined,copyId:'r1-pack'}]),/original headline/);
});
test('scene cropping preserves approved product bounds or rejects the placement',async()=>{
 const {scenePhotoRect,normalizeProtectedRegion}=await import('../src/lib/static-studio/model.js');
 const a={...fixture(),width:1800,height:2400,protectedRegion:{x:.3,y:.4,w:.3,h:.35,approved:true}};
 for(const box of [{x:0,y:0,w:1080,h:1350},{x:0,y:0,w:1080,h:1920}]){
   const r=scenePhotoRect(a,box);assert.ok(Math.abs(r.w/r.h-a.width/a.height)<1e-9);
   assert.ok(r.protectedBox.x>=0 && r.protectedBox.y>=0 && r.protectedBox.x+r.protectedBox.w<=box.w && r.protectedBox.y+r.protectedBox.h<=box.h);
 }
 assert.throws(()=>scenePhotoRect({...a,protectedRegion:{...a.protectedRegion,approved:false}},{x:0,y:0,w:1080,h:1920}),/confirm/);
 assert.throws(()=>scenePhotoRect({...a,protectedRegion:{x:0,y:0,w:1,h:1,approved:true}},{x:0,y:0,w:1080,h:1920}),/cropping/);
 assert.throws(()=>normalizeProtectedRegion({x:.8,y:.2,w:.5,h:.2}),/inside/);
 const w=workspace();w.assets[0]=a;const c=generateConcepts(w)[0];
 assert.notEqual(conceptFingerprint(c,a),conceptFingerprint(c,{...a,protectedRegion:{...a.protectedRegion,x:.31}}));
});
