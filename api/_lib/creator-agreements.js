import { createHash } from 'node:crypto';

export function agreementTokenHash(token) {
  return createHash('sha256').update((token || '').toString()).digest('hex');
}

export async function getAgreementByToken(sql, token) {
  if (!token || token.length < 32 || token.length > 200) return null;
  const [agreement] = await sql`
    SELECT
      a.id, a.creator_id, a.engagement_id, a.title, a.agreement_body,
      a.version, a.status, a.expires_at, a.sent_to, a.sent_at, a.viewed_at,
      a.accepted_name, a.accepted_email, a.accepted_at, a.created_at,
      c.name AS creator_name, c.email AS creator_email,
      e.engagement_type, e.approval_date, e.starts_on, e.ends_on,
      e.asset_commitment, e.cadence, e.fee_amount, e.fee_currency,
      e.usage_term_months, e.paid_media_included, e.raw_footage_included,
      e.exclusivity_notes, e.payment_terms
    FROM creator_agreements a
    JOIN creators c ON c.id = a.creator_id
    LEFT JOIN creator_engagements e ON e.id = a.engagement_id
    WHERE a.token_hash = ${agreementTokenHash(token)}
    LIMIT 1
  `;
  return agreement || null;
}
