import React, { useEffect, useRef, useState } from 'react';
import CooPlanEditor from './CooPlanEditor.jsx';
import { dayString, KPI_TEMPLATES, STATUSES, LABELS, latestCheckin, CONSTRAINT_STATUSES, constraintsForMetric } from '../../lib/coo.js';
const TITLES={department:'department',cycle:'planning cycle',objective:'objective',metric:'metric',initiative:'initiative',review:'weekly review',constraint:'constraint'};
export default function CooEditor({editor,state,onClose,onSave,busy: saving,error,onRefresh}) {
  const {kind,item,mode='save',defaults={}}=editor;
  const [importing,setImporting]=useState(false);
  const busy=saving||importing;
  const checkin=mode==='checkin';
  const latest=item&&latestCheckin(state,kind,item.id);
  const [values,setValues]=useState(()=>checkin?{date:dayString(),value:'',forecast:latest?.forecast??'',constraintSelection:'',constraintStatus:'open',constraintNote:'',constraintDecision:'',decision:item?.decision||'',constraintTitle:'',constraintOwner:'',constraintDueDate:'',assignAction:false,actionTitle:'',actionOwner:'',actionDueDate:'',status:latest?.status||(kind==='constraint'?'open':'on-track'),note:'',blocker:'',nextStep:''}:{name:'',title:'',owner:'',description:'',departmentId:'',cycleId:'',parentId:'',objectiveId:'',kind:'kpi',baseline:'',target:'',unit:'',direction:'increase',cadence:7,source:'',dueDate:'',dependencyId:'',parentInitiativeId:'',reviewId:'',type:'initiative',start:'',end:'',date:dayString(),decisions:'',lessons:'',plan:[],planSource:'',tolerance:0,metricIds:[],objectiveIds:[],impact:'',decision:'',constraintId:'',...defaults,...item});
  const planLocked=!!item?.plan?.length;
  const cycle=state.cycles.find(c=>c.id===values.cycleId);
  const ref=useRef(null);
  const dirty=useRef(false);
  const set=(key,value)=>{dirty.current=true;setValues(v=>({...v,[key]:value}));};
  useEffect(()=>{
    const dialog=ref.current;const previous=document.activeElement;dialog.showModal();
    const guard=e=>{if(dirty.current){e.preventDefault();if(e.type==='beforeunload')e.returnValue='';}};
    window.addEventListener('beforeunload',guard);window.addEventListener('howl:before-tool-change',guard);
    return()=>{window.removeEventListener('beforeunload',guard);window.removeEventListener('howl:before-tool-change',guard);previous?.focus?.();};
  },[]);
  const close=()=>{if(!busy&&(!dirty.current||window.confirm('Discard the unsaved changes in this form?')))onClose();};
  const active=key=>state[key].filter(x=>!x.archived);
  const input=(key,label,type='text',required=true,extra={})=><label key={key}>{label}<input type={type} value={values[key]??''} required={required} maxLength={type==='text'?200:undefined} onChange={e=>set(key,e.target.value)} {...extra}/></label>;
  const area=(key,label)=><label className="coo-wide" key={key}>{label}<textarea value={values[key]||''} rows={3} maxLength={5000} onChange={e=>set(key,e.target.value)}/></label>;
  const select=(key,label,options,placeholder='Select…',required=true)=><label key={key}>{label}<select disabled={planLocked&&['cycleId','direction'].includes(key)} value={values[key]||''} required={required} onChange={e=>{
    set(key,e.target.value);
    if(key==='cycleId'){set('objectiveId','');set('parentId','');set('dependencyId','');set('parentInitiativeId','');set('reviewId','');set('constraintId','');set('metricIds',[]);set('objectiveIds',[]);if(!planLocked)set('plan',[]);}
    if(key==='departmentId')set('objectiveId','');
    if(key==='constraintSelection'){set('constraintStatus',latestCheckin(state,'constraint',e.target.value)?.status||'open');set('constraintDecision',state.constraints.find(c=>c.id===e.target.value)?.decision||'');}
  }}><option value="">{placeholder}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name||o.title}</option>)}</select></label>;
  const simple=(key,label,options)=>select(key,label,options.map(([id,name])=>({id,name})));
  const linkedOptions=kind==='metric'&&item?constraintsForMetric(state,item):[];
  const submit=async e=>{
    e.preventDefault();if(busy)return;const payload={...values};
    if(kind==='metric'){
      for(const k of checkin?['value']:['baseline','target','cadence','tolerance'])payload[k]=Number(payload[k]);
      if(checkin){
        payload.forecast=values.forecast===''?null:Number(values.forecast);
        if(values.constraintSelection)payload.constraintUpdate={id:values.constraintSelection==='new'?undefined:values.constraintSelection,title:values.constraintTitle,owner:values.constraintOwner,dueDate:values.constraintDueDate,status:values.constraintStatus,note:values.constraintNote,decision:values.constraintDecision};
      }else payload.plan=(values.plan||[]).map(p=>({date:p.date,value:Number(p.value)}));
    }
    if(checkin&&values.assignAction)payload.followUp={title:values.actionTitle,owner:values.actionOwner,dueDate:values.actionDueDate};
    await onSave({action:checkin?'checkin':'save',kind,id:item?.id,expectedVersion:item?(item.version||1):undefined,values:payload});
  };
  const linkChoices=(key,label,collection)=><fieldset className="coo-wide coo-link-choices"><legend>{label}</legend>{active(collection).filter(x=>x.cycleId===values.cycleId).map(x=><label key={x.id}><input type="checkbox" checked={(values[key]||[]).includes(x.id)} onChange={e=>set(key,e.target.checked?[...(values[key]||[]),x.id]:(values[key]||[]).filter(id=>id!==x.id))}/>{x.title} — {state.departments.find(d=>d.id===x.departmentId)?.name||'Company-wide'}</label>)}</fieldset>;
  return <dialog ref={ref} className="coo-dialog" onCancel={e=>{e.preventDefault();close();}} aria-labelledby="coo-editor-title">
    <form onSubmit={submit}>
      <header><div><p>{checkin?item.title:'COO workspace'}</p><h2 id="coo-editor-title">{checkin?'Update progress':`${item?'Edit':'New'} ${TITLES[kind]}`}</h2></div><button type="button" onClick={close} disabled={busy} aria-label="Close editor">×</button></header>
      <fieldset disabled={busy} className="coo-form">
      {checkin?<>
        {input('date','Reporting date','date',true,{max:dayString()})}
        {kind==='metric'?<>{input('value',`Actual to date / current value (${item.unit||'number'})`,'number',true,{step:'any'})}{input('forecast',`Expected finish (${item.unit||'number'})`,'number',false,{step:'any'})}<p className="coo-hint">Goal: {item.target} {item.unit}. Enter your current expected end-of-cycle result; this does not change the agreed goal.</p></>:simple('status','Status',(kind==='constraint'?CONSTRAINT_STATUSES:STATUSES).map(s=>[s,LABELS[s]]))}
        {area('note','What changed?')}{area('nextStep','Next step')}{kind==='constraint'&&area('decision','Current decision needed (clear when answered)')}
        {kind==='metric'&&<>
          {select('constraintSelection','Constraint update',[...linkedOptions,{id:'new',title:'Create a new constraint'}],'No constraint update',false)}
          {values.constraintSelection&&<>
            {values.constraintSelection==='new'&&<>{input('constraintTitle','Constraint title')}{input('constraintOwner','Resolution owner')}{input('constraintDueDate','Resolution due date','date')}</>}
            {simple('constraintStatus','Constraint status',CONSTRAINT_STATUSES.map(s=>[s,LABELS[s]]))}{area('constraintNote','Resolution progress')}{area('constraintDecision','Current decision needed (clear when answered)')}
          </>}
        </>}
        <label className="coo-check-row coo-wide"><input type="checkbox" checked={!!values.assignAction} onChange={e=>set('assignAction',e.target.checked)}/>Assign a next action</label>
        {values.assignAction&&<>{input('actionTitle','Action title')}{input('actionOwner','Action owner')}{input('actionDueDate','Action due date','date')}</>}
        <p className="coo-hint coo-wide">Saved check-ins stay in history. A new check-in for the same date supersedes the earlier value without deleting it.</p>
      </>:<>
        {kind==='metric'&&!item&&<label className="coo-wide">Start from a suggested KPI<select defaultValue="" onChange={e=>{const t=KPI_TEMPLATES[Number(e.target.value)];if(t){dirty.current=true;setValues(v=>({...v,...t,departmentId:active('departments').find(d=>d.name===t.department)?.id||v.departmentId}));}}}><option value="" disabled>Choose a template or define your own</option>{KPI_TEMPLATES.map((t,i)=><option value={i} key={t.title}>{t.department} — {t.title}</option>)}</select></label>}
        {input(['department','cycle'].includes(kind)?'name':'title',['department','cycle'].includes(kind)?'Name':'Title')}
        {input('owner','Accountable owner','text',!['department','cycle'].includes(kind),{maxLength:150})}
        {!['department','cycle'].includes(kind)&&<>
          {select('cycleId','Planning cycle',active('cycles'))}
          {select('departmentId','Department',active('departments'),['objective','review'].includes(kind)?'Company-wide':'Select department',!['objective','review'].includes(kind))}
        </>}
        {kind==='cycle'&&<>{input('start','Start date','date')}{input('end','End date','date')}{select('parentId','Annual cycle (optional)',active('cycles').filter(c=>!c.parentId&&c.id!==item?.id),'Standalone / annual cycle',false)}</>}
        {kind==='objective'&&select('parentId','Aligned company objective',active('objectives').filter(o=>!o.departmentId&&!o.parentId&&o.id!==item?.id&&(o.cycleId===values.cycleId||o.cycleId===state.cycles.find(c=>c.id===values.cycleId)?.parentId)),'No parent objective',false)}
        {['metric','initiative'].includes(kind)&&select('objectiveId','Supporting objective',active('objectives').filter(o=>o.cycleId===values.cycleId&&(!o.departmentId||o.departmentId===values.departmentId)),'No linked objective',kind==='metric'&&values.kind==='kr')}
        {kind==='metric'&&<>
          {simple('kind','Metric type',[['kpi','KPI — ongoing operating health'],['kr','Key result — improvement goal']])}
          {simple('direction','Target direction',[['increase','At or above target'],['decrease','At or below target']])}
          {input('baseline','Baseline','number',true,{step:'any',disabled:planLocked})}{input('target','Goal','number',true,{step:'any',disabled:planLocked})}
          {input('unit','Unit (%, USD, units, days…)','text',false,{maxLength:30,disabled:planLocked})}{input('cadence','Update every (days)','number',true,{min:1,max:366,step:1})}
          {input('source','Data source / report reference','text',false,{maxLength:500})}
          {input('tolerance','At-risk tolerance (in metric units)','number',true,{min:0,step:'any',disabled:planLocked})}
          <p className="coo-hint coo-wide">An unfavorable gap within this tolerance is at risk; a larger gap is off track. Keep actuals, checkpoints, and forecasts on the same cumulative or point-in-time basis.</p>
          <CooPlanEditor values={values} set={set} cycle={cycle} locked={planLocked} onLoadingChange={setImporting}/>
          {item&&state.checkins.some(c=>c.entityId===item.id)&&<p className="coo-hint coo-wide">This metric has history. To change its target, baseline, unit, direction, department, type, or cycle, create a new metric.</p>}
        </>}
        {kind==='constraint'&&<>{input('dueDate','Resolution due date','date')}{area('impact','Business impact')}{area('decision','Decision needed')}{linkChoices('metricIds','Affected measures — across departments','metrics')}{linkChoices('objectiveIds','Affected goals','objectives')}</>}
        {kind==='initiative'&&<>
          {simple('type','Work type',[['initiative','Initiative'],['milestone','Milestone'],['action','Follow-up action']])}
          {input('dueDate','Due date','date')}{select('constraintId','Resolves constraint',active('constraints').filter(c=>c.cycleId===values.cycleId),'No linked constraint',false)}
          {select('parentInitiativeId','Parent initiative',active('initiatives').filter(i=>!i.parentInitiativeId&&i.id!==item?.id&&i.cycleId===values.cycleId),'None',values.type==='milestone')}
          {select('dependencyId','Depends on',active('initiatives').filter(i=>i.id!==item?.id&&i.cycleId===values.cycleId),'No dependency',false)}
          {select('reviewId','Follow-up from review',active('reviews').filter(r=>r.cycleId===values.cycleId),'No linked review',false)}
        </>}
        {kind==='review'&&input('date','Review date','date',true,{max:dayString()})}
        {area('description',kind==='metric'?'Definition and reporting period':kind==='review'?'Discussion and department updates':'Description / intended outcome')}
        {kind==='review'&&<>{area('decisions','Decisions made')}{area('lessons','Lessons for the next cycle')}<p className="coo-hint coo-wide">Saving captures the scorecard as of this review date. Add assigned follow-up actions from the saved review.</p></>}
      </>}
      </fieldset>
      {error&&<div role="alert" className="coo-error">{error}<button type="button" disabled={busy} onClick={onRefresh}>Refresh workspace</button></div>}
      <footer><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="coo-primary" disabled={busy}>{importing?'Loading forecast…':saving?'Saving…':checkin?'Save progress':kind==='review'?'Save review & snapshot':'Save changes'}</button></footer>
    </form>
  </dialog>;
}
