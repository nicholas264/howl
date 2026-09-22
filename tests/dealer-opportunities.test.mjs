import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDealerReport } from '../src/lib/dealer-analytics.js';
import { buildDealerOpportunities, summarizeDealerOpportunities, dealerOpportunitiesCsv } from '../src/lib/dealer-opportunities.js';
import { createDealerOutreachHandler } from '../api/dealer-outreach.js';
import { ensureDealerOutreach } from '../api/_lib/dealer-outreach.js';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from './neon-test-adapter.mjs';
const today = '2026-09-22';
const shop = { domain:'dealer.myshopify.com', currency:'USD', timeZone:'UTC' };
const order = (id, day, netSales, customerKey='customer:1') => ({ id, day, netSales, customerKey, customerName:customerKey, createdAt:`${day}T12:00:00Z` });
const orders = [order('1','2026-05-01',1000),order('2','2026-06-01',2000),order('3','2026-07-01',3000)];
const customers = (list=orders, start) => buildDealerReport({shop, asOf:`${today}T15:00:00Z`, orders:list}, {start}).customers;

test('potential uses one median reorder per unique dealer and includes zero-period spend', () => {
  const c = customers(orders,'2026-09-01');
  const rows = buildDealerOpportunities([...c,...c], [], today);
  assert.equal(c[0].spend,0);
  assert.equal(rows.length,1);
  assert.equal(rows[0].estimate,2000);
  assert.equal(rows[0].kind,'Reactivation');
  assert.equal(summarizeDealerOpportunities(rows).total,2000);
});
test('recent three orders resist an old large order; refunds and future orders do not reset cycle', () => {
  const rows = buildDealerOpportunities(customers([order('old','2026-04-01',100000),...orders,order('refund','2026-09-01',0),order('negative','2026-09-02',-100),order('future','2026-10-01',9000)]),[],today);
  assert.equal(rows[0].estimate,2000);
  assert.equal(rows[0].anchorOrderId,'3');
  assert.equal(rows[0].lastOrder,'2026-07-01');
});
test('new order retires previous cycle and does not carry expected status forward', () => {
  const record = {customer_key:'customer:1',anchor_order_id:'3',status:'expected'};
  const current = customers([...orders,order('4','2026-09-21',4000)]);
  assert.equal(buildDealerOpportunities(current,[record],today).length,0);
  const later = buildDealerOpportunities(current,[record],'2027-01-01');
  assert.equal(later[0].status,'uncontacted');
  assert.equal(later[0].estimate,3000);
  assert.equal(later[0].record,undefined);
});
test('limited-history accounts use 60 days and two orders use their midpoint', () => {
  const list=[order('a','2026-07-24',100,'customer:a'),order('b','2026-07-25',900,'customer:b'),order('c1','2026-05-01',100,'customer:c'),order('c2','2026-07-24',300,'customer:c'),order('anon','2026-01-01',2000,'order:anon')];
  const rows=buildDealerOpportunities(customers(list),[],today);
  assert.deepEqual(rows.map(r=>r.id).sort(),['customer:a','customer:c']);
  assert.equal(rows.find(r=>r.id==='customer:a').kind,'Second order');
  assert.equal(rows.find(r=>r.id==='customer:c').estimate,200);
});
test('stage totals reconcile, closed is excluded, follow-ups use inclusive date',()=>{
  const c=customers(Array.from({length:5},(_,i)=>order(String(i),'2026-01-01',100*(i+1),`customer:${i}`)));
  const records=['uncontacted','contacted','replied','expected','closed'].map((status,i)=>({customer_key:`customer:${i}`,anchor_order_id:String(i),status,next_follow_up:today}));
  const rows=buildDealerOpportunities(c,records,today);
  assert.deepEqual(summarizeDealerOpportunities(rows),{total:1000,uncontacted:100,contacted:500,expected:400,count:4,followUps:4,closed:1});
  const csv=dealerOpportunitiesCsv([{...rows[0],name:'=CMD()',record:{notes:'=1+1',owner:'Roy'}}],'USD');
  assert.ok(csv.includes('"\'=CMD()"'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('Roy'));
});
test('follow-ups use the current day even when the Shopify snapshot is older',()=>{
  const records = [{customer_key:'customer:1',anchor_order_id:'3',status:'contacted',next_follow_up:'2026-09-23'}];
  const before = buildDealerOpportunities(customers(),records,today,'2026-09-22');
  const due = buildDealerOpportunities(customers(),records,today,'2026-09-23');
  assert.equal(before[0].followUpDue,false);
  assert.equal(due[0].followUpDue,true);
  assert.equal(due[0].sinceLast,before[0].sinceLast);
  assert.equal(due[0].estimate,before[0].estimate);
  assert.equal(summarizeDealerOpportunities(due).followUps,1);
});
test('established accounts enter on cadence boundary with a 30-day floor',()=>{
  const list=[order('1','2026-08-01',100),order('2','2026-08-11',100),order('3','2026-08-21',100)];
  assert.equal(buildDealerOpportunities(customers(list),[],'2026-09-19').length,0);
  assert.equal(buildDealerOpportunities(customers(list),[],'2026-09-20').length,1);
});

const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
test('outreach persists in PostgreSQL, isolates shops/cycles, and rejects conflicting edits',async()=>{
  const db=new PGlite(); const restore=useTestDatabase(db);
  try {
    const sql=neon('postgres://test:test@localhost/test');
    await ensureDealerOutreach(sql);
    const permissions=[];
    const authorize=async(_req,_res,p)=>{permissions.push(p);return {sql,userId:'roy',permissions:['analytics.read','analytics.write']};};
    const handler=createDealerOutreachHandler({authorize,getShop:()=>shop.domain});
    const call=async(method,body)=>{const res=response();await handler({method,body},res);return res;};
    const draft={customer_key:'customer:1',anchor_order_id:'3',status:'expected',owner:'Roy',last_contact:'2026-09-21',next_follow_up:'2026-09-25',notes:'Interested in 6 units',revision:0};
    const saved=await call('PUT',draft);
    assert.equal(saved.statusCode,200); assert.equal(saved.body.record.revision,1);
    assert.equal(saved.body.record.updated_by,'roy');
    assert.equal((await call('PUT',draft)).statusCode,409);
    assert.equal((await call('PUT',{...draft,revision:1,status:'replied'})).body.record.revision,2);
    assert.equal((await call('PUT',{...draft,revision:1})).statusCode,409);
    const get=await call('GET'); assert.equal(get.body.records.length,1); assert.equal(get.body.canWrite,true);
    assert.equal(get.body.records[0].notes,draft.notes);
    assert.equal(get.body.records[0].last_contact,'2026-09-21');
    assert.equal((await call('PUT',{...draft,anchor_order_id:'4'})).statusCode,200);
    assert.equal((await call('GET')).body.records.length,2);
    const other=response(); await createDealerOutreachHandler({authorize,getShop:()=>'other.myshopify.com'})({method:'GET'},other);
    assert.equal(other.body.records.length,0);
    for (const patch of [{status:'invalid'},{last_contact:null},{next_follow_up:'2026-02-30'},{notes:'x'.repeat(5001)},{revision:-1},{next_follow_up:'2026-09-20'},{customer_key:'order:1'}]) {
      assert.equal((await call('PUT',{...draft,...patch})).statusCode,400,JSON.stringify(patch).slice(0,100));
    }
    assert.ok(permissions.includes('analytics.write'));
    assert.equal(get.headers['Cache-Control'],'private, no-store');
    const denied=response();await createDealerOutreachHandler({authorize:async(req,res)=>{res.status(403).json({error:'Forbidden'});return null;}})({method:'PUT',body:draft},denied);assert.equal(denied.statusCode,403);
    const failed=response(); await createDealerOutreachHandler({authorize:async()=>({sql:async()=>{throw new Error('private database details');}}),getShop:()=>shop.domain})({method:'GET'},failed);
    assert.equal(failed.statusCode,503);assert.ok(!failed.body.error.includes('private database'));
  } finally {restore();await db.close();}
});
