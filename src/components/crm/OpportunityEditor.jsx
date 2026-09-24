import React,{useEffect,useRef,useState} from 'react';
import { CRM_STAGES,emptyOpportunity } from '../../lib/crm.js';
import { crmRequest } from './client.js';
import CrmEmail from './CrmEmail.jsx';

export default function OpportunityEditor({initial,canWrite,canSend,onUpdate,onClose}) {
  const [record,setRecord]=useState(initial),[form,setForm]=useState(initial.data||emptyOpportunity()),[baseline,setBaseline]=useState(JSON.stringify(initial.data||emptyOpportunity()));
  const [confirmArchive,setConfirmArchive]=useState(false);
  const [activity,setActivity]=useState([]),[note,setNote]=useState(''),[emailDirty,setEmailDirty]=useState(false),[emailBusy,setEmailBusy]=useState(false),[busy,setBusy]=useState(!initial.isNew),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const dialog=useRef(null),lock=useRef(false),pending=useRef(null),live=useRef(true);
  const dirty=JSON.stringify(form)!==baseline||!!note||emailDirty;
  const blocked=busy||emailBusy;
  useEffect(()=>{live.current=true;dialog.current.showModal();dialog.current.querySelector('h2').focus({preventScroll:true});dialog.current.scrollTop=0;return()=>{live.current=false;};},[]);
  async function refresh(preserveForm=true) {
    const result=await crmRequest(`/api/crm?id=${initial.id}`);if(!live.current)return;
    setActivity(result.activity);onUpdate(result.opportunity);
    if(!preserveForm){setRecord(result.opportunity);setForm(result.opportunity.data);setBaseline(JSON.stringify(result.opportunity.data));}
  }
  useEffect(()=>{if(!initial.isNew)refresh(false).catch(e=>setError(e.message)).finally(()=>setBusy(false));},[]);
  useEffect(()=>{
    const leave=e=>{if(blocked||dirty){e.preventDefault();e.returnValue='';}};
    const tool=e=>{if(blocked||(dirty&&!window.confirm('Leave this opportunity and discard unsaved changes?')))e.preventDefault();};
    window.addEventListener('beforeunload',leave);window.addEventListener('howl:before-tool-change',tool);
    return()=>{window.removeEventListener('beforeunload',leave);window.removeEventListener('howl:before-tool-change',tool);};
  },[dirty,blocked]);
  function close(){if(blocked)return;if(!dirty||window.confirm('Discard unsaved changes to this opportunity?'))onClose();}
  function field(name,value){setForm(old=>({...old,[name]:value}));setNotice('');}
  async function command(action,extra={}) {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    const payload={action,id:record.id,revision:record.revision||0,...extra};const fingerprint=JSON.stringify(payload);
    if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,body:{...payload,requestId:crypto.randomUUID()}};
    try {
      const result=await crmRequest('/api/crm',pending.current.body);if(!live.current)return;
      pending.current=null;setRecord(result.opportunity);onUpdate(result.opportunity);
      if(['create','save','restore','archive'].includes(action)){setForm(result.opportunity.data);setBaseline(JSON.stringify(result.opportunity.data));}
      if(action==='note')setNote('');
      setNotice(action==='note'?'Activity logged.':'Saved.');
      try{await refresh(false);}catch{setNotice('Saved. Activity history could not refresh; reload it to see the latest entry.');}
    }catch(e){if(live.current)setError(e.message);}finally{lock.current=false;if(live.current)setBusy(false);}
  }
  return <dialog ref={dialog} className="crm-dialog" aria-labelledby="crm-editor-title" onCancel={e=>{e.preventDefault();close();}}><header className="crm-dialog-header"><div><p>{record.isNew?'New opportunity':record.data?.company}</p><h2 id="crm-editor-title" tabIndex={-1}>{record.isNew?'Start a conversation':record.data?.title}</h2></div><button type="button" onClick={close} disabled={blocked} aria-label="Close opportunity">✕</button></header>
    <div className="crm-dialog-body">
      {error&&<div className="crm-alert" role="alert">{error}{!record.isNew&&<button disabled={blocked} onClick={()=>{if(window.confirm('Reload the saved opportunity and discard unsaved opportunity edits?'))refresh(false).then(()=>setError('')).catch(e=>setError(e.message));}}>Reload saved opportunity</button>}</div>}
      {notice&&<p className="crm-notice" role="status">{notice}</p>}
      {record.archived&&<div className="crm-banner">This opportunity is archived. Its history is preserved. {canWrite&&<button disabled={blocked} onClick={()=>command('restore')}>Restore opportunity</button>}</div>}
      <form onSubmit={e=>{e.preventDefault();command(record.isNew?'create':'save',{data:{...form,value:Number(form.value)}});}}>
        <fieldset disabled={!canWrite||record.archived||blocked}><div className="crm-fields">
          <label className="crm-wide">Opportunity name<input required maxLength={200} value={form.title} onChange={e=>field('title',e.target.value)} placeholder="Opening order, seasonal restock…"/></label>
          <label>Company<input required maxLength={200} value={form.company} onChange={e=>field('company',e.target.value)}/></label><label>Owner<input required maxLength={200} value={form.owner} onChange={e=>field('owner',e.target.value)}/></label>
          <label>Stage<select value={form.stage} onChange={e=>field('stage',e.target.value)}>{CRM_STAGES.map(s=><option value={s.id} key={s.id}>{s.label}</option>)}</select></label><label>Opportunity value · USD<input type="number" min="0" max="10000000000" step="0.01" required value={form.value} onChange={e=>field('value',e.target.value)}/></label>
          <label className="crm-wide">Next action<input required={!['won','lost'].includes(form.stage)} maxLength={500} value={form.nextAction} onChange={e=>field('nextAction',e.target.value)} placeholder="Call to discuss the opening assortment"/></label>
          <label>Follow-up date<input type="date" required={!['won','lost'].includes(form.stage)} value={form.followUp} onChange={e=>field('followUp',e.target.value)}/></label><label>Expected close<input type="date" value={form.closeDate} onChange={e=>field('closeDate',e.target.value)}/></label>
        </div><h3>Contacts</h3>{form.contacts.map((c,index)=><div className="crm-contact" key={index}><label>Name<input aria-label={`Contact ${index+1} name`} value={c.name} maxLength={200} onChange={e=>field('contacts',form.contacts.map((c,i)=>i===index?{...c,name:e.target.value}:c))}/></label><label>Email<input type="email" aria-label={`Contact ${index+1} email`} value={c.email} maxLength={254} onChange={e=>field('contacts',form.contacts.map((c,i)=>i===index?{...c,email:e.target.value}:c))}/></label><label>Phone<input type="tel" aria-label={`Contact ${index+1} phone`} value={c.phone} maxLength={80} onChange={e=>field('contacts',form.contacts.map((c,i)=>i===index?{...c,phone:e.target.value}:c))}/></label><button type="button" onClick={()=>field('contacts',form.contacts.filter((_,i)=>i!==index))} aria-label={`Remove contact ${index+1}`}>✕</button></div>)}<button type="button" disabled={form.contacts.length>=20} onClick={()=>field('contacts',[...form.contacts,{name:'',email:'',phone:''}])}>+ Add contact</button>
        <label className="crm-notes">Opportunity notes<textarea rows={3} maxLength={20000} value={form.notes} onChange={e=>field('notes',e.target.value)}/></label>
        {canWrite&&!record.archived&&<div className="crm-form-footer"><span>{JSON.stringify(form)!==baseline?'Unsaved changes':'Changes are saved when you click Save.'}</span><button className="crm-primary" type="submit">{busy?'Saving…':record.isNew?'Create opportunity':'Save opportunity'}</button></div>}
        </fieldset>
      </form>
      {!record.isNew&&<>
        <section className="crm-detail-section"><h3>Activity</h3>{canWrite&&!record.archived&&<form onSubmit={e=>{e.preventDefault();command('note',{note});}}><label>Log a call, reply, or update<textarea rows={2} maxLength={10000} value={note} onChange={e=>setNote(e.target.value)} placeholder="What happened?" disabled={blocked}/></label><button disabled={blocked||!note.trim()||JSON.stringify(form)!==baseline}>Log activity</button>{JSON.stringify(form)!==baseline&&<small>Save opportunity edits before logging activity.</small>}</form>}
        <ol className="crm-timeline">{activity.map(a=><li key={a.id}><strong>{activityTitle(a)}</strong><time>{new Date(a.created_at).toLocaleString()}</time>{a.detail.note&&<p>{a.detail.note}</p>}{a.detail.to&&<p>{a.detail.subject} · {a.detail.to}</p>}{a.kind==='save'&&<p>{changedFields(a).join(', ')||'Opportunity saved'}</p>}<small>{a.detail.by||a.actor_id}</small></li>)}</ol>{!activity.length&&<p className="crm-muted">No activity loaded yet.</p>}</section>
        <CrmEmail navigationBlocked={JSON.stringify(form)!==baseline||!!note||busy} opportunity={record} canSend={canSend} onDirty={setEmailDirty} onBusy={setEmailBusy} onSent={()=>refresh(true).catch(e=>setError(e.message))}/>
        {canWrite&&!record.archived&&<div className="crm-archive"><p>Archive removes this opportunity from the active pipeline and keeps its history.</p>{confirmArchive?<div className="crm-actions"><button disabled={blocked||dirty} onClick={()=>{setConfirmArchive(false);command('archive');}}>Confirm archive</button><button disabled={blocked} onClick={()=>setConfirmArchive(false)}>Cancel</button></div>:<button disabled={blocked||dirty} onClick={()=>setConfirmArchive(true)}>Archive opportunity</button>}</div>}
      </>}
    </div>
  </dialog>;
}
function activityTitle(a){return {create:'Opportunity created',save:'Opportunity updated',stage:`Moved to ${CRM_STAGES.find(s=>s.id===a.detail.after?.stage)?.label||'another stage'}`,archive:'Opportunity archived',restore:'Opportunity restored',note:'Activity logged',email_sent:'Email sent',email_resolved:a.detail.outcome==='confirmed_sent'?'Email manually confirmed sent':'Email manually confirmed not sent'}[a.kind]||a.kind;}
function changedFields(a){return Object.keys(a.detail.after||{}).filter(k=>JSON.stringify(a.detail.before?.[k])!==JSON.stringify(a.detail.after[k])).map(k=>({nextAction:'Next action',followUp:'Follow-up date',closeDate:'Expected close',value:'Value',contacts:'Contacts',notes:'Notes',company:'Company',title:'Name',owner:'Owner',stage:'Stage'}[k]||k));}
