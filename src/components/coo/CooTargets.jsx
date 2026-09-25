import React from 'react';
import { cycleLevel, metricHealth, formatValue, LABELS } from '../../lib/coo.js';

export default function CooTargets({state, cycle, departments, query, canWrite, open, onDetails, onCycle}) {
  if (!cycle) return <section className="coo-empty"><h2>Start with a target period</h2><p>Create an annual plan, then quarterly and monthly periods within it.</p>{canWrite&&<button className="coo-primary" onClick={()=>open('cycle')}>Create period</button>}</section>;
  const children=state.cycles.filter(c=>!c.archived&&c.parentId===cycle.id);
  const parent=state.cycles.find(c=>c.id===cycle.parentId);
  const matching=text=>!query||text.toLowerCase().includes(query.toLowerCase());
  return <>
    <div className="coo-section-head"><div><span className="coo-context">{cycleLevel(cycle)} targets</span><h2>{cycle.name}</h2><p>Choose 1–3 focuses per department. Give each focus KPIs with clear targets and a repeatable measurement method.</p></div>{canWrite&&cycleLevel(cycle)!=='monthly'&&<button onClick={()=>open('cycle',null,'save',{parentId:cycle.id,level:cycleLevel(cycle)==='annual'?'quarterly':'monthly'})}>Add {cycleLevel(cycle)==='annual'?'quarter':'month'}</button>}</div>
    <div className="coo-period-links">{parent&&<button onClick={()=>onCycle(parent.id)}>↑ {parent.name}</button>}{children.map(c=><button key={c.id} onClick={()=>onCycle(c.id)}>{c.name} →</button>)}</div>
    {departments.map(d=>{
      const focuses=state.objectives.filter(o=>!o.archived&&o.departmentId===d.id&&o.cycleId===cycle.id);
      const unlinked=state.metrics.filter(m=>!m.archived&&m.departmentId===d.id&&m.cycleId===cycle.id&&!focuses.some(f=>f.id===m.objectiveId));
      return <section className="coo-department-targets" key={d.id} aria-label={`${d.name} targets`}>
        <div className="coo-section-head"><div><h3>{d.name}</h3><p>{d.owner||'Assign a department owner in Setup'} · {focuses.length}/3 focuses</p></div>{canWrite&&<button disabled={focuses.length>=3} onClick={()=>open('objective',null,'save',{departmentId:d.id,cycleId:cycle.id,owner:d.owner||''})}>Add focus</button>}</div>
        {!focuses.length&&<p className="coo-empty">Choose this department’s first focus for {cycle.name}.</p>}
        {focuses.filter(f=>matching(`${f.title} ${f.owner} ${f.description}`)||state.metrics.some(m=>m.objectiveId===f.id&&matching(`${m.title} ${m.owner}`))).map((f,i)=>{
          const metrics=state.metrics.filter(m=>!m.archived&&m.objectiveId===f.id);
          const supports=state.objectives.find(o=>o.id===f.parentId);
          return <article className="coo-focus" key={f.id}>
            <div className="coo-section-head"><div><span className="coo-context">Focus {i+1} · {f.owner}</span><h4>{f.title}</h4>{supports&&<button className="coo-link" onClick={()=>onDetails('objective',supports.id)}>Supports: {supports.title}</button>}<p>{f.description}</p></div><div className="coo-row-actions"><button onClick={()=>onDetails('objective',f.id)}>Details</button>{canWrite&&<><button onClick={()=>open('objective',f)}>Edit focus</button><button onClick={()=>open('metric',null,'save',{departmentId:d.id,cycleId:cycle.id,objectiveId:f.id,owner:f.owner,kind:'kpi'})}>Add KPI</button></>}</div></div>
            {metrics.length?<div className="coo-table-wrap"><table className="coo-table"><thead><tr><th>KPI / measurement</th><th>Target</th><th>Actual</th><th>Gap to target</th><th>Status / updated</th><th>Actions</th></tr></thead><tbody>{metrics.map(m=>{
              const h=metricHealth(state,m);return <tr key={m.id}><td><strong>{m.title}</strong><small>{m.owner} · Every {m.cadence} days</small><small>{m.measurement==='percentage'?`${m.numeratorLabel} ÷ ${m.denominatorLabel} × 100`:m.measurement==='ratio'?`${m.numeratorLabel} ÷ ${m.denominatorLabel}`:m.description||'Define how this KPI is measured'}</small><small>Source: {m.source||'Needs a data source'}</small></td><td>{m.direction==='increase'?'≥':'≤'} {formatValue(m.target,m.unit)}</td><td>{formatValue(h.value,m.unit)}</td><td>{formatValue(h.value==null?null:h.value-m.target,m.unit==='%'?'pp':m.unit)}<small>Actual − target</small></td><td><span className={`coo-badge coo-${h.status}`}>{LABELS[h.status]}</span><small>{h.latest?.date||'No measurements yet'}</small></td><td><div className="coo-row-actions"><button onClick={()=>onDetails('metric',m.id)}>History</button>{canWrite&&<><button onClick={()=>open('metric',m)}>Edit KPI</button><button className="coo-primary" onClick={()=>open('metric',m,'checkin')}>Measure KPI</button></>}</div></td></tr>;
            })}</tbody></table></div>:<p className="coo-hint">Add at least one KPI to make this focus measurable.</p>}
          </article>;
        })}
        {!!unlinked.length&&<div className="coo-unlinked"><strong>{unlinked.length} KPIs need a department focus</strong><p>Existing KPIs are preserved. Assign them to a focus for this period.</p>{unlinked.map(m=><button key={m.id} onClick={()=>canWrite?open('metric',m):onDetails('metric',m.id)}>{m.title}</button>)}</div>}
      </section>;
    })}
    <p className="coo-hint">Enter actuals for the selected period. Quarterly and annual measurements are maintained separately: percentages and ratios must be recalculated from their underlying totals, not added together.</p>
  </>;
}
