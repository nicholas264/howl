import { gmailRequestMessageId, recoverGmailSend } from './_lib/gmail-send-recovery.js';
import { runExternalStep, operationKey, digest } from './_lib/operation-journal.js';
import { requirePermission } from './_lib/app-access.js';

import { getGoogleConnection, getUserGoogleAccessToken } from './_lib/google-user-oauth.js';
import { resendConfigured, sendResendEmail, validEmail } from './_lib/resend-email.js';

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value || '', 'utf8').toString('base64')}?=`;
}

function base64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function header(message, name) {
  return message.payload?.headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

export function senderMatches(value,email) {
  const text=String(value || '').trim();
  const bracket=text.match(/^[^<>]*<([^<>]+)>$/);
  const address=validEmail(bracket ? bracket[1] : text);
  return Boolean(address && address.toLowerCase()===String(email || '').trim().toLowerCase());
}

export async function syncReplies({ sql, access, accessToken, creator }) {
  const signal=AbortSignal.timeout(45000);
  const sent = await sql`
    SELECT *
    FROM creator_outreach
    WHERE creator_id = ${creator.id}
      AND channel = 'email'
      AND created_by = ${access.userId}
      AND direction = 'outbound'
      AND external_id IS NOT NULL
      AND status IN ('sent', 'follow_up', 'replied')
    ORDER BY sent_at DESC
    LIMIT 100
  `;
  let replies = 0;
  let threads = 0;
  for (const outreach of sent) {
    let threadId = outreach.external_thread_id;
    if (!threadId) {
      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(outreach.external_id)}?format=minimal`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal },
      );
      const messageData = await messageResponse.json();
      if (!messageResponse.ok) {
        const error = new Error(messageData.error?.message || 'Gmail message lookup failed');
        error.reconnectRequired = messageResponse.status === 401 || messageResponse.status === 403;
        throw error;
      }
      threadId = messageData.threadId || null;
    }
    if (!threadId) continue;
    threads += 1;
    const threadResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal },
    );
    const thread = await threadResponse.json();
    if (!threadResponse.ok) {
      const error = new Error(thread.error?.message || 'Gmail thread sync failed');
      error.reconnectRequired = threadResponse.status === 401 || threadResponse.status === 403;
      throw error;
    }
    const creatorEmail = creator.email.toLowerCase();
    const inbound = (thread.messages || []).filter(message => (
      message.id !== outreach.external_id
      && senderMatches(header(message, 'From'),creatorEmail)
      && Number(message.internalDate || 0) > new Date(outreach.sent_at || outreach.created_at).getTime()
    ));
    for (const message of inbound) {
      // Preserve pre-journal replies without importing them a second time.
      const [legacy]=await sql`SELECT id FROM creator_outreach
        WHERE creator_id=${creator.id} AND created_by=${access.userId}
          AND direction='inbound' AND external_id=${message.id} AND request_key IS NULL LIMIT 1`;
      if(legacy)continue;
      const receivedAt = message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : new Date().toISOString();
      const replyKey=digest(['gmail-reply',access.userId,creator.id,message.id]);
      const [reply] = await sql`
        WITH reply AS (
          INSERT INTO creator_outreach (
            creator_id, channel, direction, subject, body, status, external_id,
            external_thread_id, recipient, sent_at, replied_at, last_synced_at, created_by, request_key
          ) VALUES (
            ${creator.id}, 'email', 'inbound', ${header(message, 'Subject') || outreach.subject},
            ${message.snippet || 'Reply received in Gmail'}, 'received', ${message.id},
            ${threadId}, ${header(message, 'To') || null}, ${receivedAt}, ${receivedAt}, now(), ${access.userId},${replyKey}
          ) ON CONFLICT (request_key) DO NOTHING RETURNING id
        ), activity AS (
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id, event_key)
          SELECT ${creator.id},'outreach_reply','Creator replied by email',
            jsonb_build_object('outreach_id',id,'gmail_message_id',${message.id}::text,'gmail_thread_id',${threadId}::text),
            ${access.userId},${replyKey+':activity'} FROM reply
          ON CONFLICT (event_key) DO NOTHING RETURNING id
        ) SELECT id FROM reply
      `;
      if(reply)replies += 1;
    }
    if (inbound.length) {
      await sql`
        UPDATE creator_outreach
        SET status = 'replied', replied_at = COALESCE(replied_at, now()),
            next_follow_up_at = NULL, external_thread_id = ${threadId},
            last_synced_at = now(), updated_at = now()
        WHERE id = ${outreach.id}
      `;
    } else {
      await sql`
        UPDATE creator_outreach
        SET external_thread_id = ${threadId}, last_synced_at = now(), updated_at = now()
        WHERE id = ${outreach.id}
      `;
    }
  }
  return { replies, threads };
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'briefs.write');
  if (!access) return;
  if (req.method === 'GET') {
    const connection = await getGoogleConnection(access.sql, access.userId);
    const sendProvider = resendConfigured() ? 'resend' : (connection ? 'gmail' : null);
    return res.json({
      connected: Boolean(sendProvider),
      gmailConnected: Boolean(connection),
      resendConfigured: resendConfigured(),
      sendProvider,
      connection,
    });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {

    const creatorId = Number(req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id is required' });
    const [creator] = await sql`SELECT id, name, email FROM creators WHERE id = ${creatorId}`;
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    if (req.body?.action === 'sync') {
      if (!validEmail(creator.email)) return res.status(400).json({ error: 'Creator needs a valid email before Gmail sync' });
      const accessToken = await getUserGoogleAccessToken(sql, access.userId);
      const result = await syncReplies({ sql, access, accessToken, creator });
      return res.json(result);
    }

    const to = validEmail(req.body?.to);
    const subject = (req.body?.subject || '').toString().trim().slice(0, 500);
    const body = (req.body?.body || '').toString().trim().slice(0, 50000);
    const agreementId = Number(req.body?.agreement_id) || null;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'creator_id, valid to, subject, and body are required' });
    }

    const followUpAt = timestamp(req.body?.next_follow_up_at);
    if (followUpAt === undefined) return res.status(400).json({ error: 'Follow-up date is invalid' });


    const requestKey = operationKey(req, access.userId, 'creator-email');
    const sendPayload={creatorId,to,subject,body,agreementId,followUpAt,provider:resendConfigured()?'resend':'gmail'};
    if(sendPayload.provider==='gmail')sendPayload.gmailMessageId=gmailRequestMessageId(requestKey);
    await recoverGmailSend(sql,{operationKey:requestKey,actorId:access.userId,payload:sendPayload},()=>getUserGoogleAccessToken(sql,access.userId));
    const { provider, externalId, externalThreadId, providerMessageId } = await runExternalStep(sql, {
      operationKey: requestKey, stepKey: 'send', payload: sendPayload, actorId: access.userId,
    }, async () => {
    if (agreementId) {
      try {
        const [agreement] = await sql`SELECT id,status FROM creator_agreements
          WHERE id=${agreementId} AND creator_id=${creatorId}`;
        if (!agreement || !['draft','sent'].includes(agreement.status)) {
          throw Object.assign(new Error('A draft agreement for this creator is required'),{statusCode:400});
        }
      } catch(error) {
        // Validate only before a new send; replay must survive later acceptance.
        error.definitelyNotApplied=true;throw error;
      }
    }
    let provider = 'gmail';
    let externalId = null;
    let externalThreadId = null;
    let providerMessageId = null;

    if (resendConfigured()) {
      provider = 'resend';
      const email = await sendResendEmail({
        from: process.env.CREATOR_EMAIL_FROM || process.env.EMAIL_FROM || 'HOWL Campfires <creators@howlcampfires.com>',
        to,
        subject,
        text: body,
        replyTo: validEmail(access.email),
        idempotencyKey: requestKey,
      });
      if (email.skipped) {
        throw new Error(email.reason || 'Resend send failed');
      }
      providerMessageId = email.id || null;
    } else {
      const accessToken = await getUserGoogleAccessToken(sql, access.userId);
      const raw = [
        `Message-ID: ${sendPayload.gmailMessageId}`,
        `To: ${to}`,
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ].join('\r\n');
      const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: base64Url(raw) }),
        signal: AbortSignal.timeout(30000),
      });
      const gmailData = await gmailResponse.json();
      if (!gmailResponse.ok) {
        const message = gmailData.error?.message || 'Gmail send failed';
        const reconnect = /scope|permission|credential|auth/i.test(message);
        throw Object.assign(new Error(message), { reconnectRequired: reconnect });
      }
      externalId = gmailData.id || null;
      externalThreadId = gmailData.threadId || null;
      providerMessageId = externalId;
    }

      if (typeof providerMessageId !== 'string' || !providerMessageId.trim()) {
        throw new Error('Email provider returned no message receipt. Reconcile this attempt before retrying.');
      }
      return { provider, externalId, externalThreadId, providerMessageId };
    });

    const [message] = await sql`
      WITH outreach AS (
        INSERT INTO creator_outreach (
          creator_id, channel, direction, subject, body, status,
          external_id, external_thread_id, recipient, sent_at, next_follow_up_at, created_by, request_key
        ) VALUES (
          ${creatorId}, 'email', 'outbound', ${subject}, ${body}, 'sent',
          ${externalId}, ${externalThreadId}, ${to}, now(), ${followUpAt}, ${access.userId}, ${requestKey}
        )
        ON CONFLICT (request_key) DO UPDATE SET request_key = EXCLUDED.request_key
        RETURNING *
      ), outreach_activity AS (
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id, event_key)
        SELECT creator_id, 'outreach', 'Email sent',
          jsonb_build_object('outreach_id',id,'provider',${provider}::text,'external_id',${providerMessageId}::text,'to',${to}::text),
          ${access.userId}, ${requestKey+':outreach'} FROM outreach
        ON CONFLICT (event_key) DO NOTHING RETURNING id
      ), agreement AS (
        UPDATE creator_agreements SET status='sent',sent_to=${to},sent_at=now(),updated_at=now()
        WHERE id=${agreementId} AND creator_id=${creatorId} AND status='draft'
          AND EXISTS (SELECT 1 FROM outreach)
        RETURNING id
      ), agreement_activity AS (
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id, event_key)
        SELECT creator_id, 'agreement_sent', 'Usage agreement sent',
          ${JSON.stringify({agreement_id:agreementId,provider,external_id:providerMessageId,to})}::jsonb,
          ${access.userId}, ${requestKey+':agreement'} FROM outreach WHERE ${agreementId}::int IS NOT NULL
        ON CONFLICT (event_key) DO NOTHING RETURNING id
      ) SELECT * FROM outreach
    `;
    return res.status(201).json({ message });
  } catch (err) {
    if (err.reconnectRequired) {
      return res.status(401).json({ error: err.message, reconnect_required: true });
    }
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}
