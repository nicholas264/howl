import React, {useEffect,useMemo,useState} from 'react';
import {apiFetch} from '../../lib/apiFetch.js';
import {buildCreativeEvidence,DEFAULT_DEMAND_ASSUMPTIONS,validateDemandAssumptions} from '../../lib/creative-demand.js';
import './creative-demand.css';
import LifecyclePlanning from './LifecyclePlanning.jsx';
const money=n=>n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const pct=n=>n==null?'—':`${(n*100).toFixed(1)}%`;
const month=m=>new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
const fields=[['roasFloor','Meta ROAS floor',.1,100,.1],['minTestSpend','Minimum test spend ($)',1,100000,100],['minWinnerSpend','Minimum winner spend ($)',1,1000000,100],['minPurchases','Minimum purchases',1,1000,1],['newCustomerShare','New-customer revenue share (%)',1,100,1],['otherSpend','Other monthly ad spend ($)',0,10000000,1000],['weeklyCapacity','Maximum assets per week (0 = unset)',0,10000,1],['testBudgetPct','Unsuccessful-test reserve (%)',0,90,1],['productionLeadDays','Production lead time (days)',0,180,1],['returnsPct','Revenue returns allowance (%)',0,90,.1]];
export default function CreativeDemandWorkspace({canSave=false,onOpenForecast}) {
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[inputs,setInputs]=useState({...DEFAULT_DEMAND_ASSUMPTIONS}),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[year,setYear]=useState('2026');
  useEffect(()=>{let active=true;apiFetch('/api/creative-demand').then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load creative demand.');if(active){setData(d);setInputs(d.assumptions||{...DEFAULT_DEMAND_ASSUMPTIONS});}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const validated=useMemo(()=>{try{return {value:validateDemandAssumptions(inputs)};}catch(e){return {error:e.message};}},[inputs]);
  const evidence=useMemo(()=>data?.history&&validated.value?buildCreativeEvidence(data.history,validated.value):null,[data,validated]);
  async function save(){setSaving(true);setError('');try{const r=await apiFetch('/api/creative-demand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assumptions:validated.value})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save assumptions.');setSaved(true);}catch(e){setError(e.message);}finally{setSaving(false);}}
  if(loading)return <div className="cd-workspace" role="status">Loading creative history…</div>;
  if(!data?.history)return <div className="cd-workspace"><h1>Creative demand</h1><p role="alert">{error||'No historical baseline is available yet. Import the account history to build a demand plan.'}</p></div>;
  const history=data.history,cohorts=evidence?.cohorts.filter(m=>m.month.startsWith(year))||[];
  const maxLaunch=Math.max(1,...cohorts.map(m=>m.launchedAssets));
  const stale=(Date.now()-Date.parse(history.asOf+'T00:00:00Z'))/86400000>7;
  return <main className="cd-workspace">
    <header className="cd-header"><div><h1>Creative demand</h1><p>Your monthly creative recommendation at a 4.5× aMER target.</p></div><button type="button" onClick={onOpenForecast}>View production forecast</button></header>
    {stale&&<p className="cd-notice">This baseline is more than seven days old. Refresh the historical import before approving a new production plan.</p>}
    {error&&<p className="cd-notice" role="alert">{error}</p>}
    {evidence&&<LifecyclePlanning history={history} assumptions={validated.value}/>}
    <details className="cd-assumptions" open={!!validated.error}><summary>Definitions & planning assumptions <span>{saved?'Saved':'Adjust budgets, timing, and capacity'}</span></summary>
      <p>A hit meets the Meta ROAS, spend, and purchase thresholds in its first 30 days. We wait another seven days for attribution. Meta ROAS is a separate measure from aMER (new-customer revenue ÷ total ad spend).</p>
      <div className="cd-fields">{fields.map(([key,label,min,max,step])=><label key={key}>{label}<input type="number" min={min} max={max} step={step} value={inputs[key] ?? DEFAULT_DEMAND_ASSUMPTIONS[key]} onChange={e=>{setInputs({...inputs,[key]:e.target.value});setSaved(false);}}/></label>)}</div>
      <p>Revenue share, channel budgets, team capacity, and production lead time are editable assumptions. Profitability still depends on product mix, discounts, and contribution margin. Returns allowance applies to the source sheet’s revenue.</p>
      {validated.error&&<p role="alert" className="cd-notice">{validated.error}</p>}
      {canSave&&<button type="button" disabled={saving||!!validated.error} onClick={save}>{saving?'Saving…':saved?'Assumptions saved':'Save assumptions'}</button>}
    </details>
    {evidence&&<>
      <details className="cd-section"><summary>Historical launches, hit rates & revenue analysis</summary>
      <section className="cd-evidence" aria-label="Historical benchmarks">
        <div><span>Launch-to-winner yield</span><strong>{pct(evidence.hitRate)}</strong><small>{evidence.winners} winners / {evidence.sampleSize} mature mapped assets</small></div>
        <div><span>Hit rate among tested assets</span><strong>{pct(evidence.testedHitRate)}</strong><small>{evidence.tested} reached {money(inputs.minTestSpend)} in 30 days</small></div>
        <div><span>Spend per new winner</span><strong>{money(evidence.capacityMedian)}</strong><small>Median first 30 days · mean {money(evidence.capacityMean)}</small></div>
        <div><span>Existing qualified spend</span><strong>{money(evidence.existingCapacity)}</strong><small>{evidence.existingWinners} winners · latest mature 30 days</small></div>
      </section>
      <section className="cd-section"><div className="cd-section-head"><div><h2>Historical launches & hit rate</h2><p>First delivery determines launch month. Repeated ad IDs sharing the same media are grouped.</p></div><label>Year<select value={year} onChange={e=>setYear(e.target.value)}>{[...new Set(history.months.map(m=>m.month.slice(0,4)))].reverse().map(y=><option key={y}>{y}</option>)}</select></label></div>
        <div className="cd-chart" role="img" aria-label={`Unique media assets first delivered by month in ${year}; exact counts follow in the table.`}>{cohorts.map(m=><div key={m.month}><span>{m.launchedAssets}</span><i style={{height:`${Math.max(2,m.launchedAssets/maxLaunch*100)}px`}}/><small>{month(m.month).slice(0,3)}{m.partial?'*':''}</small></div>)}</div>
        <div className="cd-table-wrap"><table><thead><tr><th>Month</th><th>New ad IDs</th><th>New media assets*</th><th>Mature / tested</th><th>Winners</th><th>Launch yield</th><th>Tested hit rate</th><th>Meta spend</th><th>DTC revenue</th><th>aMER</th></tr></thead><tbody>{cohorts.map(m=><tr key={m.month}><th>{month(m.month)}{m.partial?' · partial':''}</th><td>{m.launchedAds}</td><td>{m.launchedAssets}</td><td>{m.month<history.dailyHistoryStart.slice(0,7)?'—':`${m.matureAssets} / ${m.testedAssets}`}</td><td>{m.matureAssets?m.winners:'—'}</td><td>{pct(m.yield)}</td><td>{pct(m.testedHitRate)}</td><td>{money(m.spend)}</td><td>{m.month<'2025-09'?'Unverified':money(m.dtcRevenue)}</td><td>{m.amer==null?'Unavailable':m.amer.toFixed(2)+'×'}</td></tr>)}</tbody></table></div>
        <p className="cd-caption">*Exact media sets, with unmapped ad IDs counted separately. Reuploads can count again; these are not concept counts. Benchmark rates exclude unmapped ads. Daily first-30-day benchmarks begin {month(history.dailyHistoryStart.slice(0,7))}; recent cohorts remain immature. The first observed history month may include older creatives.</p>
      </section>
      <section className="cd-section"><h2>Does more creative predict more revenue?</h2><div className="cd-correlations">{[['launchesRevenue','Launches → same-month revenue'],['launchesNextRevenue','Launches → following-month revenue'],['spendRevenue','Meta spend → same-month revenue']].map(([key,label])=><div key={key}><span>{label}</span><strong>{evidence.correlations[key].r==null?'—':'r = '+evidence.correlations[key].r.toFixed(2)}</strong><small>{evidence.correlations[key].n} complete monthly observations</small></div>)}</div><p>These are descriptive correlations, not causal effects. Promotions, pricing, product launches, and seasonality are not controlled. Revenue before September 2025 and the current partial month are excluded.</p>
        <h3>Historical holdout check</h3><p>For each eligible launch month, estimate qualified first-30-day spend using only earlier cohorts whose evaluation windows had closed before that month began.</p><div className="cd-table-wrap"><table><thead><tr><th>Launch month</th><th>Earlier assets</th><th>New assets</th><th>Estimated qualified spend</th><th>Actual qualified spend</th></tr></thead><tbody>{evidence.backtests.map(b=><tr key={b.month}><th>{month(b.month)}</th><td>{b.trainingAssets}</td><td>{b.launchedAssets}</td><td>{money(b.predictedSpend)}</td><td>{money(b.actualSpend)}</td></tr>)}</tbody></table></div><p className="cd-caption">Absolute error / actual qualified spend: <strong>{pct(evidence.backtestError)}</strong>. This checks the creative benchmark, not revenue causality or aMER attainment.</p>
      </section>
      <details className="cd-section"><summary>Audit the winning assets</summary><div className="cd-table-wrap"><table><thead><tr><th>Asset name</th><th>First delivery</th><th>Ad IDs</th><th>30-day spend</th><th>Purchases</th><th>Meta ROAS</th></tr></thead><tbody>{evidence.assets.filter(a=>a.winner).sort((a,b)=>b.spend-a.spend).map(a=><tr key={a.key}><th>{a.name}</th><td>{a.firstDate}</td><td>{a.adCount}</td><td>{money(a.spend)}</td><td>{a.purchases}</td><td>{a.roas.toFixed(2)}×</td></tr>)}</tbody></table></div></details>
      </details>
    </>}
    <div className="cd-source"><span>Meta history through <strong>{history.asOf}</strong> · {history.attribution}</span><a href={history.targetSource.url} target="_blank" rel="noreferrer">Q4 target source</a></div>
    <details className="cd-section"><summary>Sources & data limits</summary><ul>{history.warnings.map(w=><li key={w}>{w}</li>)}</ul><p>Historical snapshot imported {history.fetchedAt?.slice(0,10)}. This view does not automatically refresh Meta or Shopify. Source: {history.accountName}; Campfire monthly revenue snapshots; updated Q4 build/sell plan.</p></details>
  </main>;
}
