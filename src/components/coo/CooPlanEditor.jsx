import React, { useState } from 'react';
import { apiJson } from '../../lib/api.js';
import { FORECAST_FIELDS, forecastPlan } from '../../lib/coo.js';
export default function CooPlanEditor({values,set,cycle,locked,onLoadingChange}) {
  const [field,setField]=useState('netRevenue'),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const plan=values.plan||[];
  const change=(index,key,value)=>set('plan',plan.map((p,i)=>i===index?{...p,[key]:value}:p));
  const importForecast=async()=>{
    setLoading(true);onLoadingChange?.(true);setError('');
    try {
      const result=await apiJson('/api/forecast');
      const imported=forecastPlan(result.forecast,field,cycle);
      for(const [key,value] of Object.entries(imported))set(key,value);
      set('direction','increase');
      set('planSource',`${FORECAST_FIELDS[field]} from ${result.forecast?.sheetName||'Campfire business forecast'}; cached ${result.updatedAt||'date unknown'}`);
    } catch(e){setError(e.message);}finally{setLoading(false);onLoadingChange?.(false);}
  };
  return <section className="coo-plan-editor coo-wide"><h3>Agreed plan</h3><p>Set the value you expect at each checkpoint. Use cumulative totals for revenue or units, and point-in-time values for rates. No straight-line pace is assumed between dates.</p>
    {locked&&<p className="coo-lock-note">This plan is locked. Log a revised forecast in Update progress; the agreed plan stays intact.</p>}
    <fieldset disabled={locked||loading}>
      {plan.map((p,i)=><div className="coo-plan-row" key={i}><label>Checkpoint {i+1} date<input type="date" required min={cycle?.start} max={cycle?.end} value={p.date} onChange={e=>change(i,'date',e.target.value)}/></label><label>Planned value {i+1}<input type="number" step="any" required value={p.value} onChange={e=>change(i,'value',e.target.value)}/></label><button type="button" aria-label={`Remove checkpoint ${i+1}`} onClick={()=>set('plan',plan.filter((_,j)=>j!==i))}>Remove</button></div>)}
      <button type="button" disabled={!cycle} onClick={()=>set('plan',[...plan,{date:cycle?.end||'',value:values.target}])}>Add checkpoint</button>
      <p className="coo-hint">The final checkpoint must match the goal on {cycle?.end||'the cycle end date'}. Before the first checkpoint, pace is shown as “Plan needed.”</p>
      <details className="coo-import"><summary>Import monthly financial forecast</summary><p>Copies the cached plan into this draft. Review its definition and values before saving. The business forecast is not modified or continuously synchronized.</p><label>Forecast measure<select value={field} onChange={e=>setField(e.target.value)}>{Object.entries(FORECAST_FIELDS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button type="button" disabled={!cycle||loading} onClick={importForecast}>{loading?'Loading forecast…':'Import into draft'}</button></details>
    </fieldset>
    {values.planSource&&<p className="coo-hint">Source: {values.planSource}</p>}{error&&<p role="alert" className="coo-error">{error}</p>}
  </section>;
}
