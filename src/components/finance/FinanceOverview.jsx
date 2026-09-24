import ChartHoverLayer from './ChartHoverLayer.jsx';
import React,{useState} from 'react';
const pct=n=>Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'—';
const monthLabel=m=>new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',timeZone:'UTC'});
function RevenueChart({periods,months,targets,money,demo}){
 const [selected,setSelected]=useState(null);
 const rows=periods.map(month=>({month,actual:months.find(m=>m.month===month)?.revenue,target:targets[month]}));
 const values=rows.flatMap(r=>[r.actual,r.target]).filter(Number.isFinite),low=Math.min(0,...values),high=Math.max(1,...values)*1.15;
 const x=i=>64+i*660/11,y=v=>210-(v-low)/(high-low)*175;
 const line=key=>rows.map((r,i)=>Number.isFinite(r[key])?`${i===0||!Number.isFinite(rows[i-1][key])?'M':'L'}${x(i)},${y(r[key])}`:'').join(' ');
 const chosen=rows[selected??Math.max(0,months.length-1)];
 return <div className="fin-revenue-chart"><div className="fin-chart-readout" aria-live="polite"><span>{monthLabel(chosen.month)} <strong>{money(chosen.actual)}</strong></span><span>Target <strong>{money(chosen.target)}</strong></span></div>
 <svg viewBox="0 0 760 226" role="group" aria-label={`${demo?'Sample':'Booked'} monthly revenue against targets. Hover a dot or select a month for values.`}>
 {[0,1,2,3].map(i=>{const v=low+(high-low)*i/3;return <g key={i}><line x1="64" x2="736" y1={y(v)} y2={y(v)} stroke="#edf0f6"/><text x="54" y={y(v)+4} textAnchor="end" fill="#7b8598" fontSize="11">{new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v)}</text></g>;})}
 <path d={line('target')} fill="none" stroke="#a5adc2" strokeWidth="2" strokeDasharray="5 5"/>
 <path d={line('actual')} fill="none" stroke="#635bce" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
 {rows.map((r,i)=><g key={r.month}>{Number.isFinite(r.target)&&<circle cx={x(i)} cy={y(r.target)} r={selected===i?4:2.5} fill="#a5adc2" stroke="white" strokeWidth="1.5"/>}{Number.isFinite(r.actual)&&<circle cx={x(i)} cy={y(r.actual)} r={selected===i?6:3.5} fill="#635bce" stroke="white" strokeWidth="2"/>}</g>)}
 <ChartHoverLayer rows={rows} series={[{key:'actual',label:demo?'Sample revenue':'Booked revenue',color:'#635bce'},{key:'target',label:'Revenue target',color:'#a5adc2'}]} x={x} y={y} format={money} onSelect={setSelected}/>
 </svg><div className="fin-month-selector" aria-label="Inspect month">{rows.map((r,i)=><button key={r.month} aria-label={`Inspect ${r.month}`} aria-pressed={selected===i} onClick={()=>setSelected(i)} onFocus={()=>setSelected(i)}>{monthLabel(r.month)}</button>)}</div>
 <div className="fin-plot-key"><span><i/>{demo?'Sample revenue':'Booked revenue'}</span><span><i/>Revenue target</span></div></div>;
}
export default function FinanceOverview({snapshot,periods,months,settings,ratios,pacing,costs,money,demo,onNavigate,scenarioContent,profitChart,breakEven,trends}){
 const complete=pacing.variance!=null&&pacing.closedMonths>0,behind=complete&&pacing.variance<0;
 const status=!complete?'Plan incomplete':behind?'Behind plan':'On track';
 const monthlyBreakEven=breakEven.sales;
 const monthlyRevenue=breakEven.revenue;
 const latestLabel=breakEven.month?new Date(`${breakEven.month}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}):'Latest month';
 const remaining=pacing.requiredRemaining;
 return <>
 <div className="fin-period-line"><span>{settings.start.slice(0,4)} fiscal plan <b> / </b> {months.length} completed months</span><span>{settings.currency} · {settings.basis} basis</span></div>
 <div className="fin-executive-grid">
 <section className="fin-runway"><div className="fin-section-heading"><h2>Are we on pace?</h2><span className={`fin-status ${!complete?'neutral':behind?'behind':'ahead'}`}>{status}</span></div>
 <div className="fin-revenue-total"><strong>{money(ratios.revenue)}</strong><span>{demo?'sample revenue':'booked revenue'} this fiscal year</span></div>
 <p className="fin-pace-summary">{complete?<><strong>{money(Math.abs(pacing.variance))} {behind?'below':'above'} plan</strong> through {monthLabel(months.at(-1).month)}. {behind?'The remaining months need a stronger pace.':'Revenue is meeting the planned pace.'}</>:'Add monthly targets and sync missing reports to measure your pace.'}</p>
 <RevenueChart periods={periods} months={months} targets={settings.targets} money={money} demo={demo}/>
 <div className="fin-runway-footer"><div><span>Annual target</span><strong>{money(pacing.annualTarget)}</strong></div><div><span>Still to go</span><strong>{money(remaining)}</strong></div><button onClick={()=>onNavigate('plan')}>Edit annual plan</button></div>
 </section>
 {profitChart}
 <aside className="fin-target-panel"><span className="fin-target-label">Your path to the annual target</span><div className="fin-target-progress"><strong>{pct(pacing.attainment)}</strong><span>achieved</span></div><div className="fin-progress-track" role="img" aria-label={`${pct(pacing.attainment)} of annual revenue target achieved`}><i style={{width:`${Math.min(100,Math.max(0,(pacing.attainment||0)*100))}%`}}/></div>
 <div className="fin-required"><span>Needed each remaining month</span><strong>{money(pacing.requiredMonthly)}</strong><small>Across {pacing.remainingMonths} remaining months</small></div>
 <div className="fin-target-bottom"><span>Actual + remaining plan</span><strong>{money(pacing.actualPlusRemainingPlan)}</strong><p>A planning scenario, not a predicted result.</p></div></aside>
 </div>
 {pacing.missingActual.length>0&&<p className="fin-alert">{pacing.missingActual.length} completed months are missing. Sync reports to update pacing.</p>}
 <div className="fin-lower-grid"><section className="fin-break-panel"><div className="fin-section-heading"><h2>What does it take to break even?</h2><span className={`fin-status ${monthlyBreakEven==null?'neutral':monthlyRevenue>=monthlyBreakEven?'ahead':'behind'}`}>{monthlyBreakEven==null?'Needs review':monthlyRevenue>=monthlyBreakEven?'Above break-even':'Below break-even'}</span></div>
 <div className="fin-break-main"><div><strong>{money(monthlyBreakEven)}</strong><span>monthly break-even · {latestLabel} OpEx</span></div><p>{monthlyBreakEven==null?'Classify costs and establish a positive contribution margin to calculate break-even.':<>{latestLabel} revenue was <b>{money(monthlyRevenue)}</b>.</>}</p></div>
 <div className="fin-cost-equation"><div><span>{latestLabel} {costs.method==='selling'?'operating budget':'fixed costs'}</span><strong>{money(breakEven.operatingBudget)}</strong></div><span aria-hidden="true">÷</span><div><span>YTD contribution margin</span><strong>{pct(ratios.contributionMargin)}</strong></div><button onClick={()=>onNavigate('costs')}>{costs.unclassified.length?`Review ${costs.unclassified.length} accounts`:'Review cost assumptions'}</button></div>
 <p className="fin-footnote">{costs.method==='selling'?`Uses ${latestLabel} operating expenses after deducting selling expenses, divided by the year-to-date contribution margin after COGS and selling expenses. Holds that operating budget and sales cost mix constant.`:`Uses ${latestLabel} classified fixed costs and the year-to-date contribution margin.`} Excludes other income and expenses, debt principal, and capital spending.</p>{scenarioContent}</section>
 <section className="fin-profit-panel"><h2>Profitability</h2>{[['Gross margin',ratios.grossMargin,'After cost of goods sold'],['Contribution margin',ratios.contributionMargin,costs.method==='selling'?'After COGS and selling expenses':'After variable operating costs'],['Net margin',ratios.netMargin,'After all reported expenses']].map(([label,value,note])=><div className="fin-profit-row" key={label}><div><span>{label}</span><small>{note}</small></div><strong>{pct(value)}</strong></div>)}<button onClick={()=>onNavigate('costs')}>Manage classifications</button></section></div>
 {trends}
 <section className="fin-liquidity"><div><h2>Balance-sheet snapshot</h2><p>As of {snapshot.balance.asOf}</p></div>{[['Current ratio',ratios.currentRatio,'Current assets / current liabilities'],['Quick ratio',ratios.quickRatio,'Cash + receivables / current liabilities'],['Liabilities to equity',ratios.debtToEquity,'Total liabilities / equity']].map(([label,value,formula])=><div key={label} title={formula}><span>{label}</span><strong>{value==null?'—':`${value.toFixed(2)}×`}</strong></div>)}</section>
 <footer className="fin-data-footer"><span>{demo?'Sample data only. QuickBooks is not connected.':`QuickBooks reports updated ${new Date(snapshot.syncedAt).toLocaleString()}`}</span><span>Shopify sales stay in the sales dashboard.</span></footer>
 </>;
}
