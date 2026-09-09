import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeTestIntent,validateCreativeTestAssets} from '../src/lib/creative-test-intent.js';
const settings={testName:'Test',dailyBudgetDollars:'20.01',costCapCents:2500,pixelId:'123456789012345678',pageId:'1234',destUrl:'https://example.com/product'};
test('creative test intent rejects malformed spending and preserves provider IDs',()=>{
  const result=creativeTestIntent(settings);
  assert.equal(result.adset.daily_budget,'2001');
  assert.equal(result.adset.bid_amount,'2500');
  assert.equal(result.adset.promoted_object.pixel_id,settings.pixelId);
  assert.equal(result.campaign.status,'PAUSED');
  assert.equal(result.adset.status,'PAUSED');
  for(const value of ['0','-1','20junk','Infinity','NaN','1.001','',null]) assert.throws(()=>creativeTestIntent({...settings,dailyBudgetDollars:value}));
  for(const value of [0,-1,NaN,Infinity,1.2,'20junk',null]) assert.throws(()=>creativeTestIntent({...settings,costCapCents:value}));
  for(const destUrl of ['javascript:alert(1)','http://example.com','https://user:pass@example.com']) assert.throws(()=>creativeTestIntent({...settings,destUrl}));
});
test('creative test assets require stable unique identities and complete media before writes',()=>{
  validateCreativeTestAssets([{id:'a',name:'Same',imageHash:'one'},{id:'b',name:'Same',type:'video',videoId:'two'}]);
  for(const items of [[],[{id:'a'}],[{id:'a',imageHash:'x'},{id:'a',imageHash:'y'}],[{id:'a',imageHash:'x',storyUrl:'https://example.com/story'}],[{id:'a',type:'carousel',cardHashes:['one']}],[{id:'a',type:'video',imageHash:'wrong'}]]) assert.throws(()=>validateCreativeTestAssets(items));
});
test('actual creative-test dispatch rejects invalid settings before campaign creation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../api/meta.js',import.meta.url),'utf8');
  const start=source.indexOf("case 'create_creative_test': {")+"case 'create_creative_test': {".length;
  const end=source.indexOf("case 'get_cpa_analysis':",start);
  const body=source.slice(start,end).trim().replace(/}\s*$/,'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const dispatch=new AsyncFunction('req','res','defaultPageId','creativeTestIntent','validateCreativeTestAssets','fetch',body);
  for(const patch of [{dailyBudgetDollars:'-10'},{costCapCents:NaN},{items:[{id:'a',type:'video'}]}]){
    let code,output,calls=0;
    const res={status(value){code=value;return this;},json(value){output=value;return value;}};
    await dispatch({body:{...settings,items:[{id:'a',imageHash:'x'}],...patch}},res,'',creativeTestIntent,validateCreativeTestAssets,()=>{calls++;throw new Error('Unexpected provider write');});
    assert.equal(code,400);assert.equal(output.step,'validate');assert.equal(calls,0);
  }
});
