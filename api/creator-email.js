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

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  if (req.method === 'GET') {
    return res.json({ connected: Boolean(req.cookies?.gmail_connected && req.cookies?.drive_refresh) });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.body?.creator_id);
    const to = validEmail(req.body?.to);
    const subject = (req.body?.subject || '').toString().trim().slice(0, 500);
    const body = (req.body?.body || '').toString().trim().slice(0, 50000);
    if (!creatorId || !to || !subject || !body) {
      return res.status(400).json({ error: 'creator_id, valid to, subject, and body are required' });
    }

    const [creator] = await sql`SELECT id, name, email FROM creators WHERE id = ${creatorId}`;
    if (!creator) return res.status(404).json({ error: 'Creator not found' });
    const refreshToken = req.cookies?.drive_refresh
      ? decodeURIComponent(req.cookies.drive_refresh)
      : null;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Gmail is not connected', reconnect_required: true });
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
      return res.status(401).json({ error: 'Google connection expired', reconnect_required: true });
    }

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
        Authorization: `Bearer ${tokens.access_token}`,
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
        external_id, sent_at, created_by
      ) VALUES (
        ${creatorId}, 'email', 'outbound', ${subject}, ${body}, 'sent',
        ${gmailData.id || null}, now(), ${access.userId}
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
    return res.status(201).json({ message });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
