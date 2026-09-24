// Use stable report groups/account IDs, never localized display labels. Only
// single-period total reports are accepted; unknown layouts fail closed.
function amount(v){if(v==='')return 0;if(typeof v!=='string'||!/^[-+]?\d+(\.\d+)?$/.test(v)||!Number.isFinite(Number(v)))throw new Error('A QuickBooks report contains a missing or invalid amount.');return Number(v);}
function value(c){if(!Array.isArray(c)||c.length!==2)throw new Error('QuickBooks returned an unsupported report layout.');return amount(c[1]?.value);}
function noData(report){
 if(!report?.Header?.Option?.some(o=>o.Name==='NoReportData'&&o.Value==='true'))return false;
 const rows=report.Rows?.Row||[];
 if(!Array.isArray(rows))return false;
 if(!rows.length)return true;
 // Intuit's empty-month response retains label-only section summaries and
 // omits the money column. Never treat actual account rows as an empty report.
 if(report.Columns?.Column?.length!==1||report.Columns.Column[0].ColType!=='Account')return false;
 const labelOnly=cols=>cols===undefined||(Array.isArray(cols)&&cols.length===1&&!cols[0].id&&typeof cols[0].value==='string');
 const empty=items=>Array.isArray(items)&&items.every(r=>r.type==='Section'&&!r.ColData&&labelOnly(r.Header?.ColData)&&labelOnly(r.Summary?.ColData)&&(!r.Rows||empty(r.Rows.Row)));
 return empty(rows);
}
function inspect(report,name,start,end,basis){
 const empty=noData(report),columns=report?.Columns?.Column;
 if(report?.Header?.ReportName!==name||report.Header.StartPeriod!==start||report.Header.EndPeriod!==end||report.Header.ReportBasis!==basis||!report.Header.Currency||!(columns?.length===2||(empty&&columns?.length===1&&columns[0].ColType==='Account'))||(!Array.isArray(report.Rows?.Row)&&!empty))throw new Error('QuickBooks report period, basis, currency, or columns did not match the request.');
 const groups=new Map();function walk(rows){for(const r of rows){if(r.group){if(groups.has(r.group))throw new Error('Duplicate report group.');groups.set(r.group,r);}if(r.Rows?.Row)walk(r.Rows.Row);}}walk(report.Rows?.Row||[]);return groups;
}
const total=(groups,key,required=true)=>{const r=groups.get(key);if(!r){if(required)throw new Error(`QuickBooks report is missing ${key}.`);return null;}return value(r.Summary?.ColData||r.ColData);};
export function parseProfitLoss(report,start,end,basis){
 const groups=inspect(report,'ProfitAndLoss',start,end,basis);
 if(noData(report))return {month:start.slice(0,7),revenue:0,cogs:0,expenses:0,netIncome:0,accounts:[],currency:report.Header.Currency};
 const revenue=total(groups,'Income',false)??0,grossProfit=total(groups,'GrossProfit'),operating=total(groups,'NetOperatingIncome'),netIncome=total(groups,'NetIncome');
 const cogs=total(groups,'COGS',false)??0,expenses=total(groups,'Expenses',false)??0;
 if(Math.abs(revenue-cogs-grossProfit)>.05||Math.abs(grossProfit-expenses-operating)>.05)throw new Error('QuickBooks operating totals did not reconcile.');
 const accounts=[];
 for(const group of ['COGS','Expenses']){const section=groups.get(group);if(!section)continue;
 const add=cols=>{if(!cols)return;const n=value(cols);if(!cols[0]?.id){if(Math.abs(n)>.005)throw new Error('A cost row has no account ID.');return;}accounts.push({id:`${group}:${cols[0].id}`,name:cols[0].value,group,amount:n});};
 function walk(rows){for(const r of rows||[]){if(r.type==='Data')add(r.ColData);else{add(r.Header?.ColData);walk(r.Rows?.Row);}}}walk(section.Rows?.Row);
 const sum=accounts.filter(a=>a.group===group).reduce((s,a)=>s+a.amount,0);if(Math.abs(sum-total(groups,group))>.05)throw new Error('Account costs did not reconcile. Review the QuickBooks report structure before calculating contribution margin.');
 }
 return {month:start.slice(0,7),revenue,cogs,expenses,netIncome,accounts,currency:report.Header.Currency};
}
export function parseBalanceSheet(report,start,end,basis){
 const g=inspect(report,'BalanceSheet',start,end,basis);
 if(noData(report))return {currency:report.Header.Currency,asOf:end,currentAssets:null,currentLiabilities:null,cash:null,receivables:null,totalLiabilities:null,equity:null};
 return {currency:report.Header.Currency,asOf:end,currentAssets:total(g,'CurrentAssets',false),currentLiabilities:total(g,'CurrentLiabilities',false),cash:total(g,'BankAccounts',false),receivables:total(g,'AR',false),totalLiabilities:total(g,'Liabilities',false),equity:total(g,'Equity',false)};
}
export function combineAccounts(months){const map=new Map();for(const m of months)for(const a of m.accounts){if(!map.has(a.id))map.set(a.id,{id:a.id,name:a.name,group:a.group,values:{}});const t=map.get(a.id);t.values[m.month]=(t.values[m.month]||0)+a.amount;}return [...map.values()];}
