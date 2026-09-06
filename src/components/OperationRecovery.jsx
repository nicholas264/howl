import React, { useState } from 'react';
import { apiJson } from '../lib/api.js';

export default function OperationRecovery({item,onRecovered}) {
  const [id,setId]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  if(!/^\d+:\/v[\d.]+\/act_[\w]+\/ads$/.test(item.step_key))return <p>Provider-specific reconciliation is required before this action can be retried.</p>;
  return <details><summary>Recover an existing Meta ad receipt</summary><p>Locate the ad in Meta, then supply its ID. HOWL verifies the original account, creative, ad set, name, tracking, and creation time before recording the receipt. This does not create or modify an ad.</p>
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await apiJson('/api/operation-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation_key:item.operation_key,step_key:item.step_key,provider_id:id,note})});await onRecovered();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
      <label>Meta ad ID <input required pattern="[0-9]+" value={id} onChange={e=>setId(e.target.value)} /></label>
      <p><label>Review note <textarea required minLength={10} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} /></label></p>
      {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy?'Verifying…':'Verify and recover receipt'}</button>
    </form>
  </details>;
}
