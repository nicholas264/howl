import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import { CRM_STAGES,emptyOpportunity,crmCsv,followUpState,isOpen,localDay,money } from '../../lib/crm.js';
import { crmRequest } from './client.js';
import OpportunityEditor from './OpportunityEditor.jsx';
import './crm.css';

export default function CrmWorkspace({connectionError}) {
  const [rows,setRows]=useState([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [rights,setRights]=useState({}),[query,setQuery]=useState(''),[view,setView]=useState('pipeline'),[owner,setOwner]=useState(''),[selected,setSelected]=useState(null);
  const [dropStage,setDropStage]=useState(null);
  const mutationLock=useRef(false),generation=useRef(0);
  const load=useCallback(async()=>{const n=++generation.current;setBusy(true);try{const result=await crmRequest('/api/crm');if(n!==generation.current)return;setRows(result.opportunities);setRights(result);setLoaded(true);setError('');}catch(e){if(n===generation.current)setError(e.message);}finally{if(n===generation.current)setBusy(false);}},[]);
  useEffect(()=>{load();return()=>{generation.current++;};},[load]);
  const update=useCallback(o=>setRows(old=>[o,...old.filter(r=>r.id!==o.id)]),[]);
  const today=localDay();
  const filtered=useMemo(()=>rows.filter(o=>(view==='archived'?o.archived:!o.archived)&&(!owner||o.data.owner===owner)&&`${o.data.title} ${o.data.company} ${o.data.contacts.map(c=>`${c.name} ${c.email}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())),[rows,view,owner,query]);
  const followups=filtered.filter(isOpen).sort((a,b)=>(a.data.followUp||'0000').localeCompare(b.data.followUp||'0000')||a.data.company.localeCompare(b.data.company));
  const open=rows.filter(isOpen),due=open.filter(o=>!o.data.followUp||o.data.followUp<=today);
  async function move(id,stage) {
    if(mutationLock.current||!rights.canWrite)return;
    const row=rows.find(o=>o.id===id);if(!row||row.data.stage===stage)return;
    mutationLock.current=true;setBusy(true);setError('');
    try{const r=await crmRequest('/api/crm',{action:'stage',id,stage,revision:row.revision,requestId:crypto.randomUUID()});update(r.opportunity);}catch(e){setError(e.message);}finally{mutationLock.current=false;setBusy(false);}
  }
  function exportCsv(){const url=URL.createObjectURL(new Blob([crmCsv(filtered)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`campfire-opportunities-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function createOpportunity(stage='new') {setSelected({id:crypto.randomUUID(),isNew:true,data:{...emptyOpportunity(),stage}});}
  return <section className="crm">
    <div className="crm-breadcrumb"><Icon name="pipeline"/><span>Sales</span><span className="crm-breadcrumb-divider">/</span><strong>Opportunities</strong></div>
    <header className="crm-header">
      <div><h1>Sales pipeline</h1><p>Build relationships. Keep the next step in sight.</p></div>
      <div className="crm-actions"><a href="/dealer-intake" target="_blank" rel="noopener noreferrer" style={{color:"inherit",fontSize:13,textDecoration:"none",padding:"8px 12px",border:"1px solid #ddd",borderRadius:6}}>Dealer intake form ↗</a><button onClick={exportCsv} disabled={!loaded||!filtered.length}><Icon name="download"/>Export</button>{rights.canWrite&&<button className="crm-primary" disabled={busy} onClick={()=>createOpportunity()}><Icon name="plus"/>New opportunity</button>}</div>
    </header>
    <div className="crm-summary">
      <div><span>Open pipeline <small>USD</small></span><strong>{money(open.reduce((sum,o)=>sum+o.data.value,0))}</strong></div>
      <div><span>Active opportunities</span><strong>{open.length}</strong></div>
      <button onClick={()=>setView('followups')}><span>Follow-ups due <Icon name="arrow"/></span><strong className={due.length?'crm-summary-attention':''}>{due.length}<small>{due.length?'Ready for your attention':'You’re all caught up'}</small></strong></button>
    </div>
    {connectionError&&<div className="crm-alert" role="alert">{connectionError}</div>}
    {error&&<div className="crm-alert" role="alert">{error} <button onClick={load} disabled={busy}>Reload pipeline</button></div>}
    <div className="crm-toolbar">
      <div className="crm-tabs" aria-label="Pipeline view">{[['pipeline','Pipeline'],['followups','Follow-ups'],['archived','Archived']].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}><Icon name={id}/>{label}{id==='followups'&&due.length>0&&<span className="crm-tab-count">{due.length}</span>}</button>)}</div>
      <div className="crm-filters"><label className="crm-search"><Icon name="search"/><input aria-label="Search opportunities" placeholder="Search opportunities…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Filter by owner" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">All owners</option>{[...new Set(rows.map(o=>o.data.owner))].sort().map(o=><option key={o}>{o}</option>)}</select><button className="crm-icon-button" onClick={load} disabled={busy} aria-label="Refresh pipeline" title="Refresh pipeline"><Icon name="refresh"/></button></div>
    </div>
    {!loaded?<div className="crm-empty">{error?'The pipeline could not be loaded. Retry using the button above.':'Loading opportunities…'}</div>:view==='pipeline'?
      <div className="crm-board">{CRM_STAGES.map(stage=>{
        const items=filtered.filter(o=>o.data.stage===stage.id);
        return <section className={`crm-column crm-stage-${stage.id}${dropStage===stage.id?' crm-drop-target':''}`} key={stage.id}
          onDragOver={e=>{if(rights.canWrite&&!busy){e.preventDefault();setDropStage(stage.id);}}}
          onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropStage(null);}}
          onDrop={e=>{e.preventDefault();setDropStage(null);move(e.dataTransfer.getData('text/plain'),stage.id);}} aria-label={stage.label}>
          <header><div><h2><span className="crm-stage-dot"/>{stage.label}<span className="crm-stage-count">{items.length}</span></h2>{rights.canWrite&&<button className="crm-icon-button" aria-label={`Add opportunity to ${stage.label}`} disabled={busy} onClick={()=>createOpportunity(stage.id)}><Icon name="plus"/></button>}</div><p>{money(items.reduce((sum,o)=>sum+o.data.value,0))}<span> total value</span></p></header>
          <div className="crm-cards">{items.map(o=><button className="crm-card" key={o.id} draggable={rights.canWrite&&!busy} onDragStart={e=>{e.dataTransfer.setData('text/plain',o.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDropStage(null)} onClick={()=>setSelected(o)}>
            <span className="crm-company"><span className="crm-company-mark" aria-hidden="true">{initials(o.data.company)}</span><span>{o.data.company}</span></span>
            <strong>{o.data.title}</strong><span className="crm-card-value">{money(o.data.value)}</span>
            <span className="crm-card-footer"><span className="crm-owner" title={o.data.owner}><span aria-hidden="true">{initials(o.data.owner)}</span>{o.data.owner}</span>{isOpen(o)?<span className={`crm-date-pill ${o.data.followUp<=today?'crm-due':''}`} title={`${followUpState(o,today)} · ${o.data.followUp}`}><Icon name="calendar"/>{o.data.followUp===today?'Today':o.data.followUp<today?'Overdue':shortDate(o.data.followUp)}</span>:<span className={`crm-outcome crm-outcome-${stage.id}`}>{stage.id==='won'&&<Icon name="check"/>}{stage.label}</span>}</span>
            {isOpen(o)&&<span className="crm-next"><Icon name="arrow"/><span>{o.data.nextAction||'Set a next action'}</span></span>}
          </button>)}{!items.length&&<div className="crm-lane-empty"><span className="crm-empty-symbol"><Icon name={stage.id==='won'?'check':'pipeline'}/></span><p>{stage.id==='new'&&!rows.length?'Your next opportunity starts here.':'No opportunities yet'}</p></div>}
          {rights.canWrite&&<button className="crm-add-card" disabled={busy} onClick={()=>createOpportunity(stage.id)}><Icon name="plus"/>Add opportunity</button>}</div>
        </section>;
      })}</div>:
      <div className="crm-list">{(view==='followups'?followups:filtered).length?<table><thead><tr><th>Opportunity</th><th>Next action</th><th>Follow-up</th><th>Owner</th><th>Value</th><th></th></tr></thead><tbody>{(view==='followups'?followups:filtered).map(o=><tr key={o.id}><td><strong>{o.data.company}</strong><span>{o.data.title}</span></td><td>{o.data.nextAction||'—'}</td><td><span className={isOpen(o)&&o.data.followUp<=today?'crm-due':''}>{shortDate(o.data.followUp)||'—'}</span><small>{followUpState(o,today)}</small></td><td><span className="crm-owner"><span aria-hidden="true">{initials(o.data.owner)}</span>{o.data.owner}</span></td><td>{money(o.data.value)}</td><td><button onClick={()=>setSelected(o)}>Open<span className="crm-sr-only"> {o.data.title}</span><Icon name="arrow"/></button></td></tr>)}</tbody></table>:<div className="crm-empty">{view==='archived'?'No archived opportunities. Archived records can be restored here.':'No open opportunities match these filters.'}</div>}</div>}
    <footer className="crm-workspace-footer"><span><Icon name="pipeline"/>{filtered.length} opportunities{owner?` · ${owner}`:''}</span><span>Replies stay in Gmail. Track the next step here.</span></footer>
    {selected&&<OpportunityEditor key={selected.id} initial={selected} canWrite={rights.canWrite} canSend={rights.canSend} onUpdate={update} onClose={()=>setSelected(null)}/>}
  </section>;
}
function initials(name){return name.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();}
function shortDate(value){return value?new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'No date';}
function Icon({name}) {
  const paths={pipeline:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/></>,followups:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,archived:<><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/></>,plus:<path d="M12 5v14M5 12h14"/>,download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,refresh:<><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,check:<path d="m5 12 4 4L19 6"/>,more:<><circle cx="5" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="19" cy="12" r=".6"/></>};
  return <svg className="crm-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.pipeline}</svg>;
}
