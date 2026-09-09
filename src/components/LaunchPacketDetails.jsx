import {launchApprovalRecords} from '../lib/launch-review.js';
import React,{useEffect,useState} from 'react';
import {apiJson} from '../lib/api.js';

export default function LaunchPacketDetails({adId}) {
  const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    let active=true;setError('');setData(null);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    apiJson(`/api/launch-packets?ad_id=${encodeURIComponent(adId)}`,{signal:controller.signal})
      .then(value=>{if(active)setData(value);}).catch(err=>{if(active)setError(err.name==='AbortError'?'Snapshot request timed out. Close and reopen to retry.':err.message);})
      .finally(()=>clearTimeout(timer));
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[adId,open]);
  const snapshot=data?.packet?.snapshot;
  return <details onToggle={event=>setOpen(event.currentTarget.open)} style={{marginTop:8,maxWidth:480}}>
    <summary style={{cursor:'pointer'}}>Launch snapshot</summary>
    {open&&<div style={{padding:'8px 0',fontSize:11,lineHeight:1.5}}>
      {error&&<p role="alert">{error}</p>}
      {!data&&!error&&<p role="status">Loading snapshot…</p>}
      {data&&!snapshot&&<p>{data.basis}</p>}
      {snapshot&&<>
        <p>Captured {new Date(snapshot.captured_at).toLocaleString()} by {snapshot.actor_id}.</p>
        <p>Account {snapshot.account_id} · Ad set {snapshot.adset.name || snapshot.adset.id} · Campaign {snapshot.adset.campaign_id}</p>
        <p>{snapshot.basis}</p>
        <p>{launchApprovalRecords(snapshot.evidence.approvals).length} creator approval record(s); {snapshot.media_receipts.length} media receipt(s); {snapshot.drive_uploads.length} Drive upload receipt(s).</p>
        {!!snapshot.unresolved_media_ids.length&&<p>Some provider media IDs have no upload-registry entry. Consult the captured Drive receipts and approval evidence.</p>}
        <details><summary>Creative, targeting, and approval evidence</summary>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:480,overflow:'auto'}}>{JSON.stringify(snapshot,null,2)}</pre>
        </details>
      </>}
    </div>}
  </details>;
}
