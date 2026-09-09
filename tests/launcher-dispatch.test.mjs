import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {productClaimConflicts} from '../src/lib/productClaims.js';

// Exercise the actual component callbacks through their first request. The
// provider boundary deliberately stops here; this never uploads or launches.
const source=await readFile(new URL('../src/components/LauncherTool.jsx',import.meta.url),'utf8');
for(const name of ['launchDriveItem','launchCartItem']) {
  test(`${name} reaches its request with valid copy and blocks conflicting claims`,async()=>{
    const start=source.indexOf(`  const ${name} = async `);
    const end=source.indexOf('\n  };',start);
    assert.ok(start>=0&&end>start,'component callback is available');
    const callback=source.slice(start,end+5);
    for(const [headline,allowed] of [['Portable campfire',true],['A 999 lb campfire',false]]) {
      const calls=[],states=[];
      const context={
        meta:{fixture:{headline,primaryText:'Ready for the campsite',productId:'r1',sourceType:'tool_generated'}},
        sourceConfig:()=>({value:'tool_generated',label:'Made in tool'}),
        selectedAdsetId:'adset',selectedCampaignId:'campaign',config:{pageId:'page'},
        destUrlForMeta:()=> 'https://example.test/product',urlParamsForMeta:()=> 'source=fixture',
        setGlobalError:message=>states.push(message),setItemStatus:(_id,_status,message)=>states.push(message),
        setStatuses:()=>{},setStep:()=>{},productClaimConflicts,
        fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});throw new Error('Fixture provider boundary');},
      };
      const launch=vm.runInNewContext(`${callback}\n${name}`,context);
      await launch({unifiedId:'fixture',id:'file',type:'image',url:'https://example.test/image.png'},{adName:'Fixture ad'});
      assert.equal(calls.length,allowed?1:0);
      assert.ok(states.some(message=>allowed?message==='Fixture provider boundary':message?.includes('Weight claim conflicts')));
      if(allowed)assert.equal(calls[0].body.action,name==='launchDriveItem'?'launch_meta_ad':'upload_image');
    }
  });
}

test('Launcher prepares read-only review, freezes fields and refuses changed state at confirmation',async()=>{
  const extract=name=>{const start=source.indexOf(`  const ${name} = async `),end=source.indexOf('\n  };',start);assert.ok(start>=0&&end>start);return source.slice(start,end+5);};
  const item={unifiedId:'fixture',source:'cart',type:'image',url:'https://example.test/image.png'};
  let state,closed=false,launched;const calls=[];
  const context={AbortController,setTimeout,clearTimeout,JSON,Number,Object,
    config:{namingMode:'existing_adset',pageId:'page'},selectedCampaignId:'campaign',selectedAdsetId:'adset',batchAdsetBudget:10,effectiveObjective:'OUTCOME_TRAFFIC',
    meta:{fixture:{headline:'Title',primaryText:'Copy',sourceType:'tool_generated'}},
    sourceConfig:()=>({value:'tool_generated'}),canLaunchItem:()=>true,launchWarningsForItem:()=>[],
    buildNamesForItem:()=>({adName:'Ad'}),destUrlForMeta:()=> 'https://example.test/product',urlParamsForMeta:()=>'',
    reviewController:{current:null},reviewFingerprint:()=> 'unchanged',setGlobalError:()=>{},setPreflightIds:()=>{},
    setReviewState:value=>{state=typeof value==='function'?value(state):value;},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({approval_hash:'a'.repeat(64),media:[{role:'single',url:item.url,sha256:'b'.repeat(64)}],approvals:[null],adset:{id:'adset',targeting:{age_min:18}}})};},
    closeReview:()=>{closed=true;},launchOne:async(asset,plan)=>{launched={asset,plan};},preflightItems:[item],
  };
  const prepare=vm.runInNewContext(`${extract('requestPreflight')}\nrequestPreflight`,context);
  await prepare([item]);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/launch-review');
  assert.deepEqual(calls[0].body.input.items,[{imageUrl:item.url}]);assert.equal(state.loading,false);assert.equal(state.rows[0].plan.confirmed,false);
  assert.equal(state.rows[0].plan.fields.primary_text,'Copy');context.meta.fixture.primaryText='Changed';assert.equal(state.rows[0].plan.fields.primary_text,'Copy');
  context.reviewState=state;context.reviewFingerprint=()=> 'changed';
  const confirm=vm.runInNewContext(`${extract('confirmPreflight')}\nconfirmPreflight`,context);
  await confirm();assert.equal(closed,false);assert.equal(launched,undefined);assert.match(state.error,/settings changed/);
  context.reviewFingerprint=()=> 'unchanged';await confirm();assert.equal(closed,true);assert.equal(launched.plan.confirmed,true);assert.equal(launched.plan.fields.primary_text,'Copy');
});
