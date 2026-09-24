import React, { useEffect, useRef, useState } from 'react';
import { dayString, KPI_TEMPLATES, STATUSES, LABELS, latestCheckin } from '../../lib/coo.js';
const TITLES={department:'department',cycle:'planning cycle',objective:'objective',metric:'metric',initiative:'initiative',review:'operating review'};
export default function CooEditor({editor,state,onClose,onSave,busy,error,onRefresh}) {
  const {kind,item,mode='save',defaults={}}=editor;
  const checkin=mode==='checkin';
  const latest=item&&latestCheckin(state,kind,item.id);
  const [values,setValues]=useState(()=>checkin?{date:dayString(),value:'',status:latest?.status||'on-track',note:'',blocker:'',nextStep:''}:{name:'',title:'',owner:'',description:'',departmentId:'',cycleId:'',parentId:'',objectiveId:'',kind:'kpi',baseline:'',target:'',unit:'',direction:'increase',cadence:7,source:'',dueDate:'',dependencyId:'',parentInitiativeId:'',reviewId:'',type:'initiative',start:'',end:'',date:dayString(),decisions:'',lessons:'',...defaults,...item});
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
  const select=(key,label,options,placeholder='Select…',required=true)=><label key={key}>{label}<select value={values[key]||''} required={required} onChange={e=>{
    set(key,e.target.value);
    if(key==='cycleId'){set('objectiveId','');set('parentId','');set('dependencyId','');set('parentInitiativeId','');set('reviewId','');}
    if(key==='departmentId')set('objectiveId','');
  }}><option value="">{placeholder}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name||o.title}</option>)}</select></label>;
  const simple=(key,label,options)=>select(key,label,options.map(([id,name])=>({id,name})));
  const submit=async e=>{e.preventDefault();const payload={...values};if(kind==='metric'){for(const k of checkin?['value']:['baseline','target','cadence'])payload[k]=Number(payload[k]);}await onSave({action:checkin?'checkin':'save',kind,id:item?.id,expectedVersion:item?(item.version||1):undefined,values:payload});};
  return <dialog ref={ref} className="coo-dialog" onCancel={e=>{e.preventDefault();close();}} aria-labelledby="coo-editor-title">
    <form onSubmit={submit}>
      <header><div><p>{checkin?item.title:'COO workspace'}</p><h2 id="coo-editor-title">{checkin?'Record check-in':`${item?'Edit':'New'} ${TITLES[kind]}`}</h2></div><button type="button" onClick={close} disabled={busy} aria-label="Close editor">×</button></header>
      <fieldset disabled={busy} className="coo-form">
      {checkin?<>
        {input('date','Reporting date','date',true,{max:dayString()})}
        {kind==='metric'?input('value',`Actual (${item.unit||'number'})`,'number',true,{step:'any'}):simple('status','Status',STATUSES.map(s=>[s,LABELS[s]]))}
        {area('note','What changed?')}{area('blocker','Blocker or decision needed')}{area('nextStep','Next step')}
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
          {input('baseline','Baseline','number',true,{step:'any'})}{input('target','Target','number',true,{step:'any'})}
          {input('unit','Unit (%, USD, units, days…)','text',false,{maxLength:30})}{input('cadence','Update every (days)','number',true,{min:1,max:366,step:1})}
          {input('source','Data source / report reference','text',false,{maxLength:500})}
          <p className="coo-hint coo-wide">KPIs compare the latest period’s value with its target. Key results measure progress from baseline to target against elapsed cycle time. Keep each reporting period consistent.</p>
          {item&&state.checkins.some(c=>c.entityId===item.id)&&<p className="coo-hint coo-wide">This metric has history. To change its target, baseline, unit, direction, department, type, or cycle, create a new metric.</p>}
        </>}
        {kind==='initiative'&&<>
          {simple('type','Work type',[['initiative','Initiative'],['milestone','Milestone'],['action','Follow-up action']])}
          {input('dueDate','Due date','date')}
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
      <footer><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="coo-primary" disabled={busy}>{busy?'Saving…':checkin?'Save check-in':kind==='review'?'Save review & snapshot':'Save changes'}</button></footer>
    </form>
  </dialog>;
}
