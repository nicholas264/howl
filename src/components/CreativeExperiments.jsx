import React, { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';

export default function CreativeExperiments({ variants, canWrite=false }) {
  const [items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState([]),[name,setName]=useState(''),[hypothesis,setHypothesis]=useState('');
  const [metric,setMetric]=useState('roas'),[days,setDays]=useState(14);
  const [decisionId,setDecisionId]=useState(''),[choice,setChoice]=useState(''),[reason,setReason]=useState('');
  useEffect(()=>{let active=true;apiJson('/api/creative-experiments').then(data=>{if(active)setItems(data.experiments);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function save(body,method) {
    setBusy(true);setError('');
    try {
      await apiJson('/api/creative-experiments',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await apiJson('/api/creative-experiments');setItems(data.experiments);
      if(method==='POST'){setName('');setHypothesis('');setSelected([]);}else{setDecisionId('');setReason('');setChoice('');}
    } catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <details style={{marginTop:20}}><summary>Plan and review creative comparisons</summary>
    <p>Register a hypothesis before observations begin. Ad assignments are frozen at registration. These comparisons use Meta-attributed outcomes and cannot prove causal lift.</p>
    {error && <p role="alert">{error}</p>}
    {canWrite && <form onSubmit={e=>{e.preventDefault();save({name,hypothesis,protocol:{variants:selected,metric,days,minPurchases:20,minImpressions:1000}},'POST');}}>
      <p><label>Name <input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} /></label></p>
      <p><label>Hypothesis <textarea required minLength={10} maxLength={2000} value={hypothesis} onChange={e=>setHypothesis(e.target.value)} /></label></p>
      <p><label>Primary metric <select value={metric} onChange={e=>setMetric(e.target.value)}><option value="roas">ROAS</option><option value="cpa">Cost per purchase</option><option value="purchase_rate">Purchases per impression</option></select></label>{' '}
        <label>Observation days <input type="number" min={7} max={90} required value={days} onChange={e=>setDays(Number(e.target.value))} /></label></p>
      <fieldset style={{maxHeight:180,overflow:'auto'}}><legend>Select 2–10 variants</legend>{variants.filter(v=>v.variant_key.startsWith('variant:')).map(v=><label key={v.variant_key} style={{display:'block'}}><input type="checkbox" checked={selected.includes(v.variant_key)} disabled={!selected.includes(v.variant_key)&&selected.length>=10} onChange={e=>setSelected(old=>e.target.checked?[...old,v.variant_key]:old.filter(id=>id!==v.variant_key))} /> {v.name || v.variant_key}</label>)}</fieldset>
      <p>Starts tomorrow (UTC); requires at least 20 purchases and 1,000 impressions per variant after the full window.</p>
      <button disabled={busy || selected.length<2}>Register comparison</button>
    </form>}
    {items.map(item=><article key={item.id} style={{borderTop:'1px solid #dedbd5',marginTop:16,paddingTop:12}}>
      <strong>{item.name}</strong><p>{item.hypothesis}</p><p>{item.protocol.since} through {item.protocol.until} (exclusive) · {item.protocol.metric} · {item.status}</p>
      <p>{item.decision ? item.decision.reason : item.evidence.conclusion}</p>
      <table><thead><tr><th>Variant</th><th>Spend</th><th>Purchases</th><th>Impressions</th></tr></thead><tbody>{item.evidence.rows.map(row=><tr key={row.variant_key}><td>{variants.find(v=>v.variant_key===row.variant_key)?.name || row.variant_key}</td><td>${row.spend.toFixed(2)}</td><td>{row.purchases}</td><td>{row.impressions}</td></tr>)}</tbody></table>
      {canWrite && item.status==='running' && <button onClick={()=>{setDecisionId(String(item.id));setChoice('');setReason('');}}>Record decision</button>}
      {decisionId===String(item.id) && <form onSubmit={e=>{e.preventDefault();save({id:item.id,selected_variant:choice,reason},'PATCH');}}>
        <label>Outcome <select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Inconclusive / stop comparison</option>{item.evidence.sufficient && item.protocol.variants.map(id=><option key={id} value={id}>{variants.find(v=>v.variant_key===id)?.name || id}</option>)}</select></label>
        <p><label>Decision rationale <textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} /></label></p>
        <button disabled={busy}>Save immutable decision</button>{' '}<button type="button" onClick={()=>setDecisionId('')}>Cancel</button>
      </form>}
    </article>)}
  </details>;
}
