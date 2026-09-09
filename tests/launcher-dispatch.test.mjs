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
