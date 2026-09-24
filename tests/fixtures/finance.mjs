export const env={QUICKBOOKS_CLIENT_ID:'fixture-client',QUICKBOOKS_CLIENT_SECRET:'fixture-secret',QUICKBOOKS_REDIRECT_URI:'https://example.test/api/quickbooks-callback',QUICKBOOKS_ENVIRONMENT:'sandbox',QUICKBOOKS_TOKEN_ENCRYPTION_KEY:'fixture-only-key-never-use-in-production-123456'};
export const plan={start:'2026-01',basis:'Accrual',currency:'USD',targets:Object.fromEntries(Array.from({length:12},(_,i)=>[`2026-${String(i+1).padStart(2,'0')}`,100000+i*4000])),mapping:{'COGS:1':{variablePct:100},'Expenses:2':{variablePct:0},'Expenses:3':{variablePct:80}}};
const cols=(name,value,id)=>[{value:name,...(id?{id}:{})},{value:String(value)}];
const group=(key,n,rows)=>({group:key,type:'Section',Summary:{ColData:cols(key,n)},...(rows?{Rows:{Row:rows}}:{})});
const account=(id,name,n)=>({type:'Data',ColData:cols(name,n,id)});
export function report(name,start,end,basis='Accrual'){
 const revenue=100000+(Number(start.slice(5,7))-1)*3000;
 return {Header:{ReportName:name,StartPeriod:start,EndPeriod:end,ReportBasis:basis,Currency:'USD'},Columns:{Column:[{ColType:'Account'},{ColType:'Money'}]},Rows:{Row:name==='ProfitAndLoss'?[
 group('Income',revenue),group('COGS',45000,[account('1','Materials & parts',45000)]),group('GrossProfit',revenue-45000),group('Expenses',40000,[account('2','Facilities & salaries',30000),account('3','Fulfillment & service',10000)]),group('NetOperatingIncome',revenue-85000),group('NetIncome',revenue-87000)
 ]:[group('CurrentAssets',200000),group('CurrentLiabilities',100000),group('BankAccounts',70000),group('AR',80000),group('Liabilities',150000),group('Equity',250000)]}};
}
export async function fixtureFetch(url){if(String(url).includes('tokens/bearer'))return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});const u=new URL(url);return Response.json(report(u.pathname.split('/').at(-1),u.searchParams.get('start_date'),u.searchParams.get('end_date'),u.searchParams.get('accounting_method')));}
