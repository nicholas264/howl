export async function assertLaunchReady(sql, input) {
  const creatorId = Number(input.creatorId || input.creator_id) || null;
  const deliverableId = Number(input.deliverableId || input.deliverable_id) || null;
  const external = creatorId || input.sourceType === 'external_creator' || input.source_type === 'external_creator';
  if (!external && !deliverableId) return;
  if (!deliverableId) throw Object.assign(new Error('Link the approved creator deliverable before launching this asset.'), { statusCode: 409 });
  const [deliverable] = await sql`
    SELECT d.*, e.paid_media_included, e.starts_on, e.ends_on, e.usage_term_months,
      e.status AS engagement_status,
      (SELECT MAX(a.accepted_at) FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted') AS accepted_at,
      EXISTS (SELECT 1 FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted'
          AND (e.usage_term_months IS NULL OR a.accepted_at + make_interval(months => e.usage_term_months) > now())) AS rights_current
    FROM creator_deliverables d LEFT JOIN creator_engagements e ON e.id = d.engagement_id
    WHERE d.id = ${deliverableId}
  `;
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };
  if (!deliverable || (creatorId && Number(deliverable.creator_id) !== creatorId)) fail('Creator and deliverable do not match.');
  if (!['approved', 'complete', 'launched'].includes(deliverable.status) || !deliverable.approved_at) fail('Approve the deliverable before launching it.');
  if (!deliverable.paid_media_included || !deliverable.rights_current || !['approved', 'active'].includes(deliverable.engagement_status)) fail('An accepted, current paid-media agreement is required.');
  const today = new Date().toISOString().slice(0,10);
  const dateOnly = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
  if ((deliverable.starts_on && dateOnly(deliverable.starts_on) > today) || (deliverable.ends_on && dateOnly(deliverable.ends_on) < today)) fail('Creator usage term does not cover today.');
  const briefId = Number(input.briefId || input.brief_id) || null;
  if (briefId && Number(deliverable.brief_id) !== briefId) fail('Brief and deliverable do not match.');
}
