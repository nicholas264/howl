import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from './neon-test-adapter.mjs';
import { financialRatios,targetPacing,classifyCosts,fiscalMonths,readFinanceWorkspace } from '../src/lib/finance.js';
import { ensureFinance,encrypt,decrypt,setup,validateSettings,acquireConnection,releaseConnection,nonce } from '../api/_lib/finance.js';
import { parseProfitLoss,parseBalanceSheet } from '../api/_lib/quickbooks-reports.js';
import { createFinanceHandler } from '../api/finance.js';
import { createQuickBooksCallback } from '../api/quickbooks-callback.js';
import { env,plan,report,fixtureFetch } from './fixtures/finance.mjs';
const res=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;},redirect(c,u){this.statusCode=c;this.url=u;return this;},end(){}});
test('ratios do not invent break-even or ratios for zero and negative denominators',()=>{
 const r=financialRatios({revenue:100000,variableCosts:60000,fixedCosts:30000,cogs:50000,netIncome:10000,currentAssets:2,currentLiabilities:0,equity:-2,totalLiabilities:3});assert.equal(r.breakEvenSales,75000);assert.equal(r.marginOfSafety,25000);assert.equal(r.netMargin,.1);assert.equal(r.currentRatio,null);assert.equal(r.debtToEquity,null);
 for(const revenue of [0,50000])assert.equal(financialRatios({revenue,variableCosts:60000,fixedCosts:30000}).breakEvenSales,null);
 assert.equal(financialRatios({revenue:100,variableCosts:null,fixedCosts:5}).breakEvenSales,null);
});
test('seasonal pacing uses matching completed months and does not silently substitute missing plans or actuals',()=>{
 const p=fiscalMonths('2026-07');assert.equal(p.at(-1),'2027-06');const t=Object.fromEntries(p.map((m,i)=>[m,(i+1)*100]));
 const r=targetPacing([{month:'2026-07',revenue:80},{month:'2026-08',revenue:250}],t,p,'2026-08');assert.equal(r.planToDate,300);assert.equal(r.variance,30);assert.equal(r.actualPlusRemainingPlan,7830);
 assert.equal(targetPacing([],t,p,'2026-08').actual,null);delete t['2026-09'];assert.equal(targetPacing([],t,p,'2026-08').annualTarget,null);
});
test('unclassified offsetting costs still block contribution; mixed costs split correctly',()=>{
 const accounts=[{id:'1',group:'COGS',values:{a:10,b:-10}},{id:'2',group:'Expenses',values:{a:100}}];assert.equal(classifyCosts(accounts,{},['a','b']).unclassified.length,2);
 assert.deepEqual(classifyCosts(accounts,{'1':{variablePct:100},'2':{variablePct:25}},['a','b']),{variableCosts:25,fixedCosts:75,unclassified:[]});
});
test('report parser rejects mismatched periods, currencies at sync boundary, missing totals and nonreconciling costs',()=>{
 const fixture=report('ProfitAndLoss','2026-01-01','2026-01-31');assert.equal(parseProfitLoss(fixture,'2026-01-01','2026-01-31','Accrual').accounts.length,3);
 assert.throws(()=>parseProfitLoss(fixture,'2026-02-01','2026-02-28','Accrual'),/match/);
 const broken=structuredClone(fixture);broken.Rows.Row[1].Rows.Row[0].ColData[1].value='999';assert.throws(()=>parseProfitLoss(broken,'2026-01-01','2026-01-31','Accrual'),/reconcile/);
 const nested=structuredClone(fixture);nested.Rows.Row[1].Rows.Row=[{type:'Section',Header:{ColData:[{id:'9',value:'Parent cost'},{value:''}]},Rows:{Row:fixture.Rows.Row[1].Rows.Row},Summary:{ColData:[{value:'Subtotal'},{value:'45000'}]}}];assert.equal(parseProfitLoss(nested,'2026-01-01','2026-01-31','Accrual').cogs,45000);
 const empty=structuredClone(fixture);empty.Rows={};empty.Header.Option=[{Name:'NoReportData',Value:'true'}];assert.equal(parseProfitLoss(empty,'2026-01-01','2026-01-31','Accrual').revenue,0);delete empty.Header.Option;assert.throws(()=>parseProfitLoss(empty,'2026-01-01','2026-01-31','Accrual'),/match/);
 const missing=structuredClone(fixture);missing.Rows.Row=missing.Rows.Row.filter(r=>r.group!=='NetIncome');assert.throws(()=>parseProfitLoss(missing,'2026-01-01','2026-01-31','Accrual'),/missing/);
 const balance=report('BalanceSheet','2026-01-01','2026-01-31');balance.Rows.Row=[];assert.equal(parseBalanceSheet(balance,'2026-01-01','2026-01-31','Accrual').cash,null);
});
test('settings, callback configuration, and authenticated token encryption fail closed',()=>{
 assert.equal(setup(env).ready,true);assert.equal(setup({...env,QUICKBOOKS_TOKEN_ENCRYPTION_KEY:'short'}).ready,false);assert.equal(setup({...env,NODE_ENV:'production',QUICKBOOKS_REDIRECT_URI:'http://localhost/api/quickbooks-callback'}).ready,false);
 assert.throws(()=>validateSettings({...plan,mapping:{x:{variablePct:101}}}));assert.throws(()=>validateSettings({...plan,targets:{'2027-01':5}}));assert.throws(()=>validateSettings({...plan,targets:{'2026-01':NaN}}));
 const token={refresh_token:'never-plaintext'},cipher=encrypt(token,env);assert.ok(!cipher.includes(token.refresh_token));assert.deepEqual(decrypt(cipher,env),token);assert.notEqual(cipher,encrypt(token,env));assert.throws(()=>decrypt(cipher,{...env,QUICKBOOKS_TOKEN_ENCRYPTION_KEY:'wrong-but-long-enough-key-1234567890'}));
});
test('owner guard runs before all financial queries and actions',async()=>{
 for(const role of ['admin','viewer','analyst','strategist',undefined])for(const method of ['GET','POST']){const r=res();await createFinanceHandler({authorize:async()=>({role,sql:()=>assert.fail('must not query')})})({method},r);assert.equal(r.statusCode,403);}
});
test('real SQL: OAuth binding, replay, owner recheck, CAS, sync atomicity, refresh lease, and disconnect',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),sql=neon('postgres://test:test@localhost/test');await ensureFinance(sql);await sql`CREATE TABLE app_users(user_id TEXT PRIMARY KEY,role TEXT,status TEXT)`;await sql`INSERT INTO app_users VALUES ('owner','owner','active')`;
 let failSync=false,refreshes=0;const fetcher=async(url,init)=>{if(String(url).includes('tokens/bearer'))refreshes++;if(failSync&&String(url).includes('BalanceSheet'))return new Response('',{status:503});return fixtureFetch(url,init);};
 const handler=createFinanceHandler({authorize:async()=>({sql,userId:'owner',role:'owner'}),env,fetcher,now:()=>new Date('2026-03-15T12:00:00Z')});
 const call=async(method,body)=>{const r=res();await handler({method,body},r);return r;};const callback=createQuickBooksCallback({getSql:()=>sql,env,fetcher});
 async function connect(cookieOverride){const r=await call('POST',{action:'connect'});assert.equal(r.statusCode,200);const state=new URL(r.body.url).searchParams.get('state'),cookie=r.headers['Set-Cookie'].split(';')[0];const reply=res();await callback({method:'GET',headers:{cookie:cookieOverride??cookie},query:{state,code:'fixture-code',realmId:'123'}},reply);return {reply,state,cookie};}
 try{
 assert.equal((await call('GET')).body.snapshot,null);
 assert.equal((await call('POST',{action:'save',settings:plan,revision:0})).statusCode,200);assert.equal((await call('POST',{action:'save',settings:plan,revision:0})).statusCode,409);
 assert.match((await connect('qb_oauth='+nonce())).reply.url,/invalid_state/);assert.equal(refreshes,0);
 const c=await connect();assert.match(c.reply.url,/connected/);assert.equal(refreshes,1);
 const replay=res();await callback({method:'GET',headers:{cookie:c.cookie},query:{state:c.state,code:'fixture-code',realmId:'123'}},replay);assert.match(replay.url,/invalid_state/);assert.equal(refreshes,1);
 const safe=await call('GET');assert.ok(!JSON.stringify(safe.body).includes('fixture-access'));assert.ok(!JSON.stringify(safe.body).includes('fixture-secret'));
 assert.equal((await call('POST',{action:'sync'})).statusCode,200);let saved=(await call('GET')).body.snapshot;assert.equal(saved.months.length,2);assert.equal(saved.accounts.length,3);
 failSync=true;assert.equal((await call('POST',{action:'sync'})).statusCode,503);assert.deepEqual((await call('GET')).body.snapshot,saved);failSync=false;
 await sql`UPDATE finance_connection SET expires_at=now()-interval '1 hour'`;const lease=await acquireConnection(sql,env,fetcher);assert.equal(refreshes,2);await assert.rejects(acquireConnection(sql,env,fetcher),/current sync/);await releaseConnection(sql,lease.version);
 await sql`UPDATE app_users SET role='admin'`;assert.match((await connect()).reply.url,/access_denied/);assert.equal(refreshes,2);
 await sql`UPDATE app_users SET role='owner'`;const current=(await call('GET')).body;assert.equal((await call('POST',{action:'save',revision:current.revision,settings:{...plan,basis:'Cash'}})).statusCode,200);assert.equal((await call('GET')).body.snapshot,null);
 assert.equal((await call('POST',{action:'disconnect'})).statusCode,200);assert.equal((await call('GET')).body.connection,null);assert.equal((await sql`SELECT * FROM finance_oauth`).length,0);
 }finally{restore();await db.close();}
});

test('unexpected preview API response becomes a recoverable load error before rendering',()=>{
 for(const payload of [{count:0,records:[],drafts:[]},null,{}, {settings:plan,revision:1,setup:{}}])assert.throws(()=>readFinanceWorkspace(payload),/incomplete response/);
 const valid={settings:plan,revision:1,setup:{checks:[]},snapshot:null};assert.equal(readFinanceWorkspace(valid),valid);
 assert.throws(()=>readFinanceWorkspace({...valid,snapshot:{}}),/report could not be loaded/);
});
test('disconnect during token exchange cancels consent and cannot resurrect credentials',async()=>{
 const db=new PGlite(),restore=useTestDatabase(db),sql=neon('postgres://test:test@localhost/test');await ensureFinance(sql);await sql`CREATE TABLE app_users(user_id TEXT PRIMARY KEY,role TEXT,status TEXT)`;await sql`INSERT INTO app_users VALUES ('owner','owner','active')`;
 const handler=createFinanceHandler({authorize:async()=>({sql,userId:'owner',role:'owner'}),env});
 try{const start=res();await handler({method:'POST',body:{action:'connect'}},start);const state=new URL(start.body.url).searchParams.get('state'),cookie=start.headers['Set-Cookie'].split(';')[0];
 const callback=createQuickBooksCallback({getSql:()=>sql,env,fetcher:async()=>{const r=res();await handler({method:'POST',body:{action:'disconnect'}},r);assert.equal(r.statusCode,200);return Response.json({access_token:'cancelled',refresh_token:'cancelled-refresh',expires_in:3600});}});
 const result=res();await callback({method:'GET',headers:{cookie},query:{state,code:'fixture-code',realmId:'123'}},result);assert.match(result.url,/access_denied/);assert.equal((await sql`SELECT id FROM finance_connection`).length,0);
 }finally{restore();await db.close();}
});
test('published Intuit report samples parse without treating nested subtotals as transactions',async()=>{
 const {readFile}=await import('node:fs/promises');
 const pnl=JSON.parse(await readFile(new URL('./fixtures/intuit-profit-loss.json',import.meta.url),'utf8'));
 const balance=JSON.parse(await readFile(new URL('./fixtures/intuit-balance-sheet.json',import.meta.url),'utf8'));
 const p=parseProfitLoss(pnl,'2015-06-01','2015-06-30','Accrual');assert.equal(p.revenue,325);assert.equal(p.netIncome,325);assert.equal(p.expenses,0);assert.deepEqual(p.accounts,[]);
 const b=parseBalanceSheet(balance,'2016-01-01','2016-10-31','Accrual');assert.equal(b.currentAssets,11247.44);assert.equal(b.currentLiabilities,6548.42);assert.equal(b.cash,2150.55);assert.equal(b.receivables,6383.12);assert.equal(b.totalLiabilities,31548.42);assert.equal(b.equity,-6805.98);
});

test('a pre-revenue month with reconciled expenses remains a valid accounting month',()=>{
 const r=report('ProfitAndLoss','2026-01-01','2026-01-31');r.Rows.Row=r.Rows.Row.filter(x=>!['Income','COGS'].includes(x.group));
 for(const row of r.Rows.Row){if(row.group==='GrossProfit')row.Summary.ColData[1].value='0';if(['NetIncome','NetOperatingIncome'].includes(row.group))row.Summary.ColData[1].value='-40000';}
 const parsed=parseProfitLoss(r,'2026-01-01','2026-01-31','Accrual');assert.equal(parsed.revenue,0);assert.equal(parsed.expenses,40000);assert.equal(parsed.netIncome,-40000);
});
