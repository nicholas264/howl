import { driveContentDigest } from './approval-evidence.js';
import { resolveLaunchMedia } from './provider-media.js';
export async function assertLaunchReady(sql, input, {driveDigest=driveContentDigest} = {}) {
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
  if (matchedCreators.length > 1) throw Object.assign(new Error('Mixed creators require separate approved launch packets.'),{statusCode:409});
  if (matchedDeliverables.length > 1 && input.action==='create_paired_image_ad') {
    const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
    if(matchedDeliverables.length!==2 || media.driveIds.length || media.unresolvedIds.length || media.unresolvedCreative)fail('A paired image launch requires exactly two verified deliverables.');
    const references=media.ids.length
      ? ['feed','story'].map(role=>{const id=input[`${role}ImageHash`],receipt=media.receipts.find(row=>row.provider_id===id&&row.kind==='image');return {role,id,url:receipt?.source_url};})
      : (input.review_sources || []).map(row=>({role:row.role,url:row.imageUrl}));
    if(references.length!==2 || new Set(references.map(row=>row.role)).size!==2 || references.some(row=>!['feed','story'].includes(row.role)||!row.url)
      || new Set(references.map(row=>row.url)).size!==2 || (media.ids.length && (media.ids.length!==2 || references.some(row=>!row.id))))fail('Feed and story must each identify their own approved image.');
    if(media.urls.some(url=>!references.some(row=>row.url===url)))fail('The pair includes an additional unreviewed media reference.');
    const pairedMediaApprovals={};
    for(const reference of references){
      const result=await assertLaunchReady(sql,{...(reference.id?{imageHash:reference.id}:{imageUrl:reference.url}),creatorId:creatorId || matchedCreators[0],sourceType:'external_creator',briefId:input.briefId || input.brief_id},{driveDigest});
      if(!result?.approval)fail('Each paired image requires its own current output approval.');
      pairedMediaApprovals[reference.role]=result.approval;
    }
    const approvedIds=Object.values(pairedMediaApprovals).map(approval=>Number(approval.deliverable_id));
    if(new Set(approvedIds).size!==2 || matchedDeliverables.some(id=>!approvedIds.includes(id)) || (deliverableId&&!approvedIds.includes(deliverableId)))fail('Selected deliverables do not match the paired outputs.');
    input.creatorId=creatorId || matchedCreators[0];input.sourceType='external_creator';
    return {pairedMediaApprovals};
  }
  if (matchedDeliverables.length > 1) {
    const files=[input.pair?.feedFileId,input.pair?.storyFileId];
    if(input.action!=='launch_meta_ad' || files.some(id=>!id) || new Set(files).size!==2
      || media.driveIds.length!==2 || media.driveIds.some(id=>!files.includes(id)) || media.ids.length || media.urls.length)
      throw Object.assign(new Error('Multiple deliverables require a separately approved Drive file for each paired placement.'),{statusCode:409});
    if(deliverableId && !matchedDeliverables.includes(deliverableId))throw Object.assign(new Error('Selected deliverable is not part of this pair.'),{statusCode:409});
    const registered=await sql`SELECT drive_file_id FROM creative_assets WHERE drive_file_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(files)}::jsonb))`;
    if(registered.length!==2)throw Object.assign(new Error('Refresh both paired files into the Drive workspace before launch.'),{statusCode:409});
    const pairedApprovals={},driveDigests={};
    for(const fileId of files){
      const result=await assertLaunchReady(sql,{fileId,creatorId:creatorId || matchedCreators[0],sourceType:'external_creator',briefId:input.briefId || input.brief_id},{driveDigest});
      if(!result?.approval)throw Object.assign(new Error('Every paired file requires its own current approval.'),{statusCode:409});
      pairedApprovals[fileId]=result.approval;Object.assign(driveDigests,result.driveDigests);
    }
    if(new Set(Object.values(pairedApprovals).map(approval=>Number(approval.deliverable_id))).size!==2)
      throw Object.assign(new Error('Paired files must resolve to two distinct approved deliverables.'),{statusCode:409});
    input.creatorId=creatorId || matchedCreators[0];input.sourceType='external_creator';
    return {driveDigests,pairedApprovals};
  }
  if (matchedCreators.length && creatorId && creatorId !== matchedCreators[0]) throw Object.assign(new Error('Asset ownership does not match the selected creator.'),{statusCode:409});
  if (matchedDeliverables.length && deliverableId && deliverableId !== matchedDeliverables[0]) throw Object.assign(new Error('Asset does not belong to the selected deliverable.'),{statusCode:409});
  creatorId ||= matchedCreators[0] || null;
  deliverableId ||= matchedDeliverables[0] || null;
  const external = creatorId || input.sourceType === 'external_creator' || input.source_type === 'external_creator';
  if (!external && !deliverableId) return;
  if (!deliverableId) throw Object.assign(new Error('Link the approved creator deliverable before launching this asset.'), { statusCode: 409 });
  const [deliverable] = await sql`
    SELECT d.*, approval.snapshot AS approval_snapshot,
      (approval.snapshot->>'context_version'='1'
        AND approval.snapshot->'brief_snapshot' IS NOT DISTINCT FROM COALESCE((SELECT to_jsonb(b)-ARRAY['status','created_at','updated_at','generation_source','created_by']::text[] FROM creator_briefs b WHERE b.id=d.brief_id),'null'::jsonb)
        AND (approval.snapshot->'engagement_snapshot')-'notes' IS NOT DISTINCT FROM COALESCE(to_jsonb(e)-ARRAY['status','approval_date','created_at','updated_at','created_by','notes']::text[],'null'::jsonb)) AS approval_context_current,
      e.paid_media_included, e.starts_on, e.ends_on, e.usage_term_months,
      e.status AS engagement_status,
      (SELECT jsonb_build_object('id',a.id,'version',a.version,'accepted_at',a.accepted_at)
        FROM creator_agreements a WHERE a.engagement_id=d.engagement_id AND a.creator_id=d.creator_id AND a.status='accepted'
          AND a.source_metadata->>'terms_version'='1'
          AND (a.source_metadata->'engagement_snapshot')-ARRAY['status','approval_date','created_at','updated_at','created_by','notes']::text[]
            = to_jsonb(e)-ARRAY['status','approval_date','created_at','updated_at','created_by','notes']::text[]
          AND (e.usage_term_months IS NULL OR a.accepted_at+make_interval(months=>e.usage_term_months)>now())
        ORDER BY a.accepted_at DESC,a.id DESC LIMIT 1) AS rights_record,
      (SELECT MAX(a.accepted_at) FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted') AS accepted_at,
      EXISTS (SELECT 1 FROM creator_agreements a
        WHERE a.engagement_id = d.engagement_id AND a.creator_id = d.creator_id AND a.status = 'accepted'
          AND a.source_metadata->>'terms_version'='1'
          AND (a.source_metadata->'engagement_snapshot')-ARRAY['status','approval_date','created_at','updated_at','created_by','notes']::text[]
            = to_jsonb(e)-ARRAY['status','approval_date','created_at','updated_at','created_by','notes']::text[]
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
  if(!deliverable.approval_context_current) fail('Brief or engagement terms changed, or this approval lacks their snapshot. Review and approve the output again.');
  const expectedUrl = approved.output_url || approved.source_url;
  const actualUrls = media.ids.length ? media.verifiedUrls : media.urls;
  if (media.unresolvedCreative) fail('Creative has no verified creation receipt. Recreate it from the approved output through HOWL.');
  if (media.ids.length && (!approved.evidence?.sha256 || media.receipts.some(row=>row.content_hash !== approved.evidence.sha256))) fail('Uploaded content does not match the approved output fingerprint. Upload and approve the same revision.');
  if (media.unresolvedIds.length) fail('Provider media has no verified source receipt. Upload the approved output through HOWL before launching.');
  if (actualUrls.some(url=>url !== expectedUrl)) fail('The selected media differs from the approved output. Approve this revision before launching.');
  if (media.driveIds.some(id=>id !== approved.drive_file_id)) fail('The selected Drive asset differs from the approved output.');
  for (const id of media.driveIds) {
    if (!approved.evidence?.drive_md5 || await driveDigest(id) !== approved.evidence.drive_md5) fail('Drive file content changed after approval. Review and approve this revision.');
  }
  if (!actualUrls.length && !media.driveIds.length) fail('No verifiable approved media is attached to this launch.');
  input.creatorId = creatorId || Number(deliverable.creator_id);
  input.deliverableId = deliverableId;
  input.sourceType = 'external_creator';
  return {driveDigests:Object.fromEntries(media.driveIds.map(id=>[id,approved.evidence.drive_md5])),
    approval:{id:deliverable.approval_id,creator_id:deliverable.creator_id,deliverable_id:deliverableId,
      snapshot:approved,accepted_agreement:deliverable.rights_record}};
}

export function assertApprovalMediaMatches(evidence,media) {
  const approvals=evidence?.approval?[evidence.approval]:Object.values(evidence?.pairedApprovals || evidence?.pairedMediaApprovals || {});
  for(const approval of approvals){
    const snapshot=approval.snapshot,url=snapshot.output_url || snapshot.source_url;
    const matching=media.filter(asset=>snapshot.drive_file_id?asset.drive_file_id===snapshot.drive_file_id:asset.url===url);
    if(!matching.length || matching.some(asset=>snapshot.drive_file_id?asset.drive_md5!==snapshot.evidence?.drive_md5:asset.sha256!==snapshot.evidence?.sha256))
      throw Object.assign(new Error('Media content changed since output approval. Review and approve this revision before launching.'),{statusCode:409});
  }
}
