import { createHash } from 'node:crypto';

export function agreementTokenHash(token) {
  return createHash('sha256').update((token || '').toString()).digest('hex');
}

function money(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function date(value) {
  if (!value) return '';
  const parsed = new Date(`${value}`.slice(0, 10) + 'T12:00:00');
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function renderAgreementTemplate(template, creator, engagement) {
  const values = {
    creator_name: creator?.name || '',
    creator_email: creator?.email || '',
    engagement_type: engagement?.engagement_type === 'retainer' ? 'Retainer' : 'One-off',
    approval_date: date(engagement?.approval_date),
    start_date: date(engagement?.starts_on),
    end_date: date(engagement?.ends_on),
    asset_commitment: engagement?.asset_commitment ?? '',
    commitment_period: engagement?.commitment_period || '',
    cadence: engagement?.cadence || '',
    total_fee: money(engagement?.fee_amount, engagement?.fee_currency),
    usage_term_months: engagement?.usage_term_months ?? '',
    payment_terms: engagement?.payment_terms || '',
    exclusivity_notes: engagement?.exclusivity_notes || 'None',
  };
  const render = value => (value || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? String(values[key.toLowerCase()]) : match
  ));
  return {
    title: render(template?.title),
    agreement_body: render(template?.agreement_body),
  };
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
      e.asset_commitment, e.commitment_period, e.cadence, e.fee_amount, e.fee_currency,
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
