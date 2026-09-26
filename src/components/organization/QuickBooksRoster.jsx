import React,{useEffect,useRef,useState} from 'react';
import {apiJson} from '../../lib/api.js';
export default function QuickBooksRoster({people,busy,error,onClose,onImport,onRefresh}) {
  const dialog=useRef(null);
  const [candidates,setCandidates]=useState(null),[failure,setFailure]=useState(''),[selected,setSelected]=useState(new Set());
  const [title,setTitle]=useState(''),[department,setDepartment]=useState(''),[managerId,setManagerId]=useState(''),[showVendors,setShowVendors]=useState(false);
  useEffect(()=>{
    const previous=document.activeElement;dialog.current.showModal();let active=true;
    apiJson('/api/organization?source=quickbooks').then(result=>{if(active){setCandidates(result.candidates);setSelected(new Set(result.candidates.filter(p=>p.status==='new'&&p.kind==='Employee').map(p=>p.key)));}}).catch(e=>{if(active)setFailure(e.message);});
    return()=>{active=false;previous?.focus?.();};
  },[]);
  const visible=(candidates||[]).filter(p=>showVendors||p.kind!=='Vendor');
  const toggle=key=>setSelected(current=>{const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next;});
  return <dialog ref={dialog} className="org-dialog org-roster-dialog" aria-labelledby="org-roster-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header><h2 id="org-roster-title">Add people from QuickBooks</h2><button disabled={busy} aria-label="Close QuickBooks roster" onClick={onClose}>×</button></header>
    <p className="org-hint">Active employees are selected by default. Review contractors individually: QuickBooks may also flag suppliers as contractors. Existing profiles are kept. Select your assembly team and set their role below.</p>
    {(!candidates&&!failure)&&<p role="status">Loading QuickBooks people…</p>}
    {(failure||error)&&<p role="alert" className="org-error">{failure||error}{error&&<button disabled={busy} onClick={onRefresh}>Refresh directory</button>}</p>}
    {candidates&&<fieldset disabled={busy} className="org-roster-fields">
      <label><input type="checkbox" checked={showVendors} onChange={e=>{setShowVendors(e.target.checked);if(!e.target.checked)setSelected(current=>new Set([...current].filter(key=>candidates.find(p=>p.key===key)?.kind!=='Vendor')));}}/> Include other vendors (select only people who work on your team)</label>
      <div className="org-roster-actions"><button onClick={()=>setSelected(new Set(visible.filter(p=>p.status==='new').map(p=>p.key)))}>Select all shown</button><button onClick={()=>setSelected(new Set())}>Clear selection</button></div>
      <div className="org-roster-list">{visible.map(p=><label key={p.key}><input type="checkbox" checked={selected.has(p.key)} disabled={p.status!=='new'} onChange={()=>toggle(p.key)}/><span><strong>{p.name}</strong><small>{p.kind}{p.company?` · ${p.company}`:''}{p.status==='existing'?' · Already in directory':p.status==='ambiguous'?' · Multiple matches — resolve in directory':''}</small></span></label>)}{!visible.length&&<p>No active employees or flagged contractors found. Check other vendors for technicians recorded as vendors.</p>}</div>
      <div className="org-fields"><label>Role for selected people<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Assembly technician"/></label><label>Department<input maxLength={200} value={department} onChange={e=>setDepartment(e.target.value)} placeholder="e.g. Assembly"/></label><label>Reports to<select value={managerId} onChange={e=>setManagerId(e.target.value)}><option value="">Not assigned yet</option>{people.filter(p=>!p.archived).map(p=><option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</select></label></div>
      <p className="org-hint">Leave role blank to record “Role not recorded.” Unassigned people appear in the chart’s “Not placed yet” tray. This reads QuickBooks without changing its records.</p>
    </fieldset>}
    <footer><button disabled={busy} onClick={onClose}>Cancel</button><button className="org-primary" disabled={busy||!selected.size||!candidates} onClick={()=>onImport([...selected].map(key=>({key,title,department,managerId})))}>{busy?'Adding people…':`Add ${selected.size} selected people`}</button></footer>
  </dialog>;
}
