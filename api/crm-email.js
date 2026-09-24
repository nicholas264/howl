import { canAccessCrm } from '../src/lib/crm-access.js';
import { randomUUID } from 'node:crypto';
import { requirePermission } from './_lib/app-access.js';
import { getGoogleConnection, getUserGoogleAccessToken } from './_lib/google-user-oauth.js';
import { draftData, email, crmError, uuid, hash } from './_lib/crm.js';
const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
export const canSendGmail=connection=>Boolean(connection?.google_email&&connection.scopes?.some(s=>[SEND_SCOPE,'https://www.googleapis.com/auth/gmail.compose','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(s)));
export function gmailMime(data,id) {
  return [`To: ${email(data.to)}`,`Subject: =?UTF-8?B?${Buffer.from(data.subject).toString('base64')}?=`,`Message-ID: <campfire.crm.${id}@welcometothecampfire.io>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(data.body).toString('base64').match(/.{1,76}/g)?.join('\r\n')||''].join('\r\n');
}
export function createCrmEmailHandler({authorize=requirePermission,getConnection=getGoogleConnection,getToken=getUserGoogleAccessToken,fetchImpl=globalThis.fetch}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
    const access=await authorize(req,res,req.method==='GET'?'crm.read':'crm.send');if(!access)return;
    if(!canAccessCrm(access))return res.status(403).json({error:'CRM is currently restricted to the workspace owner.'});
    const {sql,userId}=access;
    try {
      if(req.method==='GET') {
        const connection=await getConnection(sql,userId);
        if(!req.query?.opportunityId)return res.json({connected:canSendGmail(connection),sender:connection?.google_email||null});
        if(!uuid(req.query.opportunityId))throw crmError('Invalid opportunity.');
        // Drafts and failed/uncertain attempts are private to their author. Confirmed outgoing mail is shared with CRM readers.
        const emails=await sql`SELECT id,opportunity_id,actor_id,data,revision,status,sender,provider_id,error,created_at,updated_at FROM crm_emails
          WHERE opportunity_id=${req.query.opportunityId} AND (actor_id=${userId} OR status IN ('sent','confirmed_sent')) ORDER BY created_at DESC,id DESC`;
        return res.json({emails:emails.map(e=>({...e,editable:e.actor_id===userId})),connected:canSendGmail(connection),sender:connection?.google_email||null});
      }
      const b=req.body||{};if(!uuid(b.id)||!uuid(b.opportunityId))throw crmError('Valid draft and opportunity IDs are required.');
      const [opportunity]=await sql`SELECT * FROM crm_opportunities WHERE id=${b.opportunityId}`;
      if(!opportunity)throw crmError('Opportunity not found.',404);
      let [draft]=await sql`SELECT * FROM crm_emails WHERE id=${b.id} AND actor_id=${userId} AND opportunity_id=${b.opportunityId}`;
      if(b.action==='save') {
        if(opportunity.archived)throw crmError('Restore the opportunity before composing email.');
        const data=draftData(b.data);
        if(!draft) {
          if(b.revision!==0)throw crmError('Draft not found. Reload the opportunity.',409);
          [draft]=await sql`INSERT INTO crm_emails(id,opportunity_id,actor_id,data) VALUES(${b.id},${b.opportunityId},${userId},${JSON.stringify(data)}::jsonb) ON CONFLICT DO NOTHING RETURNING *`;
          if(!draft)throw crmError('This draft already exists. Reload it before saving.',409);
        }else {
          if(draft.status!=='draft')throw crmError('This email has already been submitted. Its contents cannot be changed.',409);
          // A repeated save after a lost response is safe only when the contents match.
          if(hash(draft.data)===hash(data))return res.json({email:{...draft,editable:true}});
          if(!Number.isSafeInteger(b.revision)||b.revision!==draft.revision)throw crmError('This draft changed. Reload it before saving.',409);
          [draft]=await sql`UPDATE crm_emails SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,updated_at=now() WHERE id=${b.id} AND actor_id=${userId} AND revision=${b.revision} AND status='draft' RETURNING *`;
          if(!draft)throw crmError('This draft changed. Reload it before saving.',409);
        }
        return res.json({email:{...draft,editable:true}});
      }
      if(!draft)throw crmError('Draft not found.',404);
      if(b.action==='resolve') {
        if(!['confirmed_sent','confirmed_not_sent'].includes(b.outcome)||b.checkedGmail!==true)throw crmError('Check Gmail Sent and confirm the outcome first.');
        if(!['sending','uncertain'].includes(draft.status)||Date.now()-Date.parse(draft.updated_at)<120000)throw crmError('Wait at least two minutes after the attempt, then check Gmail Sent before resolving.',409);
        const detail={by:access.user?.display_name||access.user?.email||access.email||userId,emailId:draft.id,to:draft.data.to,subject:draft.data.subject,outcome:b.outcome,manual:true};
        const [saved]=await sql`WITH changed AS (
          UPDATE crm_emails SET status=${b.outcome},error=NULL,revision=revision+1,updated_at=now()
          WHERE id=${draft.id} AND actor_id=${userId} AND status=${draft.status} AND revision=${draft.revision} RETURNING *
        ), audit AS (
          INSERT INTO crm_activity(id,opportunity_id,actor_id,kind,detail,request_id,request_hash)
          SELECT ${randomUUID()},opportunity_id,${userId},'email_resolved',${JSON.stringify(detail)}::jsonb,${randomUUID()},${hash(detail)} FROM changed RETURNING id
        ) SELECT changed.* FROM changed JOIN audit ON true`;
        if(!saved)throw crmError('The send status changed. Reload it.',409);
        return res.json({email:{...saved,editable:true}});
      }
      if(b.action!=='send')throw crmError('Unknown email action.');
      if(draft.status!=='draft')return res.json({email:{...draft,editable:true},replayed:true});
      if(opportunity.archived)throw crmError('Restore the opportunity before sending.');
      const [unresolved]=await sql`SELECT id FROM crm_emails WHERE opportunity_id=${b.opportunityId} AND actor_id=${userId} AND id<>${draft.id} AND status IN ('sending','uncertain') LIMIT 1`;
      if(unresolved)throw crmError('Another email for this opportunity needs review. Resolve its status before sending again.',409);
      if(b.revision!==draft.revision)throw crmError('The draft changed. Reload and review before sending.',409);
      const data=draftData(draft.data);email(data.to);
      if(!data.subject||!data.body)throw crmError('Add a subject and message before sending.');
      const connection=await getConnection(sql,userId);
      if(!canSendGmail(connection))throw crmError('Connect your Gmail account with permission to send.',409);
      if(typeof b.sender!=='string'||b.sender.toLowerCase()!==connection.google_email.toLowerCase())throw crmError('The connected Gmail sender changed. Refresh and review the email before sending.',409);
      // Obtain credentials before claiming. Authentication failures do not consume the draft.
      const token=await getToken(sql,userId,connection);
      const [claimed]=await sql`UPDATE crm_emails SET status='sending',sender=${connection.google_email},revision=revision+1,updated_at=now()
        WHERE id=${draft.id} AND actor_id=${userId} AND status='draft' AND revision=${draft.revision} RETURNING *`;
      if(!claimed)throw crmError('This email is already being sent or changed. Reload its status.',409);
      let response,result;
      try {
        response=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
          method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
          body:JSON.stringify({raw:Buffer.from(gmailMime(data,draft.id)).toString('base64url')}),
        });
        result=await response.json();
        if(!response.ok||!result.id)throw new Error('Provider did not confirm sending');
      }catch {
        // No automatic retry: send-only permission cannot search Sent to reconcile a timeout.
        const definitive=response&&[400,401,403,404,413,429].includes(response.status);
        const status=definitive?'failed':'uncertain';
        const error=definitive?`Gmail rejected this attempt (${response.status}). Correct the issue and create a new draft.`:'Sending could not be confirmed. Check Gmail Sent before creating another email.';
        const [saved]=await sql`UPDATE crm_emails SET status=${status},error=${error},revision=revision+1,updated_at=now() WHERE id=${draft.id} AND status='sending' RETURNING *`;
        return res.json({email:{...saved,editable:true}});
      }
      const detail={by:access.user?.display_name||access.user?.email||access.email||userId,emailId:draft.id,to:data.to,subject:data.subject,sender:connection.google_email};
      const [saved]=await sql`WITH changed AS (
        UPDATE crm_emails SET status='sent',provider_id=${result.id},revision=revision+1,updated_at=now() WHERE id=${draft.id} AND status='sending' RETURNING *
      ), audit AS (
        INSERT INTO crm_activity(id,opportunity_id,actor_id,kind,detail,request_id,request_hash)
        SELECT ${randomUUID()},opportunity_id,${userId},'email_sent',${JSON.stringify(detail)}::jsonb,${randomUUID()},${hash(detail)} FROM changed RETURNING id
      ) SELECT changed.* FROM changed JOIN audit ON true`;
      if(!saved)throw crmError('Gmail accepted the email, but its saved status needs review. Do not resend. Check Gmail Sent.',503);
      return res.json({email:{...saved,editable:true}});
    }catch(error) {
      if(!error.statusCode)console.error('CRM email failed',{code:error.code||'unknown'});
      return res.status(error.statusCode||(error.reconnectRequired?409:503)).json({error:error.statusCode?error.message:error.reconnectRequired?'Your Google connection expired. Reconnect Gmail, then try again.':'Email status could not be confirmed. Reload this opportunity and check Gmail Sent before trying again.'});
    }
  };
}
export default createCrmEmailHandler();
