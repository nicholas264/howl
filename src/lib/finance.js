export const canAccessFinance=access=>access?.role==='owner';
export const ratio=(numerator,denominator)=>Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator>0?numerator/denominator:null;
export const fiscalMonths=start=>Array.from({length:12},(_,i)=>{const d=new Date(`${start}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+i);return d.toISOString().slice(0,7);});
export function financialRatios({revenue,cogs,netIncome,variableCosts,fixedCosts,currentAssets,currentLiabilities,cash,receivables,totalLiabilities,equity}){
 const contribution=Number.isFinite(revenue)&&Number.isFinite(variableCosts)?revenue-variableCosts:null;
 const contributionMargin=ratio(contribution,revenue);
 const breakEvenSales=contributionMargin>0&&Number.isFinite(fixedCosts)&&fixedCosts>=0?fixedCosts/contributionMargin:null;
 return {revenue,contribution,contributionMargin,variableCosts,fixedCosts,breakEvenSales,grossMargin:Number.isFinite(cogs)?ratio(revenue-cogs,revenue):null,netMargin:ratio(netIncome,revenue),operatingResult:contribution!=null&&Number.isFinite(fixedCosts)?contribution-fixedCosts:null,marginOfSafety:breakEvenSales!=null?revenue-breakEvenSales:null,currentRatio:ratio(currentAssets,currentLiabilities),quickRatio:Number.isFinite(cash)&&Number.isFinite(receivables)?ratio(cash+receivables,currentLiabilities):null,debtToEquity:ratio(totalLiabilities,equity)};
}
// Only matched, complete months are compared. An open month never silently counts
// as a complete month of actuals or a complete month of the original plan.
export function targetPacing(months,targets,periods,closedThrough){
 const closed=periods.filter(m=>m<=closedThrough),actualMap=new Map(months.map(m=>[m.month,m.revenue]));
 const missingActual=closed.filter(m=>!Number.isFinite(actualMap.get(m))),missingPlan=periods.filter(m=>!Number.isFinite(targets[m]));
 const actual=missingActual.length?null:closed.reduce((s,m)=>s+actualMap.get(m),0);
 const planToDate=closed.some(m=>!Number.isFinite(targets[m]))?null:closed.reduce((s,m)=>s+targets[m],0);
 const annualTarget=missingPlan.length?null:periods.reduce((s,m)=>s+targets[m],0);
 const remaining=periods.filter(m=>m>closedThrough),remainingPlan=remaining.some(m=>!Number.isFinite(targets[m]))?null:remaining.reduce((s,m)=>s+targets[m],0);
 return {actual,planToDate,annualTarget,variance:actual!=null&&planToDate!=null?actual-planToDate:null,attainment:ratio(actual,annualTarget),requiredRemaining:actual!=null&&annualTarget!=null?Math.max(0,annualTarget-actual):null,requiredMonthly:actual!=null&&annualTarget!=null&&remaining.length?Math.max(0,annualTarget-actual)/remaining.length:null,actualPlusRemainingPlan:actual!=null&&remainingPlan!=null?actual+remainingPlan:null,missingActual,missingPlan,closedMonths:closed.length,remainingMonths:remaining.length};
}
export function classifyCosts(accounts,mapping,months){
 let variableCosts=0,fixedCosts=0;const unclassified=[];
 for(const account of accounts){const amount=months.reduce((s,m)=>s+(account.values[m]??0),0);if(!['COGS','Expenses'].includes(account.group))continue;
 const rule=mapping[account.id];if(!rule||!Number.isFinite(rule.variablePct)||rule.variablePct<0||rule.variablePct>100){if(months.some(m=>Math.abs(account.values[m]??0)>.005))unclassified.push(account);continue;}
 variableCosts+=amount*rule.variablePct/100;fixedCosts+=amount*(1-rule.variablePct/100);
 }
 return {variableCosts:unclassified.length?null:variableCosts,fixedCosts:unclassified.length?null:fixedCosts,unclassified};
}

// Reject unrelated preview/API payloads before React reads financial settings.
export function readFinanceWorkspace(payload) {
 const s=payload?.settings;
 if(!s || !/^20\d\d-(0[1-9]|1[0-2])$/.test(s.start) || !['Cash','Accrual'].includes(s.basis) || !/^[A-Z]{3}$/.test(s.currency) || !s.targets || typeof s.targets!=='object' || !s.mapping || typeof s.mapping!=='object' || !Number.isSafeInteger(payload.revision) || !Array.isArray(payload.setup?.checks)) {
  throw new Error('The financial service returned an incomplete response. Check that this server supports Financials, then retry.');
 }
 if(payload.snapshot && (!Array.isArray(payload.snapshot.months) || !Array.isArray(payload.snapshot.accounts) || !payload.snapshot.balance)) {
  throw new Error('The financial report could not be loaded. Retry to retrieve the saved report.');
 }
 return payload;
}

export const ebitdaFields=['interest','incomeTax','depreciation','amortization'];
export function profitSeries(periods,months,adjustments={}) {
 return periods.map(month=>{
  const netIncome=months.find(m=>m.month===month)?.netIncome;
  const entries=adjustments[month];
  const complete=Number.isFinite(netIncome)&&ebitdaFields.every(key=>Number.isFinite(entries?.[key]));
  return {month,netIncome,ebitda:complete?ebitdaFields.reduce((sum,key)=>sum+entries[key],netIncome):null};
 });
}

export function sellingContribution(accounts,sellingAccountIds,months){
 const selling=new Set(sellingAccountIds);let cogs=0,sellingExpenses=0,fixedCosts=0;
 for(const a of accounts){const value=months.reduce((sum,m)=>sum+(a.values[m]??0),0);
 if(a.group==='COGS')cogs+=value;
 else if(a.group==='Expenses'){if(selling.has(a.id))sellingExpenses+=value;else fixedCosts+=value;}
 }
 return {method:'selling',cogs,sellingExpenses,variableCosts:cogs+sellingExpenses,fixedCosts,unclassified:[]};
}

// Keep the observed YTD selling margin, but cover the latest reported month's
// operating budget. Do not average away a recent change in overhead.
export function latestOperatingBreakEven(months,accounts,settings,contributionMargin){
 const latest=months.reduce((last,m)=>!last||m.month>last.month?m:last,null);
 if(!latest)return {month:null,revenue:null,operatingBudget:null,sales:null};
 const costs=Array.isArray(settings.sellingAccountIds)
  ?sellingContribution(accounts,settings.sellingAccountIds,[latest.month])
  :classifyCosts(accounts,settings.mapping,[latest.month]);
 const operatingBudget=costs.fixedCosts;
 return {month:latest.month,revenue:latest.revenue,operatingBudget,
 sales:Number.isFinite(operatingBudget)&&operatingBudget>=0&&Number.isFinite(contributionMargin)&&contributionMargin>0?operatingBudget/contributionMargin:null};
}

export function financialTrends(periods,months,accounts,settings){
 return periods.map(month=>{
  const report=months.find(m=>m.month===month);
  if(!report)return {month};
  const costs=Array.isArray(settings.sellingAccountIds)?sellingContribution(accounts,settings.sellingAccountIds,[month]):null;
  return {month,grossMargin:ratio(report.revenue-report.cogs,report.revenue),
   totalOpex:report.expenses,sellingExpenses:costs?.sellingExpenses??null,
   operatingBudget:costs?.fixedCosts??null};
 });
}
