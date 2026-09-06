import { driveContentDigest } from './approval-evidence.js';
import { ensureApprovalSnapshots } from './approval-snapshots.js';
import { ensureProviderMedia, resolveLaunchMedia } from './provider-media.js';
import { ensureOperationJournal } from './operation-journal.js';
export async function assertLaunchReady(sql, input) {
  await ensureApprovalSnapshots(sql);
  await ensureProviderMedia(sql);
  await ensureOperationJournal(sql);
  const media = await resolveLaunchMedia(sql,input);
  let creatorId = Number(input.creatorId || input.creator_id) || null;
  let deliverableId = Number(input.deliverableId || input.deliverable_id) || null;
  const known = await sql`
    SELECT DISTINCT creator_id, deliverable_id FROM (
      SELECT a.creator_id,a.deliverable_id FROM creative_assets a
      WHERE a.durable_url IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb))
        OR a.drive_file_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.driveIds)}::jsonb))
        OR a.meta_video_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.ids)}::jsonb))
        OR a.meta_image_hash IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.ids)}::jsonb))
      UNION
      SELECT u.creator_id,u.deliverable_id FROM ugc_sessions u
      WHERE u.video_url IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb))
        OR u.rendered_url IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(u.settings->'remotion_renders')='array' THEN u.settings->'remotion_renders' ELSE '[]'::jsonb END) r
          WHERE r->>'output_file' IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb)))
      UNION
      SELECT d.creator_id,d.id FROM creator_deliverables d
      WHERE d.output_url IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb))
        OR d.source_url IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.urls)}::jsonb))
        OR d.drive_file_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(media.driveIds)}::jsonb))
    ) sources WHERE creator_id IS NOT NULL
  `;
  const matchedCreators = [...new Set(known.map(row=>Number(row.creator_id)))];
  const matchedDeliverables = [...new Set(known.map(row=>Number(row.deliverable_id)).filter(Boolean))];
  if (matchedCreators.length > 1 || matchedDeliverables.length > 1) throw Object.assign(new Error('Mixed creator assets require separate approved launch packets.'),{statusCode:409});
  if (matchedCreators.length && creatorId && creatorId !== matchedCreators[0]) throw Object.assign(new Error('Asset ownership does not match the selected creator.'),{statusCode:409});
  if (matchedDeliverables.length && deliverableId && deliverableId !== matchedDeliverables[0]) throw Object.assign(new Error('Asset does not belong to the selected deliverable.'),{statusCode:409});
  creatorId ||= matchedCreators[0] || null;
  deliverableId ||= matchedDeliverables[0] || null;
  const external = creatorId || input.sourceType === 'external_creator' || input.source_type === 'external_creator';
  if (!external && !deliverableId) return;
  if (!deliverableId) throw Object.assign(new Error('Link the approved creator deliverable before launching this asset.'), { statusCode: 409 });
  const [deliverable] = await sql`
    SELECT d.*, approval.snapshot AS approval_snapshot, e.paid_media_included, e.starts_on, e.ends_on, e.usage_term_months,
      e.status AS engagement_status,
      (SELECT MAX(a.accepted_at) FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted') AS accepted_at,
      EXISTS (SELECT 1 FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted'
          AND (e.usage_term_months IS NULL OR a.accepted_at + make_interval(months => e.usage_term_months) > now())) AS rights_current
    FROM creator_deliverables d LEFT JOIN creator_engagements e ON e.id = d.engagement_id
    LEFT JOIN deliverable_approvals approval ON approval.id = d.approval_id
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
  const approved = deliverable.approval_snapshot;
  if (!approved) fail('Review and approve the exact output again; this legacy approval has no immutable snapshot.');
  if (Number(approved.engagement_id) !== Number(deliverable.engagement_id) || Number(approved.brief_id) !== Number(deliverable.brief_id)) fail('Deliverable terms or brief changed since approval. Approve it again.');
  const expectedUrl = approved.output_url || approved.source_url;
  const actualUrls = media.ids.length ? media.verifiedUrls : media.urls;
  if (media.unresolvedCreative) fail('Creative has no verified creation receipt. Recreate it from the approved output through HOWL.');
  if (media.ids.length && (!approved.evidence?.sha256 || media.receipts.some(row=>row.content_hash !== approved.evidence.sha256))) fail('Uploaded content does not match the approved output fingerprint. Upload and approve the same revision.');
  if (media.unresolvedIds.length) fail('Provider media has no verified source receipt. Upload the approved output through HOWL before launching.');
  if (actualUrls.some(url=>url !== expectedUrl)) fail('The selected media differs from the approved output. Approve this revision before launching.');
  if (media.driveIds.some(id=>id !== approved.drive_file_id)) fail('The selected Drive asset differs from the approved output.');
  for (const id of media.driveIds) {
    if (!approved.evidence?.drive_md5 || await driveContentDigest(id) !== approved.evidence.drive_md5) fail('Drive file content changed after approval. Review and approve this revision.');
  }
  if (!actualUrls.length && !media.driveIds.length) fail('No verifiable approved media is attached to this launch.');
  input.creatorId = creatorId || Number(deliverable.creator_id);
  input.deliverableId = deliverableId;
  input.sourceType = 'external_creator';
  return {driveDigests:Object.fromEntries(media.driveIds.map(id=>[id,approved.evidence.drive_md5]))};
}
