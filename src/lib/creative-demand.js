const DAY = 86400000;
const day = value => Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / DAY;
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
export function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const position = (sorted.length-1)*fraction, low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)]-sorted[low])*(position-low);
}
export function correlation(pairs) {
  const points = pairs.filter(pair => pair.every(Number.isFinite));
  if (points.length < 6) return {n:points.length,r:null};
  const x = sum(points.map(p=>({v:p[0]})),'v')/points.length, y = sum(points.map(p=>({v:p[1]})),'v')/points.length;
  const xx = points.reduce((s,p)=>s+(p[0]-x)**2,0), yy = points.reduce((s,p)=>s+(p[1]-y)**2,0);
  return {n:points.length,r:xx && yy ? points.reduce((s,p)=>s+(p[0]-x)*(p[1]-y),0)/Math.sqrt(xx*yy) : null};
}
export const DEFAULT_DEMAND_ASSUMPTIONS = Object.freeze({roasFloor:5, minTestSpend:500, minWinnerSpend:1000, minPurchases:3, newCustomerShare:80, otherSpend:40000, retainedCapacity:70, testBudgetPct:15, productionLeadDays:21, returnsPct:0, weeklyCapacity:0});
export function validateDemandAssumptions(input = {}) {
  const ranges = {roasFloor:[.1,100],minTestSpend:[1,100000],minWinnerSpend:[1,1000000],minPurchases:[1,1000],newCustomerShare:[1,100],otherSpend:[0,10000000],retainedCapacity:[0,100],testBudgetPct:[0,90],productionLeadDays:[0,180],returnsPct:[0,90],weeklyCapacity:[0,10000]};
  const result = {};
  for (const [key,[min,max]] of Object.entries(ranges)) {
    const value = input[key] ?? DEFAULT_DEMAND_ASSUMPTIONS[key];
    if (value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value)<min || Number(value)>max) throw new Error(`Invalid ${key}: use ${min}–${max}.`);
    result[key] = Number(value);
  }
  if (!Number.isInteger(result.weeklyCapacity) || !Number.isInteger(result.productionLeadDays)) throw new Error('Weekly capacity and production lead time must be whole numbers.');
  if (result.minWinnerSpend < result.minTestSpend) throw new Error('Winner spend must be at least the minimum test spend.');
  return result;
}
export function buildCreativeEvidence(input, supplied = {}) {
  const a = validateDemandAssumptions(supplied), cutoff = day(input.asOf);
  const byKey = new Map();
  // Sum duplicated ad IDs into one asset/day before measuring a launch cohort.
  for (const row of input.daily || []) {
    if (day(row.date)>cutoff) continue;
    if(!byKey.has(row.key)) byKey.set(row.key,new Map());
    const days=byKey.get(row.key), value=days.get(row.date)||{date:row.date,spend:0,revenue:0,purchases:0};
    for(const key of ['spend','revenue','purchases'])value[key]+=Number(row[key]||0);
    days.set(row.date,value);
  }
  const isWinner = r => r.spend>=a.minWinnerSpend && r.purchases>=a.minPurchases && r.revenue/r.spend>=a.roasFloor;
  const assets=(input.groups||[]).map(group=>{
    const days=[...(byKey.get(group.key)?.values()||[])].sort((a,b)=>a.date.localeCompare(b.date));
    const first=group.firstDate ? day(group.firstDate) : null;
    const mature=group.mapped && first!=null && group.firstDate>=input.dailyHistoryStart && first+29+7<=cutoff;
    const window=first==null?[]:days.filter(r=>day(r.date)>=first&&day(r.date)<=first+29);
    const metrics={spend:sum(window,'spend'),revenue:sum(window,'revenue'),purchases:sum(window,'purchases')};
    // Baseline ends seven days before asOf so attribution can mature.
    const recent=days.filter(r=>day(r.date)>=cutoff-36&&day(r.date)<=cutoff-7);
    const recentMetrics={spend:sum(recent,'spend'),revenue:sum(recent,'revenue'),purchases:sum(recent,'purchases')};
    let runningSpend=0,runningRevenue=0,runningPurchases=0,winDay=null;
    for(const r of window){runningSpend+=r.spend;runningRevenue+=r.revenue;runningPurchases+=r.purchases;if(winDay==null&&isWinner({spend:runningSpend,revenue:runningRevenue,purchases:runningPurchases}))winDay=day(r.date)-first+1;}
    return {key:group.key,name:group.name,mapped:group.mapped,firstMonth:group.firstMonth,firstDate:group.firstDate,adCount:group.adIds.length,mature,tested:mature&&metrics.spend>=a.minTestSpend,winner:mature&&isWinner(metrics),...metrics,roas:metrics.spend?metrics.revenue/metrics.spend:null,winDay,recent:recentMetrics,recentWinner:group.mapped&&isWinner(recentMetrics)};
  });
  const sample=assets.filter(x=>x.mature), winners=sample.filter(x=>x.winner), tested=sample.filter(x=>x.tested), failures=sample.filter(x=>!x.winner);
  const cohorts=(input.months||[]).map(month=>{
    const cohort=assets.filter(x=>x.firstMonth===month.month), eligible=cohort.filter(x=>x.mature), wins=eligible.filter(x=>x.winner), evaluated=eligible.filter(x=>x.tested);
    return {...month,mappedLaunches:cohort.filter(x=>x.mapped).length,matureAssets:eligible.length,testedAssets:evaluated.length,winners:wins.length,yield:eligible.length?wins.length/eligible.length:null,testedHitRate:evaluated.length?wins.length/evaluated.length:null,amer:month.verifiedNewRevenue!=null&&month.googleSpend!=null&&month.spend+month.googleSpend>0?month.verifiedNewRevenue/(month.spend+month.googleSpend):null};
  });
  const complete=cohorts.filter(x=>x.month>='2025-09'&&!x.partial&&Number.isFinite(x.dtcRevenue));
  const lagged=complete.map(m=>{const next=new Date(`${m.month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);const following=complete.find(x=>x.month===next.toISOString().slice(0,7));return following?[m.launchedAssets,following.dtcRevenue]:null;}).filter(Boolean);
  const recentWinners=assets.filter(x=>x.recentWinner);
  const backtests=cohorts.filter(m=>m.month>=input.dailyHistoryStart.slice(0,7) && !m.partial).flatMap(m=>{
    const cohort=assets.filter(x=>x.mapped&&x.firstMonth===m.month);
    if(!cohort.length||cohort.some(x=>!x.mature))return [];
    const training=assets.filter(x=>x.mapped&&x.firstDate&&x.firstDate>=input.dailyHistoryStart&&day(x.firstDate)+36<day(m.month+'-01'));
    const priorWinners=training.filter(x=>x.winner);
    if(training.length<20||priorWinners.length<3)return [];
    const predicted=cohort.length*(priorWinners.length/training.length)*quantile(priorWinners.map(x=>x.spend),.5);
    return [{month:m.month,trainingAssets:training.length,launchedAssets:cohort.length,predictedSpend:predicted,actualSpend:sum(cohort.filter(x=>x.winner),'spend')}];
  });
  const actualBacktestSpend=sum(backtests,'actualSpend');
  const backtestError=actualBacktestSpend?backtests.reduce((total,b)=>total+Math.abs(b.predictedSpend-b.actualSpend),0)/actualBacktestSpend:null;
  return {backtests,backtestError,asOf:input.asOf,attribution:input.attribution,assumptions:a,cohorts,assets,sampleSize:sample.length,tested:tested.length,winners:winners.length,hitRate:sample.length?winners.length/sample.length:null,testedHitRate:tested.length?winners.length/tested.length:null,capacityMedian:quantile(winners.map(x=>x.spend),.5),capacityP25:quantile(winners.map(x=>x.spend),.25),capacityP75:quantile(winners.map(x=>x.spend),.75),capacityMean:winners.length?sum(winners,'spend')/winners.length:null,failedTestCost:failures.length?sum(failures,'spend')/failures.length:0,winDaysMedian:quantile(winners.map(x=>x.winDay).filter(x=>x!=null),.5),existingCapacity:sum(recentWinners.map(x=>x.recent),'spend'),existingWinners:recentWinners.length,correlations:{launchesRevenue:correlation(complete.map(x=>[x.launchedAssets,x.dtcRevenue])),launchesNextRevenue:correlation(lagged),spendRevenue:correlation(complete.map(x=>[x.spend,x.dtcRevenue]))}};
}
export function planCreativeDemand(evidence, target, amer, capacity = evidence.capacityMedian) {
  const a=evidence.assumptions;
  if(!(Number.isFinite(amer)&&amer>0)||!Number.isFinite(target.dtcRevenue)||target.dtcRevenue<0)throw new Error('A positive aMER and nonnegative DTC revenue target are required.');
  const netRevenue=target.dtcRevenue*(1-a.returnsPct/100),newRevenue=netRevenue*a.newCustomerShare/100,totalBudget=newRevenue/amer;
  const metaBudget=Math.max(0,totalBudget-a.otherSpend),testingBudget=metaBudget*a.testBudgetPct/100;
  const baselineMonth=evidence.asOf.slice(0,7),monthDistance=(Number(target.month.slice(0,4))-Number(baselineMonth.slice(0,4)))*12+Number(target.month.slice(5))-Number(baselineMonth.slice(5));
  const retentionPeriods=Math.max(1,monthDistance);
  const existing=Math.min(metaBudget-testingBudget,evidence.existingCapacity*(a.retainedCapacity/100)**retentionPeriods);
  const gap=Math.max(0,metaBudget-testingBudget-existing);
  const ready=gap===0 || (evidence.sampleSize>=10 && evidence.winners>=3 && capacity>0 && evidence.hitRate>0);
  const winners=gap===0?0:ready?Math.ceil(gap/capacity):null;
  const assets=gap===0?0:ready?Math.ceil(winners/evidence.hitRate):null;
  const expectedFailedTestSpend=assets==null?null:assets*(1-evidence.hitRate)*evidence.failedTestCost;
  const unsuccessfulCostPerLaunch=(1-(evidence.hitRate||0))*evidence.failedTestCost;
  const budgetSupportedLaunches=unsuccessfulCostPerLaunch>0?Math.floor(testingBudget/unsuccessfulCostPerLaunch):null;
  const requiredCapacityPerWinner=budgetSupportedLaunches>0&&evidence.hitRate>0?gap/(budgetSupportedLaunches*evidence.hitRate):null;
  const flags=[];
  if(totalBudget<a.otherSpend)flags.push('Other channels already exceed the allowable total budget.');
  if(!ready)flags.push('Insufficient mature winners to estimate an asset target.');
  if(expectedFailedTestSpend>testingBudget)flags.push('Expected unsuccessful-test spend exceeds the testing reserve.');
  if(evidence.winners<10)flags.push('Small winner sample: treat the target as provisional.');
  if(evidence.backtestError!=null&&evidence.backtestError>.5)flags.push('Historical holdout error exceeds 50%; this is a diagnostic, not a production quota.');
  const launchBy=new Date(`${target.month}-01T00:00:00Z`),briefBy=new Date(launchBy.getTime()-a.productionLeadDays*DAY);
  return {budgetSupportedLaunches,requiredCapacityPerWinner,month:target.month,amer,netRevenue,newRevenue,totalBudget,metaBudget,testingBudget,existing,gap,capacity,winners,assets,weeklyAssets:assets==null?null:Math.ceil(assets/4),expectedFailedTestSpend,flags,ready,launchBy:launchBy.toISOString().slice(0,10),briefBy:briefBy.toISOString().slice(0,10)};
}
