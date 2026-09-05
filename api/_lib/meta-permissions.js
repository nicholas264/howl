export const META_ACTION_PERMISSIONS = Object.freeze({
  get_tool_roi: ['analytics.read'], get_dashboard: ['analytics.read'],
  list_campaigns: ['launch.read'], list_adsets: ['launch.read'],
  create_campaign: ['launch.write'], create_adset: ['launch.write'],
  create_creative: ['launch.write'], create_ad_from_creative: ['launch.write'],
  create_paired_image_ad: ['launch.write'], push_ad: ['launch.write'],
  push_carousel: ['launch.write'], upload_image: ['launch.write'],
  upload_video: ['launch.write'], upload_video_url: ['launch.write'],
  create_creative_test: ['launch.write'], get_cpa_analysis: ['analytics.read'],
  sync_creative_analytics: ['analytics.write'], get_sku_spend_pacing: ['analytics.read'],
  get_creative_table: ['analytics.read'], assign_creative_creator: ['creators.write'],
  assign_creative_creators: ['creators.write'], get_creative_operator_audit: ['analytics.read'],
  update_creative_evidence_task: ['analytics.write'], get_creative_group_ads: ['analytics.read'],
  analyze_creative_group: ['analytics.write', 'jobs.run'],
  get_creative_analysis: ['analytics.read'], list_analyzed_winners: ['analytics.read'],
  dismiss_analyzed_winner: ['analytics.write'], get_creative_analysis_queue: ['analytics.read'],
  process_creative_analysis_queue: ['jobs.run'], retry_creative_analysis_queue: ['jobs.run'],
  normalize_creative_asset: ['assets.write', 'jobs.run'],
  normalize_creative_asset_batch: ['assets.write', 'jobs.run'],
});

export function canRunMetaAction(access, action) {
  const required = Object.hasOwn(META_ACTION_PERMISSIONS, action) && META_ACTION_PERMISSIONS[action];
  return Boolean(required && required.every(permission =>
    access?.permissions?.includes('*') || access?.permissions?.includes(permission)));
}
