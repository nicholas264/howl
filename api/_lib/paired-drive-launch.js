import {markCreativeAssetLaunched} from './creative-assets.js';

// Uses server-verified approval evidence, never caller-supplied attribution.
// Each write is replay-safe; failures propagate so a known provider receipt can
// resume bookkeeping instead of reporting an unrecorded launch as successful.
export async function recordPairedDriveLaunch(sql,{adId,assets,pairedApprovals,creator,sourceLabel,productId,angleId}) {
  if(assets.length!==2 || new Set(assets.map(asset=>asset.fileId)).size!==2 || new Set(assets.map(asset=>asset.role)).size!==2 || assets.some(asset=>!['feed','story'].includes(asset.role)) || assets.some(asset=>!pairedApprovals?.[asset.fileId]))throw new Error('Two distinct verified paired assets are required');
  for(const asset of assets){
    const approval=pairedApprovals[asset.fileId];
    if(!approval)throw new Error('Paired launch approval mapping is missing');
    const groupKey=asset.videoId || asset.imageHash || adId;
    const recorded=await markCreativeAssetLaunched(sql,{driveFileId:asset.fileId,durableUrl:asset.blobUrl,
      metaVideoId:asset.videoId,metaImageHash:asset.imageHash,adId,placementRole:asset.role,groupKey,
      creator,creatorId:approval.creator_id,sourceType:'external_creator',sourceLabel,
      briefId:approval.snapshot.brief_id,deliverableId:approval.deliverable_id,productId,angleId});
    if(!recorded)throw new Error('Paired Drive asset is missing from the workspace; refresh Drive and retry bookkeeping.');
    const [updated]=await sql`UPDATE creator_deliverables SET status='launched',creative_asset_id=${recorded.id},
      completed_asset_count=GREATEST(completed_asset_count,1),shipped_asset_count=GREATEST(shipped_asset_count,1),
      completed_at=COALESCE(completed_at,now()),shipped_at=COALESCE(shipped_at,now()),updated_at=now()
      WHERE id=${approval.deliverable_id} AND creator_id=${approval.creator_id} AND approval_id=${approval.id} RETURNING id`;
    if(!updated)throw new Error('Paired deliverable changed after dispatch; reconcile the recorded ad before updating its progress.');
    await sql`UPDATE flow_cards SET stage='analyze',ad_id=${adId},group_key=COALESCE(group_key,${groupKey}),updated_at=now()
      WHERE NOT archived AND deliverable_id=${approval.deliverable_id}`;
  }
}
