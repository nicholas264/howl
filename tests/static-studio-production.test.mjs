import test from 'node:test';
import assert from 'node:assert/strict';
import { finishStudioBatch } from '../src/lib/static-studio/batch.js';
import { normalizeComposition } from '../src/lib/static-studio/composition.js';
import { designGeometry, conceptFingerprint, normalizeAssessment } from '../src/lib/static-studio/model.js';
import { productClaimConflicts } from '../src/lib/productClaims.js';

const layout=()=>({feed:{photo:{x:48,y:420,w:984,h:656},headline:{x:72,y:166,w:936,h:224},body:{x:72,y:1120,w:936,h:60},headlineSize:92,bodySize:32},story:{photo:{x:48,y:340,w:984,h:656},headline:{x:72,y:1040,w:936,h:320},body:{x:72,y:1430,w:936,h:90},headlineSize:116,bodySize:34}});
test('art direction controls both exported geometries; layout changes invalidate approval',()=>{
  const c={direction:'field',align:'left',storyAlign:'center',composition:normalizeComposition(layout())};
  assert.deepEqual(designGeometry(c,'feed').photo,c.composition.feed.photo);
  assert.deepEqual(designGeometry(c,'story').headline,c.composition.story.headline);
  assert.equal(designGeometry(c,'story').align,'center');
  const changed=structuredClone(c);changed.composition.feed.headlineSize=94;
  assert.notEqual(conceptFingerprint(c,{}),conceptFingerprint(changed,{}));
  const overlap=layout();overlap.feed.headline.y=450;
  assert.throws(()=>normalizeComposition(overlap),/overlap/);
  const unsafe=layout();unsafe.story.photo.y=100;
  assert.throws(()=>normalizeComposition(unsafe),/composition area/);
});
test('resume skips passed pairs, continues after isolated failures and stops on billing limits',async()=>{
  const rows=[{id:'passed',review:{verdict:'pass'}},{id:'bad'},{id:'good'},{id:'quota'},{id:'after'}],calls=[];
  const result=await finishStudioBatch({ids:rows.map(c=>c.id),latest:async id=>rows.find(c=>c.id===id),cancelled:()=>false,onProgress:()=>{},finish:async c=>{
    calls.push(c.id);if(c.id==='bad')throw new Error('Photo could not load');if(c.id==='quota')throw new Error('Insufficient credits');return {...c,review:{verdict:'pass'}};
  }});
  assert.deepEqual(calls,['bad','good','quota']);assert.equal(result.passed,2);assert.equal(result.failed.length,2);assert.equal(result.stopReason,'Insufficient credits');
});
test('product suggestions never become approval and warnings survive normalization',()=>{
  const assessment=normalizeAssessment({suggestedProductId:'r3',approved:true,productCount:'multiple',completeProduct:false,uncertainties:['Two units visible.']});
  assert.equal(assessment.approved,undefined);assert.deepEqual(assessment.uncertainties,['Two units visible.']);
});
test('database JSON key ordering cannot invalidate an unchanged render',()=>{
  const c={direction:'field',composition:normalizeComposition(layout())},a={approved:true,productId:'r3',protectedRegion:{x:.2,y:.3,w:.4,h:.5,approved:false},features:[{name:'Gullwing Legs',x:.4,y:.7,approved:true}]};
  const reorder=v=>Array.isArray(v)?v.map(reorder):v && typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
  assert.equal(conceptFingerprint(c,a),conceptFingerprint(reorder(c),reorder(a)));
  const changed=structuredClone(a);changed.protectedRegion.x=.21;
  assert.notEqual(conceptFingerprint(c,a),conceptFingerprint(c,changed));
});
test('conflicting weights are caught even after a matching claim; tank capacity is not product weight',()=>{
  assert.equal(productClaimConflicts('r1','11 pounds. Runs on a 20 lb tank.').length,0);
  assert.equal(productClaimConflicts('r1','11 lbs packed. Also weighs 10 pounds.').length,1);
  assert.equal(productClaimConflicts('r3','19.6 lbs. Uses a 20 lb propane tank.').length,0);
});
