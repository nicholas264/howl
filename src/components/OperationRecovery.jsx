import React, { useState } from 'react';
import { apiJson } from '../lib/api.js';

export default function OperationRecovery({item,onRecovered}) {
  const [id,setId]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!/^\d+:\/v[\d.]+\/act_[\w]+\/(ads|campaigns)$/.test(item.step_key))return <p>Provider-specific reconciliation is required before this action can be retried.</p>;
  const kind=item.step_key.endsWith('/campaigns')?'campaign':'ad';
  const checks=kind==='campaign'?'account, name, objective, paused status, categories, budget sharing, and creation time':'account, creative, ad set, name, tracking, and creation time';
  return <details><summary>Recover an existing Meta {kind} receipt</summary><p>Locate the {kind} in Meta, then supply its ID. HOWL verifies the original {checks} before recording the receipt. This does not create or modify the {kind}.</p>
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await apiJson('/api/operation-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation_key:item.operation_key,step_key:item.step_key,provider_id:id,note})});await onRecovered();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
      <label>Meta {kind} ID <input required pattern="[0-9]+" value={id} onChange={e=>setId(e.target.value)} /></label>
      <p><label>Review note <textarea required minLength={10} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} /></label></p>
      {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy?'Verifying…':'Verify and recover receipt'}</button>
    </form>
  </details>;
}
