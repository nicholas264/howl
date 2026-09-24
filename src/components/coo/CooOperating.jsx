import React from 'react';
import { metricHealth, formatValue, LABELS, constraintsForMetric, constraintHealth, initiativeHealth } from '../../lib/coo.js';
export const HealthBadge=({status})=><span className={`coo-badge coo-${status}`}>{LABELS[status]||status}</span>;
const delta=(value,unit)=>value==null?'—':`${value>0?'+':''}${formatValue(value,unit)}`;
export default function CooOperating({state,metrics,today,onDetails,onUpdate,onConstraint}) {
  return <div className="coo-operating-list">{metrics.map(m=>{
    const h=metricHealth(state,m,today),constraints=constraintsForMetric(state,m);
    const openConstraints=constraints.filter(c=>constraintHealth(state,c,today).reportedStatus!=='resolved');
    const actions=state.initiatives.filter(i=>!i.archived&&(i.objectiveId&&i.objectiveId===m.objectiveId||constraints.some(c=>c.id===i.constraintId)));
    return <article className="coo-measure" key={m.id}>
      <div className="coo-measure-main">
        <div className="coo-measure-title"><span className="coo-context">{state.departments.find(d=>d.id===m.departmentId)?.name} · {state.cycles.find(c=>c.id===m.cycleId)?.name}</span><h3>{m.title}</h3><p>Owner: {m.owner}</p><HealthBadge status={h.status}/></div>
        <div className="coo-measure-value"><span>Actual</span><strong>{formatValue(h.value,m.unit)}</strong><small>{h.latest?`Reported ${h.latest.date}`:'No update recorded'}</small><small>Plan for that date: {formatValue(h.planned,m.unit)}</small><HealthBadge status={h.planStatus}/></div>
        <div className="coo-measure-value"><span>Expected finish</span><strong>{formatValue(h.forecast,m.unit)}</strong><small>Goal: {formatValue(m.target,m.unit)}</small><small>Forecast gap: {delta(h.forecastGap,m.unit)}</small><HealthBadge status={h.forecastStatus}/></div>
        <div className="coo-measure-constraints"><span>{openConstraints.length} open constraint{openConstraints.length===1?'':'s'}</span>{openConstraints.map(c=><button className="coo-link" key={c.id} onClick={()=>onDetails('constraint',c.id)}>{c.title}<small>{c.owner} · Due {c.dueDate}</small></button>)}<button onClick={()=>onConstraint(m)}>Add constraint</button></div>
        <button className="coo-primary" onClick={()=>onUpdate(m)}>Update progress</button>
      </div>
      <details className="coo-measure-detail"><summary>Plan, variance & resolution work</summary>
        <div className="coo-expanded-grid"><section><h4>Agreed plan</h4><p>{m.description||'Add a definition and reporting basis in Plan.'}</p><p>Planned by today: <strong>{formatValue(h.plannedNow,m.unit)}</strong></p><p>Actual minus plan at reporting date: <strong>{delta(h.variance,m.unit)}</strong></p><p>{m.direction==='increase'?'Higher is better.':'Lower is better.'} At-risk tolerance: {formatValue(m.tolerance||0,m.unit)}.</p>{m.plan?.length?<ol className="coo-checkpoints">{m.plan.map(p=><li key={p.date}><span>{p.date}</span><strong>{formatValue(p.value,m.unit)}</strong></li>)}</ol>:<p>No checkpoints defined. Add them in Plan.</p>}{m.planSource&&<small>{m.planSource}</small>}</section>
        <section><h4>Latest progress</h4><p>{h.latest?.note||'No progress note yet.'}</p>{h.latest?.nextStep&&<p><strong>Next step:</strong> {h.latest.nextStep}</p>}{h.latest?.blocker&&<p><strong>Earlier blocker note:</strong> {h.latest.blocker}</p>}{h.stale&&<p className="coo-blocker">This update is overdue. Pace and forecast badges reflect the last reported data.</p>}<button onClick={()=>onDetails('metric',m.id)}>View all updates</button><h4>Resolution work</h4>{actions.map(i=><div className="coo-resolution-row" key={i.id}><button className="coo-link" onClick={()=>onDetails('initiative',i.id)}>{i.title}</button><span>{i.owner} · {i.dueDate}</span><HealthBadge status={initiativeHealth(state,i,today).status}/></div>)}{!actions.length&&<p>No linked actions yet. Assign the next action when logging progress.</p>}{constraints.filter(c=>constraintHealth(state,c,today).reportedStatus==='resolved').map(c=><button key={c.id} className="coo-link" onClick={()=>onDetails('constraint',c.id)}>Resolved: {c.title}</button>)}</section></div>
      </details>
    </article>;
  })}{!metrics.length&&<div className="coo-empty">No measures in this scope. Add measures and checkpoints in Plan, or change your filters.</div>}</div>;
}
export function ConstraintList({state,constraints,today,onDetails,onEdit,onUpdate,onAction}) {
  return <div className="coo-constraint-list">{constraints.map(c=>{
    const h=constraintHealth(state,c,today),metrics=state.metrics.filter(m=>(c.metricIds||[]).includes(m.id)),goals=state.objectives.filter(o=>(c.objectiveIds||[]).includes(o.id));
    const actions=state.initiatives.filter(i=>!i.archived&&i.constraintId===c.id);
    return <article className="coo-constraint" key={c.id}><header><div><h3>{c.title}{c.archived?' (archived)':''}</h3><p>Resolution owner: <strong>{c.owner}</strong> · Due {c.dueDate}</p></div><HealthBadge status={h.status}/></header><p>{c.description}</p>{c.impact&&<p><strong>Impact:</strong> {c.impact}</p>}{c.decision&&<div className="coo-decision"><strong>Decision needed</strong><p>{c.decision}</p></div>}<div className="coo-affected"><span>Affects:</span>{metrics.map(m=><button className="coo-link" key={m.id} onClick={()=>onDetails('metric',m.id)}>{m.title} ({state.departments.find(d=>d.id===m.departmentId)?.name})</button>)}{goals.map(o=><button className="coo-link" key={o.id} onClick={()=>onDetails('objective',o.id)}>{o.title}</button>)}</div>{h.latest&&<div className="coo-latest"><strong>Latest update · {h.latest.date}</strong><p>{h.latest.note||'Status updated.'}</p>{h.latest.nextStep&&<p>Next: {h.latest.nextStep}</p>}</div>}
      {actions.map(i=><div className="coo-resolution-row" key={i.id}><button className="coo-link" onClick={()=>onDetails('initiative',i.id)}>{i.title}</button><span>{i.owner} · {i.dueDate}</span><HealthBadge status={initiativeHealth(state,i,today).status}/></div>)}
      <footer className="coo-row-actions"><button onClick={()=>onDetails('constraint',c.id)}>History & details</button>{!c.archived&&<><button onClick={()=>onEdit(c)}>Edit constraint</button><button onClick={()=>onAction(c)}>Assign action</button><button className="coo-primary" onClick={()=>onUpdate(c)}>Update resolution</button></>}</footer>
    </article>;
  })}{!constraints.length&&<div className="coo-empty">Capture the constraints threatening your goals. Link each one to its affected measures, assign a resolution owner, and track the work here.</div>}</div>;
}
