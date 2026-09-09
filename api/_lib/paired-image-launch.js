// The approval map comes from server preflight. Source URLs and provider IDs are
// resolved again from the upload registry; no client-provided attribution is used.
export async function recordPairedImageLaunch(sql,{adId,adName,images,pairedApprovals,creator,sourceLabel}) {
  const account=`act_${(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/,'')}`;
  for(const role of ['feed','story']){
    const approval=pairedApprovals?.[role],providerId=images[role];
    if(!approval || !providerId)throw new Error('Paired image approval mapping is missing');
    const [media]=await sql`SELECT source_url,content_hash FROM provider_media WHERE account_id=${account} AND kind='image' AND provider_id=${providerId}`;
    if(!media || media.content_hash!==approval.snapshot.evidence?.sha256 || media.source_url!==(approval.snapshot.output_url || approval.snapshot.source_url))
      throw new Error('Paired image upload receipt no longer matches its approved output.');
    const [asset]=await sql`INSERT INTO creative_assets(drive_file_name,mime_type,durable_url,playable_url,playback_status,
      ad_id,meta_image_hash,creator,creator_id,source_type,source_label,brief_id,deliverable_id,placement_role,group_key,launch_receipt_key)
      VALUES (${adName},'image',${media.source_url},${media.source_url},'ready',${adId},${providerId},${creator || null},${approval.creator_id},
        'external_creator',${sourceLabel || null},${approval.snapshot.brief_id},${approval.deliverable_id},${role},${providerId},${`meta:${adId}:${role}`})
      ON CONFLICT(launch_receipt_key) DO UPDATE SET launch_receipt_key=EXCLUDED.launch_receipt_key RETURNING id`;
    const [updated]=await sql`UPDATE creator_deliverables SET status='launched',creative_asset_id=${asset.id},
      completed_asset_count=GREATEST(completed_asset_count,1),shipped_asset_count=GREATEST(shipped_asset_count,1),
      completed_at=COALESCE(completed_at,now()),shipped_at=COALESCE(shipped_at,now()),updated_at=now()
      WHERE id=${approval.deliverable_id} AND creator_id=${approval.creator_id} AND approval_id=${approval.id} RETURNING id`;
    if(!updated)throw new Error('Paired deliverable changed after dispatch; reconcile the recorded ad before updating progress.');
    await sql`UPDATE flow_cards SET stage='analyze',ad_id=${adId},group_key=${providerId},updated_at=now()
      WHERE NOT archived AND deliverable_id=${approval.deliverable_id}`;
  }
}
