export function validEmail(value) {
  const email = (value || '').toString().trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendResendEmail({ from, to, subject, text, html, replyTo, idempotencyKey }) {
  if (!process.env.RESEND_API_KEY) {
    return { skipped: true, reason: 'RESEND_API_KEY not configured' };
  }
  const recipients = (Array.isArray(to) ? to : [to]).map(validEmail).filter(Boolean);
  if (!recipients.length) return { skipped: true, reason: 'No valid recipients' };
  if (!subject || (!text && !html)) return { skipped: true, reason: 'Subject and body are required' };

  const payload = {
    from: from || process.env.EMAIL_FROM || 'HOWL Campfires <alerts@howlcampfires.com>',
    to: recipients,
    subject,
  };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (replyTo && validEmail(replyTo)) payload.reply_to = replyTo;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = { raw: body.slice(0, 500) };
  }
  if (!response.ok) {
    return {
      skipped: true,
      provider: 'resend',
      reason: data.message || data.error || `Resend HTTP ${response.status}`,
    };
  }
  return { provider: 'resend', ...data };
}
