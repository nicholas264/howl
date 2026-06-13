import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function validEmail(value) {
  const email = (value || '').toString().trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

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

async function gmailAccessToken(req) {
  const refreshToken = req.cookies?.drive_refresh
    ? decodeURIComponent(req.cookies.drive_refresh)
    : null;
  if (!refreshToken) {
    const error = new Error('Gmail is not connected');
    error.reconnectRequired = true;
    throw error;
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) {
    const error = new Error('Google connection expired');
    error.reconnectRequired = true;
    throw error;
  }
  return tokens.access_token;
}

function header(message, name) {
  return message.payload?.headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

async function syncReplies({ sql, access, accessToken, creator }) {
  const sent = await sql`
    SELECT *
    FROM creator_outreach
    WHERE creator_id = ${creator.id}
      AND channel = 'email'
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
        { headers: { Authorization: `Bearer ${accessToken}` } },
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
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
      && header(message, 'From').toLowerCase().includes(creatorEmail)
      && Number(message.internalDate || 0) > new Date(outreach.sent_at || outreach.created_at).getTime()
    ));
    for (const message of inbound) {
      const existing = await sql`
        SELECT id FROM creator_outreach
        WHERE creator_id = ${creator.id} AND external_id = ${message.id}
        LIMIT 1
      `;
      if (existing.length) continue;
      const receivedAt = message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : new Date().toISOString();
      const [reply] = await sql`
        INSERT INTO creator_outreach (
          creator_id, channel, direction, subject, body, status, external_id,
          external_thread_id, recipient, sent_at, replied_at, last_synced_at, created_by
        ) VALUES (
          ${creator.id}, 'email', 'inbound', ${header(message, 'Subject') || outreach.subject},
          ${message.snippet || 'Reply received in Gmail'}, 'received', ${message.id},
          ${threadId}, ${header(message, 'To') || null}, ${receivedAt}, ${receivedAt}, now(), ${access.userId}
        )
        RETURNING id
      `;
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        VALUES (
          ${creator.id}, 'outreach_reply', 'Creator replied by email',
          ${JSON.stringify({ outreach_id: reply.id, gmail_message_id: message.id, gmail_thread_id: threadId })}::jsonb,
          ${access.userId}
        )
      `;
      replies += 1;
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
    return res.json({ connected: Boolean(req.cookies?.gmail_connected && req.cookies?.drive_refresh) });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id is required' });
    const [creator] = await sql`SELECT id, name, email FROM creators WHERE id = ${creatorId}`;
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    if (req.body?.action === 'sync') {
      if (!validEmail(creator.email)) return res.status(400).json({ error: 'Creator needs a valid email before Gmail sync' });
      const accessToken = await gmailAccessToken(req);
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

    if (agreementId) {
      const [agreement] = await sql`
        SELECT id, status FROM creator_agreements
        WHERE id = ${agreementId} AND creator_id = ${creatorId}
      `;
      if (!agreement || agreement.status !== 'draft') {
        return res.status(400).json({ error: 'A draft agreement for this creator is required' });
      }
    }
    const accessToken = await gmailAccessToken(req);
    const followUpAt = timestamp(req.body?.next_follow_up_at);
    if (followUpAt === undefined) return res.status(400).json({ error: 'Follow-up date is invalid' });

    const raw = [
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
    });
    const gmailData = await gmailResponse.json();
    if (!gmailResponse.ok) {
      const message = gmailData.error?.message || 'Gmail send failed';
      const reconnect = /scope|permission|credential|auth/i.test(message);
      return res.status(reconnect ? 401 : 502).json({ error: message, reconnect_required: reconnect });
    }

    const [message] = await sql`
      INSERT INTO creator_outreach (
        creator_id, channel, direction, subject, body, status,
        external_id, external_thread_id, recipient, sent_at, next_follow_up_at, created_by
      ) VALUES (
        ${creatorId}, 'email', 'outbound', ${subject}, ${body}, 'sent',
        ${gmailData.id || null}, ${gmailData.threadId || null}, ${to}, now(), ${followUpAt}, ${access.userId}
      )
      RETURNING *
    `;
    await sql`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      VALUES (
        ${creatorId}, 'outreach', 'Email sent',
        ${JSON.stringify({ outreach_id: message.id, gmail_message_id: gmailData.id, to })}::jsonb,
        ${access.userId}
      )
    `;
    if (agreementId) {
      await sql`
        UPDATE creator_agreements
        SET status = 'sent', sent_to = ${to}, sent_at = now(), updated_at = now()
        WHERE id = ${agreementId} AND creator_id = ${creatorId} AND status = 'draft'
      `;
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        VALUES (
          ${creatorId}, 'agreement_sent', 'Usage agreement sent',
          ${JSON.stringify({ agreement_id: agreementId, gmail_message_id: gmailData.id, to })}::jsonb,
          ${access.userId}
        )
      `;
    }
    return res.status(201).json({ message });
  } catch (err) {
    if (err.reconnectRequired) {
      return res.status(401).json({ error: err.message, reconnect_required: true });
    }
    return res.status(500).json({ error: err.message });
  }
}
