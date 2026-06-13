import { neon } from '@neondatabase/serverless';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { agreementTokenHash, getAgreementByToken } from './_lib/creator-agreements.js';

function publicAgreement(agreement) {
  const expired = agreement.expires_at && new Date(agreement.expires_at).getTime() <= Date.now();
  return {
    id: Number(agreement.id),
    title: agreement.title,
    agreement_body: agreement.agreement_body,
    version: agreement.version,
    creator_name: agreement.creator_name,
    creator_email: agreement.creator_email,
    expires_at: agreement.expires_at,
    status: expired && agreement.status === 'sent' ? 'expired' : agreement.status,
    accepted_name: agreement.accepted_name,
    accepted_at: agreement.accepted_at,
    engagement: agreement.engagement_id ? {
      type: agreement.engagement_type,
      approval_date: agreement.approval_date,
      starts_on: agreement.starts_on,
      ends_on: agreement.ends_on,
      asset_commitment: agreement.asset_commitment,
      commitment_period: agreement.commitment_period,
      cadence: agreement.cadence,
      fee_amount: agreement.fee_amount,
      fee_currency: agreement.fee_currency,
      usage_term_months: agreement.usage_term_months,
      paid_media_included: agreement.paid_media_included,
      raw_footage_included: agreement.raw_footage_included,
      exclusivity_notes: agreement.exclusivity_notes,
      payment_terms: agreement.payment_terms,
    } : null,
  };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const token = (req.method === 'GET' ? req.query?.token : req.body?.token || '').toString();
  const sql = neon(process.env.DATABASE_URL);

  try {
    await ensureCreatorOpsTables(sql);
    const agreement = await getAgreementByToken(sql, token);
    if (!agreement) return res.status(404).json({ error: 'Agreement link not found' });

    if (req.method === 'GET') {
      if (agreement.status === 'sent' && !agreement.viewed_at) {
        await sql`
          UPDATE creator_agreements SET viewed_at = now(), updated_at = now()
          WHERE id = ${agreement.id} AND viewed_at IS NULL
        `;
      }
      return res.json({ agreement: publicAgreement(agreement) });
    }

    if (agreement.status !== 'sent'
      || (agreement.expires_at && new Date(agreement.expires_at).getTime() <= Date.now())) {
      return res.status(409).json({ error: 'This agreement is no longer available for acceptance' });
    }

    const acceptedName = (req.body?.accepted_name || '').toString().trim().slice(0, 200);
    const acceptedEmail = (req.body?.accepted_email || '').toString().trim().toLowerCase().slice(0, 320);
    const confirmed = req.body?.confirmed === true;
    if (acceptedName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acceptedEmail) || !confirmed) {
      return res.status(400).json({ error: 'Full name, valid email, and confirmation are required' });
    }
    if (agreement.sent_to && acceptedEmail !== agreement.sent_to.toLowerCase()) {
      return res.status(400).json({ error: 'Use the email address this agreement was sent to' });
    }

    const forwarded = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
    const acceptedIp = forwarded || req.socket?.remoteAddress || null;
    const acceptedUserAgent = (req.headers['user-agent'] || '').toString().slice(0, 1000) || null;
    const tokenHash = agreementTokenHash(token);
    const [accepted] = await sql`
      WITH signed AS (
        UPDATE creator_agreements
        SET status = 'accepted', accepted_name = ${acceptedName},
            accepted_email = ${acceptedEmail}, accepted_at = now(),
            accepted_ip = ${acceptedIp}, accepted_user_agent = ${acceptedUserAgent},
            updated_at = now()
        WHERE id = ${agreement.id}
          AND token_hash = ${tokenHash}
          AND status = 'sent'
          AND (expires_at IS NULL OR expires_at > now())
        RETURNING creator_id, engagement_id, title, accepted_at
      ),
      engagement_update AS (
        UPDATE creator_engagements e
        SET status = 'active', updated_at = now()
        FROM signed
        WHERE e.id = signed.engagement_id
      ),
      creator_update AS (
        UPDATE creators c
        SET status = 'contracted',
            stage = CASE WHEN c.stage IN ('sourced', 'contacted', 'interested') THEN 'briefing' ELSE c.stage END,
            updated_at = now()
        FROM signed
        WHERE c.id = signed.creator_id
      ),
      activity AS (
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        SELECT creator_id, 'agreement_accepted', ${`Agreement accepted: ${agreement.title}`},
          ${JSON.stringify({ agreement_id: Number(agreement.id), accepted_name: acceptedName })}::jsonb,
          ${`creator-agreement:${agreement.id}`}
        FROM signed
      )
      SELECT * FROM signed
    `;
    if (!accepted) return res.status(409).json({ error: 'This agreement was already accepted or is unavailable' });
    const updated = await getAgreementByToken(sql, token);
    return res.status(201).json({ agreement: publicAgreement(updated) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not process agreement' });
  }
}
