import {digest} from './operation-journal.js';

export const gmailRequestMessageId=key=>`<howl.${key}@welcometothecampfire.io>`;
const conflict=message=>Object.assign(new Error(message),{statusCode:409});
const normalized=value=>String(value).replace(/\r\n/g,'\n').trim();

export function verifyGmailSend(step,message) {
  const payload=step.request_payload;
  const header=name=>{
    const matches=(message.payload?.headers || []).filter(h=>h.name?.toLowerCase()===name);
    return matches.length===1?String(matches[0].value).trim():null;
  };
  if(payload?.provider!=='gmail' || !payload.gmailMessageId || header('message-id')!==payload.gmailMessageId
    || !message.labelIds?.includes('SENT') || !message.id || !message.threadId)
    throw conflict('Gmail did not verify the original sent-message identity.');
  const encodedSubject=`=?UTF-8?B?${Buffer.from(payload.subject,'utf8').toString('base64')}?=`;
  if(header('to')?.toLowerCase()!==payload.to.toLowerCase() || ![payload.subject,encodedSubject].includes(header('subject')))
    throw conflict('The Gmail recipient or subject does not match the original send.');
  const data=message.payload?.body?.data;
  if(message.payload?.mimeType!=='text/plain' || typeof data!=='string' || !/^[A-Za-z0-9_=-]*$/.test(data)
    || normalized(Buffer.from(data,'base64url').toString('utf8'))!==normalized(payload.body))
    throw conflict('The Gmail body could not be verified against the original send.');
  const sent=Number(message.internalDate),started=Date.parse(step.created_at),updated=Date.parse(step.updated_at);
  if(![sent,started,updated].every(Number.isFinite) || updated<started || sent<started-120000 || sent>updated+300000)
    throw conflict('The Gmail send time does not match this attempt.');
  return {provider:'gmail',externalId:message.id,externalThreadId:message.threadId,providerMessageId:message.id};
}

export async function recoverGmailSend(sql,{operationKey,actorId,payload},getToken,fetchImpl=globalThis.fetch) {
  const [step]=await sql`SELECT * FROM app_operation_steps WHERE operation_key=${operationKey} AND step_key='send'`;
  if(!step || !['pending','uncertain'].includes(step.status) || Date.now()-Date.parse(step.updated_at)<600000)return;
  if(step.actor_id!==actorId || step.request_hash!==digest(payload) || step.request_payload?.provider!=='gmail')return;
  const token=await getToken(),signal=AbortSignal.timeout(30000);
  const read=async url=>{
    const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal});
    if(!response.ok)throw conflict(`Gmail could not verify the send (${response.status}).`);
    return response.json();
  };
  const search=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  search.searchParams.set('q',`in:sent rfc822msgid:${payload.gmailMessageId}`);search.searchParams.set('maxResults','2');
  const matches=await read(search);
  if(matches.nextPageToken || matches.messages?.length!==1)throw conflict('Gmail has not returned one unique matching sent message. The send remains uncertain.');
  const id=matches.messages[0].id;
  if(typeof id!=='string' || !/^[a-zA-Z0-9_-]+$/.test(id))throw conflict('Gmail returned an invalid message identity.');
  const message=await read(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  if(message.id!==id)throw conflict('Gmail returned a different message than the search result.');
  const result=verifyGmailSend(step,message);
  const [saved]=await sql`WITH recovered AS (
    UPDATE app_operation_steps SET status='completed',result=${JSON.stringify(result)}::jsonb,updated_at=now()
    WHERE operation_key=${operationKey} AND step_key='send' AND actor_id=${actorId} AND status=${step.status} AND updated_at=${step.updated_at}
    RETURNING operation_key
  ), audit AS (
    INSERT INTO app_admin_audit(actor_id,action,target,metadata)
    SELECT ${actorId},'operation.reconciled',operation_key,
      ${JSON.stringify({provider:'gmail',messageId:result.externalId,verification:'Original RFC message ID, sent label, recipient, subject, plain-text body and attempt time'})}::jsonb FROM recovered
    RETURNING id
  ) SELECT id FROM audit`;
  if(!saved)throw conflict('The email attempt changed during recovery. Reload and retry.');
}
