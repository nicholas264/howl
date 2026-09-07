// Keep only a request fingerprint and ID, not creator addresses or message text.
export async function pendingSeedRequest(storage,actorId,payload,cryptoImpl=globalThis.crypto,lockManager=globalThis.navigator?.locks) {
  if(!actorId)throw new Error('Sign in before creating a seed order.');
  const storageKey=`howl:pending-seed:v1:${actorId}:${payload.creator_id}`;
  const bytes=new TextEncoder().encode(JSON.stringify([payload.creator_id,payload.variant_id,payload.quantity,payload.notes || '']));
  const fingerprint=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(!lockManager?.request)throw new Error('This browser cannot safely coordinate seed order retries. Use a current browser.');
  return lockManager.request(storageKey,async()=>{
  const raw=storage.getItem(storageKey);
  let pending;
  if(raw) {
    try {pending=JSON.parse(raw);} catch {throw new Error('The pending seed request could not be read. Review the creator’s orders before continuing.');}
    if(pending.fingerprint!==fingerprint || typeof pending.requestKey!=='string' || !pending.requestKey)
      throw new Error('This creator has an unresolved seed request. Retry its original product, quantity and notes before starting another order.');
  } else {
    pending={fingerprint,requestKey:cryptoImpl.randomUUID()};
    storage.setItem(storageKey,JSON.stringify(pending));
  }
  return {requestKey:pending.requestKey,async complete(){
    await lockManager.request(storageKey,async()=>{
    // Never clear a newer request written by another tab.
    const current=storage.getItem(storageKey);
    if(current===JSON.stringify(pending))storage.removeItem(storageKey);
    });
  }};
  });
}
