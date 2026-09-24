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
