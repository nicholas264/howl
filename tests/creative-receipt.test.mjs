import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ensureOperationJournal,runExternalStep} from '../api/_lib/operation-journal.js';
import {bindCreativeContent,readCreativeReceipt} from '../api/_lib/creative-receipt.js';

test('creative receipts bind account, stored content and attribution across supported formats',async()=>{
  const db=new PGlite(),previous=process.env.META_AD_ACCOUNT_ID;
  const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  try{
    process.env.META_AD_ACCOUNT_ID='receipt-fixture';await ensureOperationJournal(sql);
    const save=(id,story,account='receipt-fixture')=>runExternalStep(sql,{
      operationKey:id,stepKey:`1:/v21.0/act_${account}/adcreatives`,actorId:'fixture',
      payload:{object_story_spec:JSON.stringify(story),url_tags:'source=fixture'},
    },async()=>({status:200,body:{id}}));
    await save('video',{page_id:'page',instagram_user_id:'ig',video_data:{video_id:'v',title:'Title',message:'Message',call_to_action:{value:{link:'https://example.test/video'}}}});
    const input={creativeId:'video',pageId:'page',instagramUserId:'ig'};
    assert.equal(await bindCreativeContent(sql,input,'source=fixture'),'Title\nMessage');
    assert.equal(input.destUrl,'https://example.test/video');assert.equal(input.headline,'Title');
    await assert.rejects(bindCreativeContent(sql,{...input,pageId:'other'},'source=fixture'),/page differs/);
    await assert.rejects(bindCreativeContent(sql,{...input,instagramUserId:'other'},'source=fixture'),/Instagram identity/);
    await save('carousel',{link_data:{link:'https://example.test/cards',message:'Parent',child_attachments:[{name:'First',description:'First body'},{name:'Second',description:'Second body'}]}});
    const carousel={creativeId:'carousel',headline:'Unused parent title'};
    assert.equal(await bindCreativeContent(sql,carousel,'source=fixture'),'Parent\nFirst\nFirst body\nSecond\nSecond body');
    assert.equal(carousel.headline,'');
    await save('foreign',{link_data:{link:'https://example.test'}},'other-account');
    assert.equal(await readCreativeReceipt(sql,'foreign'),null);
    await sql`UPDATE app_operation_steps SET request_payload=request_payload || '{"url_tags":"tampered"}'::jsonb WHERE operation_key='video'`;
    assert.equal(await readCreativeReceipt(sql,'video'),null);
  }finally{if(previous===undefined)delete process.env.META_AD_ACCOUNT_ID;else process.env.META_AD_ACCOUNT_ID=previous;await db.close();}
});
