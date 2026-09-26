import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductProfitLoss,readProductItems,syncProductMargins} from '../api/_lib/quickbooks-products.js';
import {productMarginRows,suggestedProduct} from '../src/lib/product-margins.js';
import {validateSettings} from '../api/_lib/finance.js';
import {plan} from './fixtures/finance.mjs';
const items=[{id:'11',name:'R1',fullName:'Campfires:R1'},{id:'12',name:'R3 HaulBag',fullName:'R3 HaulBag'},{id:'13',name:'R4 HaulBag',fullName:'R4 HaulBag'}];
const company={month:'2026-01',revenue:160,cogs:85};
function report(){return {Header:{ReportName:'ProfitAndLoss',StartPeriod:'2026-01-01',EndPeriod:'2026-01-31',ReportBasis:'Accrual',Currency:'USD',SummarizeColumnsBy:'ProductsAndServices'},Columns:{Column:[{ColType:'Account'},...['11','12','13','not_specified','total'].map((id,i)=>({ColType:'Money',ColTitle:['R1','R3 HaulBag','R4 HaulBag','Not specified','Total'][i],MetaData:[{Name:'ColKey',Value:id}]}))]},Rows:{Row:[{group:'Income',Summary:{ColData:['Income','100','20','30','10','160'].map(value=>({value}))}},{group:'COGS',Summary:{ColData:['COGS','60','10','10','5','85'].map(value=>({value}))}}]}};}
test('product reports use item identity and exclude unassigned amounts',()=>{
 const parsed=parseProductProfitLoss(report(),'2026-01','Accrual','USD',items,company);
 assert.deepEqual(parsed.values['11'],{revenue:100,cogs:60});assert.equal(Object.keys(parsed.values).length,3);
 const rows=productMarginRows(['2026-01','2026-02'],{items,months:[parsed]});
 assert.equal(rows[0].r1,.4);assert.equal(rows[0].bags,.6);assert.equal(rows[0].details.bags.revenue,50);assert.equal(rows[0].r3,null);assert.equal(rows[1].r1,null);
});
test('accessories do not become campfire margins and mapping overrides names',()=>{
 for(const name of ['R1 RallyMount','R3 Burner','R4 Campfire Bundle','R1 Igniter','R1/R3'])assert.equal(suggestedProduct({name}),'exclude');
 for(const name of ['R1 HaulBag','R3 Haul Bag','R4 Bag'])assert.equal(suggestedProduct({name}),'bags');
 assert.equal(suggestedProduct({name:'HOWL R4 MKii'}),'r4');
 const parsed=parseProductProfitLoss(report(),'2026-01','Accrual','USD',items,company);
 assert.equal(productMarginRows(['2026-01'],{items,months:[parsed]},{11:'r3'})[0].r3,.4);
 assert.equal(productMarginRows(['2026-01'],{items,months:[parsed]},{11:'exclude'})[0].r1,null);
});
test('missing COGS does not turn into 100% margin and losses remain visible',()=>{
 const r=report();r.Rows.Row[1].Summary.ColData[1].value='0';r.Rows.Row[1].Summary.ColData[5].value='25';
 const parsed=parseProductProfitLoss(r,'2026-01','Accrual','USD',items,{...company,cogs:25});
 assert.equal(parsed.values['11'].cogs,null);assert.equal(productMarginRows(['2026-01'],{items,months:[parsed]})[0].r1,null);
 parsed.values['11']={revenue:100,cogs:120};assert.equal(productMarginRows(['2026-01'],{items,months:[parsed]})[0].r1,-.2);
 parsed.values['11']={revenue:0,cogs:10};assert.equal(productMarginRows(['2026-01'],{items,months:[parsed]})[0].r1,null);
});
test('wrong basis, currency, period, company total, and duplicate identities fail closed',()=>{
 for(const alter of [r=>r.Header.ReportBasis='Cash',r=>r.Header.Currency='CAD',r=>r.Header.StartPeriod='2026-02-01',r=>r.Header.SummarizeColumnsBy='Total',r=>r.Rows.Row[0].Summary.ColData[5].value='999',r=>r.Columns.Column[2].MetaData[0].Value='11']){
 const r=report();alter(r);assert.throws(()=>parseProductProfitLoss(r,'2026-01','Accrual','USD',items,company));
 }
});
test('item query includes inactive items and sync requests product columns',async()=>{
 const requests=[];
 const fetcher=async url=>{const u=new URL(url);requests.push(u);return Response.json(u.pathname.endsWith('/query')?{QueryResponse:{Item:items.map(i=>({Id:i.id,Name:i.name,FullyQualifiedName:i.fullName,Type:'Inventory',Active:false}))}}:report());};
 const result=await syncProductMargins({access:'test',realm:'123'},plan,[company],{},fetcher);
 assert.match(requests[0].searchParams.get('query'),/Active in \(true,false\)/);assert.equal(requests[1].searchParams.get('summarize_column_by'),'ProductsAndServices');assert.equal(result.items[0].active,false);assert.equal(result.months.length,1);
 await assert.rejects(readProductItems({access:'test',realm:'123'},{},async()=>Response.json({})),/incomplete/);
});
test('product mappings round trip and reject unknown group and malformed item IDs',()=>{
 assert.deepEqual(validateSettings({...plan,productItemMapping:{11:'r1',12:'bags',13:'exclude'}}).productItemMapping,{11:'r1',12:'bags',13:'exclude'});
 for(const mapping of [[],null,{11:'anything'},{'../':'r1'}])assert.throws(()=>validateSettings({...plan,productItemMapping:mapping}));
});

test('dedicated product COGS replaces missing item costs and dealer mix uses actual sales',()=>{
 const catalog=[{id:'1',name:'The Howl R1'},{id:'2',name:'DLR Howl R1'}];
 const data={items:catalog,months:[{month:'2026-01',values:{1:{revenue:1000,cogs:null},2:{revenue:700,cogs:null}}}]};
 const accounts=[{id:'COGS:1',name:'50007 COGS - R1',group:'COGS',values:{'2026-01':800}}];
 const row=productMarginRows(['2026-01'],data,{1:'r1',2:'r1'},accounts)[0];
 assert.equal(row.r1,900/1700);assert.equal(row.details.r1.dealerRevenue,700);assert.equal(row.details.r1.dealerShare,700/1700);assert.equal(row.details.r1.cogs,800);
 const forced=productMarginRows(['2026-01'],data,{1:'r1',2:'r1'},accounts,{r1:'items'})[0];assert.equal(forced.r1,null);assert.equal(forced.details.r1.revenue,1700);
 assert.equal(productMarginRows(['2026-01'],data,{1:'r1',2:'r1'},accounts,{r1:'COGS:missing'})[0].r1,null);
});
test('shared accessories are never automatically treated as bag costs',()=>{
 const data={items:[{id:'1',name:'R1 HaulBag'}],months:[{month:'2026-01',values:{1:{revenue:100,cogs:null}}}]};
 const accounts=[{id:'COGS:2',name:'50027 COGS - Accessories',group:'COGS',values:{'2026-01':60}}];
 assert.equal(productMarginRows(['2026-01'],data,{},accounts)[0].bags,null);
 assert.equal(productMarginRows(['2026-01'],data,{},accounts,{bags:'COGS:2'})[0].bags,.4);
 assert.throws(()=>validateSettings({...plan,productCogsAccounts:{r1:'COGS:2',bags:'COGS:2'}}),/distinct/);
});
