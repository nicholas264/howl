import { useEffect, useState } from 'react';
import { apiJson } from '../../lib/api.js';
import { studioRequest } from '../../lib/static-studio/client.js';
const money=(value,digits=2)=>Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits});
const stages={analyze:'Photo analysis',direct:'Concept development',refine:'Revision',review:'Visual review'};
export default function StudioCosts() {
  const [month,setMonth]=useState(()=>new Date().toISOString().slice(0,7));
  const [data,setData]=useState(null),[settings,setSettings]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
  const [planned,setPlanned]=useState(500);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    apiJson(`/api/static-studio?view=costs&month=${encodeURIComponent(month)}`).then(result=>{if(active){setData(result);setSettings(result.settings);}}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[month,refresh]);
  async function save(event) {
    event.preventDefault();setSaving(true);setError('');setNotice('');
    try{const result=await studioRequest({action:'model-settings',settings});setSettings(result.settings);setData(d=>({...d,settings:result.settings}));setNotice('Model choices saved. New requests will use these models.');}
    catch(err){setError(err.message);}finally{setSaving(false);}
  }
  const percent=data?Math.min(100,data.summary.cost/data.settings.monthlyTarget*100):0;
  return <section className="ss-costs" aria-label="Costs and models">
    <div className="ss-cost-heading"><div><p className="ss-eyebrow">YOUR STATIC STUDIO / USD</p><h2>Know what every idea costs.</h2><p>Usage from your studio, including paid attempts that needed revision.</p></div><div className="ss-cost-period"><label>Usage month (UTC)<input type="month" disabled={saving} min="2020-01" max="2100-12" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label><button className="ss-button" disabled={loading || saving} onClick={()=>setRefresh(n=>n+1)}>Refresh usage</button></div></div>
    {error && <div className="ss-alert" role="alert">{error}</div>}
    {notice && <div className="ss-notice" role="status">{notice}</div>}
    {loading && <p role="status">Loading recorded usage…</p>}
    {data && <>
      <div className="ss-cost-metrics">
        <article><span>Recorded AI cost · estimated</span><strong>{money(data.summary.cost)}</strong><small>{data.summary.unknown?'Partial total — some requests have unknown cost.':'Calculated from provider-reported tokens.'}</small></article>
        <article><span>Model requests</span><strong>{data.summary.requests}</strong><small>{data.summary.completed} returned JSON responses</small></article>
        <article><span>Monthly planning target</span><strong>{money(data.settings.monthlyTarget,0)}</strong><progress max="100" value={percent} aria-label="Recorded cost against planning target"/><small>{Math.round(data.summary.cost/data.settings.monthlyTarget*100)}% used · planning only, not a spending cap</small></article>
      </div>
      {data.summary.unknown>0 && <div className="ss-alert" role="status">{data.summary.unknown} request(s) have unconfirmed costs, including pending, rejected, or interrupted requests. Check provider billing before treating the total as complete.</div>}
      <div className="ss-cost-columns">
        <form className="ss-cost-card" onSubmit={save}><p className="ss-eyebrow">MODEL ROUTING</p><h3>Choose your creative team.</h3><p>Photos and prompts go to the provider selected for each stage. Product pixels stay in the controlled renderer.</p>
          {[['creativeModel','Creative direction & photo analysis'],['reviewModel','Independent visual review']].map(([key,label])=><label key={key}>{label}<select value={settings[key]} onChange={e=>setSettings(s=>({...s,[key]:e.target.value}))}>{data.models.map(m=><option key={m.id} value={m.id}>{m.label}{m.configured?'':' · key missing'}</option>)}</select></label>)}
          {settings.creativeModel===settings.reviewModel && <p>These stages use separate calls to the same model. Choose different models for a second perspective.</p>}
          <label>Monthly planning target ($)<input type="number" min="1" max="100000" step="0.01" required value={settings.monthlyTarget} onChange={e=>setSettings(s=>({...s,monthlyTarget:e.target.value===''?'':Number(e.target.value)}))}/></label>
          <p className="ss-cost-note">This target does not stop requests. Existing server rate and daily operation limits still apply. Settings affect your studio only.</p>
          <button className="ss-button ss-primary" disabled={saving}>{saving?'Saving…':'Save models & target'}</button>
          <div className="ss-provider-status">{['openai','anthropic'].map(provider=>{const ready=data.models.some(m=>m.provider===provider&&m.configured);return <p key={provider}><strong>{provider==='openai'?'OpenAI':'Anthropic'}</strong><span>{ready?'Server key configured':'Server key missing'}</span></p>;})}</div><small>Key presence does not confirm model access or available credits. Manage credentials and billing in the provider consoles; never paste keys here.</small><p><a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">OpenAI billing ↗</a> · <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">Anthropic billing ↗</a></p>
        </form>
        <div className="ss-cost-card"><p className="ss-eyebrow">PLAN YOUR OUTPUT</p><h3>One concept. Two placements.</h3><label>Unique concepts per month<input type="number" min="1" max="10000" value={planned} onChange={e=>setPlanned(Math.max(0,Math.min(10000,Number(e.target.value))))}/></label><div className="ss-cost-forecast"><strong>{(planned*2).toLocaleString()} files</strong><span>4:5 + 9:16 for every concept</span></div><p><b>{money(planned*.7,0)}–{money(planned*1.4,0)}</b> estimated AI planning range with Astra + Fable.</p><p className="ss-cost-note">Assumes 20k–40k total input and 10k–20k output tokens per concept across exploration, both-format reviews and revisions. Reasoning tokens count as output. This is a planning assumption, not measured cost per approved ad.</p><hr/><h4>What is included?</h4><p>Only Static Studio model calls recorded after this feature launched. Historical calls, other tools, hosting, storage, taxes, human time and media spend are excluded.</p><p>AI image generation is not enabled in this workflow. There are no generated-background charges here.</p><p className="ss-cost-note">Rates checked {data.rateVersion}. Costs include cache discounts when reported. Provider invoices are the billing authority.</p><p><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">OpenAI pricing ↗</a> · <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer">Anthropic pricing ↗</a></p></div>
      </div>
      <div className="ss-cost-card"><h3>By stage and model</h3>{!data.breakdown.length?<p>No recorded model calls this month. Generate or review a concept, then refresh usage.</p>:<div className="ss-cost-table"><table><thead><tr><th>Stage</th><th>Model</th><th>Requests</th><th>Estimated cost</th></tr></thead><tbody>{data.breakdown.map(row=><tr key={`${row.stage}:${row.model}`}><td>{stages[row.stage] || row.stage}</td><td>{data.models.find(m=>m.id===row.model)?.label || row.model}</td><td>{row.requests}</td><td>{money(row.cost,4)}{row.unknown>0?' + unknown':''}</td></tr>)}</tbody></table></div>}</div>
      {data.recent.length>0 && <div className="ss-cost-card"><h3>Recent requests</h3><p>Latest 100 for the selected month. Totals above include every request.</p><div className="ss-cost-table"><table><thead><tr><th>Time</th><th>Stage / model</th><th>Status</th><th>Input / output tokens</th><th>Estimated cost</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{stages[row.stage]}<small>{row.reported_model || row.model}</small></td><td>{row.status==='pending'?'Pending / unconfirmed':row.status}{row.error_message && <small className="ss-cost-failure">{row.error_message}</small>}</td><td>{row.input_tokens==null?'Unknown':`${Number(row.input_tokens).toLocaleString()} / ${Number(row.output_tokens).toLocaleString()}`}</td><td>{row.cost_usd==null?'Unknown':money(row.cost_usd,4)}</td></tr>)}</tbody></table></div></div>}
    </>}
  </section>;
}
