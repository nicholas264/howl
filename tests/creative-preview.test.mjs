import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { seedCreativeAnalytics } from './fixtures/creative-analytics.mjs';
import { loadCreativePreview } from '../api/_lib/meta/creative-preview.js';
const ctx={BASE:'https://graph.facebook.com/v21.0',accessToken:'fixture-token',adAccountId:'act_123'};
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('poster recovery selects native resolution, preserves original posters, and validates account fallback',async()=>{
 const db=new PGlite();
 try {
  const {sql}=await seedCreativeAnalytics(db);
  await sql`UPDATE creative_performance SET video_id='12345',creative_id='98765' WHERE group_key='fixture-0'`;
  await sql`UPDATE creative_assets SET preview_url='https://original.example/poster.jpg' WHERE group_key='fixture-0'`;
  const calls=[];
  const read=async(url,init)=>{calls.push(url);assert.equal(init.headers.Authorization,'Bearer fixture-token');assert.ok(!url.includes('fixture-token'));return response({data:[{uri:'https://scontent.xx.fbcdn.net/small.jpg',width:64,height:64},{uri:'https://scontent.xx.fbcdn.net/full.jpg',width:1080,height:1920},{uri:'https://unrelated.example/huge.jpg',width:4000,height:4000}]});};
  const result=await loadCreativePreview(sql,ctx,'fixture-0',read);
  assert.equal(result.previewUrl,'https://scontent.xx.fbcdn.net/full.jpg');assert.equal(calls.length,1);
  assert.equal((await sql`SELECT thumbnail_url FROM creative_performance WHERE group_key='fixture-0'`)[0].thumbnail_url,result.previewUrl);
  assert.equal((await sql`SELECT preview_url FROM creative_assets WHERE group_key='fixture-0'`)[0].preview_url,'https://original.example/poster.jpg');
  await sql`UPDATE creative_assets SET preview_url='https://scontent.xx.fbcdn.net/small.jpg' WHERE group_key='fixture-0'`;
  const fallback=async url=>url.includes('/thumbnails?')?response({error:{message:'Video inaccessible'}}):response({account_id:'123',thumbnail_url:'https://scontent.xx.fbcdn.net/large.jpg'});
  await loadCreativePreview(sql,ctx,'fixture-0',async(url,init)=>{if(!url.includes('/thumbnails?')){assert.equal(new URL(url).searchParams.get('thumbnail_width'),'1080');assert.equal(new URL(url).searchParams.get('thumbnail_height'),'1080');}return fallback(url,init);});
  assert.equal((await sql`SELECT preview_url FROM creative_assets WHERE group_key='fixture-0'`)[0].preview_url,'https://scontent.xx.fbcdn.net/large.jpg');
  await assert.rejects(loadCreativePreview(sql,ctx,'fixture-0',async url=>url.includes('/thumbnails?')?response({data:[]}):response({account_id:'999',thumbnail_url:'https://scontent.xx.fbcdn.net/wrong.jpg'})),/did not return/);
  await assert.rejects(loadCreativePreview(sql,ctx,'missing',()=>{throw new Error('must not fetch')}),/not found/);
 }finally{await db.close();}
});
