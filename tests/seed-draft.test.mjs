import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySeedDraft} from '../api/_lib/seed-draft.js';

test('seed completion requires the original store, draft, product, quantity and a strict zero total',()=>{
 const store='fixture.myshopify.com',seed={shop_domain:store,shopify_draft_order_id:'gid://shopify/DraftOrder/1',shopify_variant_id:'gid://shopify/ProductVariant/2',quantity:1};
 const draft={id:seed.shopify_draft_order_id,status:'OPEN',order:null,totalPriceSet:{shopMoney:{amount:'0.00'}},lineItems:{nodes:[{quantity:1,variant:{id:seed.shopify_variant_id}}],pageInfo:{hasNextPage:false}}};
 assert.doesNotThrow(()=>verifySeedDraft(seed,draft,store));
 const invalid=[{...draft,id:'other'},{...draft,status:'COMPLETED'},{...draft,order:{id:'order'}},{...draft,lineItems:{...draft.lineItems,pageInfo:{hasNextPage:true}}},{...draft,lineItems:{...draft.lineItems,nodes:[{quantity:2,variant:{id:seed.shopify_variant_id}}]}}];
 for(const amount of ['1.00','',null,undefined,'NaN','-0.00'])invalid.push({...draft,totalPriceSet:{shopMoney:{amount}}});
 for(const value of invalid)assert.throws(()=>verifySeedDraft(seed,value,store),error=>error.statusCode===409 && error.definitelyNotApplied);
 assert.throws(()=>verifySeedDraft(seed,draft,'other.myshopify.com'),/different Shopify store/);
});

import {PGlite} from '@electric-sql/pglite';
import {initializeSchema} from '../api/db/schema.js';
import {ensureOperationJournal} from '../api/_lib/operation-journal.js';
import {ensureLocalReceipts} from '../api/_lib/local-receipts.js';
import {useTestDatabase} from './neon-test-adapter.mjs';
import handler from '../api/creator-seeding.js';

test('a saved seed rechecks Shopify before mutation and safely retries a failed preflight',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),previous={...process.env},previousFetch=globalThis.fetch;
 const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
 const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}});
 try{
  Object.assign(process.env,{AUTH_DISABLED:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://test:test@fixture.local/test',SHOPIFY_SEEDING_ENABLED:'true',SHOPIFY_SEEDING_ACCESS_TOKEN:'fixture-only',SHOPIFY_STORE:'fixture.myshopify.com'});
  await initializeSchema(sql);await ensureOperationJournal(sql);await ensureLocalReceipts(sql);
  const [creator]=await sql`INSERT INTO creators(name) VALUES ('Seed fixture') RETURNING id`;
  await sql`INSERT INTO creator_product_seeds(creator_id,shop_domain,shopify_variant_id,quantity,status,shopify_draft_order_id,request_key,product_title) VALUES (${creator.id},'fixture.myshopify.com','gid://shopify/ProductVariant/2',1,'draft_created','gid://shopify/DraftOrder/1','fixture-key','Fixture')`;
  let amount='2.00',reads=0,mutations=0;
  globalThis.fetch=async(url,init)=>{
   assert.equal(new URL(url).hostname,'fixture.myshopify.com');const {query}=JSON.parse(init.body);
   if(query.includes('query VerifyCreatorSeedDraft')){reads++;return Response.json({data:{draftOrder:{id:'gid://shopify/DraftOrder/1',status:'OPEN',order:null,totalPriceSet:{shopMoney:{amount}},lineItems:{nodes:[{quantity:1,variant:{id:'gid://shopify/ProductVariant/2'}}],pageInfo:{hasNextPage:false}}}}});}
   assert.match(query,/mutation CompleteCreatorSeed/);mutations++;
   return Response.json({data:{draftOrderComplete:{draftOrder:{id:'gid://shopify/DraftOrder/1',order:{id:'gid://shopify/Order/3',name:'#3'}},userErrors:[]}}});
  };
  const req={method:'POST',headers:{},body:{creator_id:creator.id,variant_id:'gid://shopify/ProductVariant/2',quantity:1,request_key:'fixture-key'}};
  const rejected=response();await handler(req,rejected);assert.equal(rejected.statusCode,409);assert.equal(mutations,0);
  amount='0.00';const completed=response();await handler(req,completed);assert.equal(completed.statusCode,201);assert.equal(mutations,1);assert.equal(reads,2);
  const replay=response();await handler(req,replay);assert.equal(replay.statusCode,200);assert.equal(mutations,1);assert.equal(reads,2);
  assert.equal((await sql`SELECT count(*) AS n FROM creator_activity WHERE event_key='seed:fixture-key'`)[0].n,1);
 }finally{restore();globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
