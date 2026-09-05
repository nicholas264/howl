import { ensureCreativeAssetTables, backfillCreativeAssetsFromLaunchHistory } from '../creative-assets.js';
import { enqueueCreativeAnalyses } from '../creative-analysis-queue.js';
import { claimSync, checkpointSync, releaseSync, withoutAccessToken, withAccessToken } from '../sync-state.js';

export async function syncCreativeAnalytics({ sql, accessToken, adAccountId, sinceDays = 30, force = false, fetch = globalThis.fetch }) {
  const BASE = 'https://graph.facebook.com/v21.0';
  sinceDays = Math.max(1, Math.min(365, Number.parseInt(sinceDays, 10) || 30));
  const today = new Date();
  const job = await claimSync(sql, `meta-insights:${adAccountId}:${sinceDays}`, {
    phase: 'ads', cursor: null, adsUpserted: 0, insightsUpserted: 0,
    since: new Date(today.getTime() - sinceDays * 86400000).toISOString().slice(0,10),
    until: today.toISOString().slice(0,10),
  }, force);
  if (!job) return { ok: true, skipped: 'busy_or_recently_completed' };
  let state = job.state;
  const deadline = Date.now() + 180000;
  try {
    await ensureCreativeAssetTables(sql);
    await backfillCreativeAssetsFromLaunchHistory(sql);
        // 1) Walk /act_X/ads pages, upserting ad + creative metadata
        // Tight subfield expansion to stay under Meta's per-page byte budget.
        // object_story_spec / asset_feed_spec full payloads are large; we only
        // need the IDs / hashes that anchor a creative group.
        const creativeSubfields = [
          'id',
          'video_id',
          'image_hash',
          'thumbnail_url',
          'effective_object_story_id',
          'object_story_spec{video_data{video_id},link_data{image_hash,child_attachments{video_id,image_hash}},photo_data{image_hash}}',
          'asset_feed_spec{videos{video_id},images{hash}}',
        ].join(',');
        let adsPage = state.phase === 'ads' ? (state.cursor || `${BASE}/${adAccountId}/ads?fields=id,name,status,adset_id,campaign_id,created_time,creative{${creativeSubfields}}&limit=50`) : null;
        let adsUpserted = state.adsUpserted || 0;
        const adIds = [];
        // Resolve video_id / image_hash from any of the places Meta hides them.
        // Direct fields work for simple link ads; page-post / dynamic ads bury
        // them in object_story_spec or asset_feed_spec.
        const resolveCreativeIds = (creative) => {
          let videoId = creative.video_id || null;
          let imageHash = creative.image_hash || null;
          const oss = creative.object_story_spec || {};
          if (!videoId && oss.video_data?.video_id) videoId = oss.video_data.video_id;
          if (!imageHash && oss.link_data?.image_hash) imageHash = oss.link_data.image_hash;
          if (!imageHash && oss.photo_data?.image_hash) imageHash = oss.photo_data.image_hash;
          // Carousel: link_data.child_attachments[].video_id / image_hash — first child as the group key.
          if (!videoId && Array.isArray(oss.link_data?.child_attachments)) {
            for (const c of oss.link_data.child_attachments) {
              if (c.video_id) { videoId = c.video_id; break; }
            }
          }
          if (!imageHash && Array.isArray(oss.link_data?.child_attachments)) {
            for (const c of oss.link_data.child_attachments) {
              if (c.image_hash) { imageHash = c.image_hash; break; }
            }
          }
          // Dynamic / Advantage+ creative: asset_feed_spec.videos[] / images[]
          const afs = creative.asset_feed_spec || {};
          if (!videoId && Array.isArray(afs.videos) && afs.videos[0]?.video_id) videoId = afs.videos[0].video_id;
          if (!imageHash && Array.isArray(afs.images) && afs.images[0]?.hash) imageHash = afs.images[0].hash;
          return { videoId, imageHash };
        };

        for (let pageGuard = 0; pageGuard < 5 && adsPage; pageGuard++) {
          const r = await fetch(withAccessToken(adsPage, accessToken), { signal: AbortSignal.timeout(30000) });
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error?.message || 'Meta ads fetch failed');
          for (const ad of (d.data || [])) {
            const creative = ad.creative || {};
            const { videoId, imageHash } = resolveCreativeIds(creative);
            const groupKey = videoId || imageHash || ad.id;
            const thumb = creative.thumbnail_url || null;
            await sql`
              INSERT INTO creative_performance
                (ad_id, ad_name, adset_id, campaign_id, creative_id, video_id, image_hash, group_key, thumbnail_url, status, created_time, synced_at)
              VALUES
                (${ad.id}, ${ad.name || null}, ${ad.adset_id || null}, ${ad.campaign_id || null}, ${creative.id || null}, ${videoId}, ${imageHash}, ${groupKey}, ${thumb}, ${ad.status || null}, ${ad.created_time || null}, NOW())
              ON CONFLICT (ad_id) DO UPDATE SET
                ad_name = EXCLUDED.ad_name,
                adset_id = EXCLUDED.adset_id,
                campaign_id = EXCLUDED.campaign_id,
                creative_id = EXCLUDED.creative_id,
                video_id = EXCLUDED.video_id,
                image_hash = EXCLUDED.image_hash,
                group_key = EXCLUDED.group_key,
                thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, creative_performance.thumbnail_url),
                status = EXCLUDED.status,
                synced_at = NOW()
            `;
            await sql`
              UPDATE creative_assets SET
                ad_id = COALESCE(ad_id, ${ad.id}),
                meta_video_id = COALESCE(meta_video_id, ${videoId}),
                meta_image_hash = COALESCE(meta_image_hash, ${imageHash}),
                group_key = ${groupKey},
                updated_at = now()
              WHERE ad_id = ${ad.id}
                 OR (${videoId}::text IS NOT NULL AND meta_video_id = ${videoId})
                 OR (${imageHash}::text IS NOT NULL AND meta_image_hash = ${imageHash})
            `;
            adsUpserted++;
            adIds.push(ad.id);
          }
          adsPage = withoutAccessToken(d.paging?.next);
          state = { ...state, phase: adsPage ? 'ads' : 'insights', cursor: adsPage, adsUpserted };
          await checkpointSync(sql, job, state);
          if (Date.now() > deadline) break;
        }

        if (adsPage) return { ok: true, complete: false, ...state };
        // 2) Pull daily insights for the window. Use account-level call with time_increment=1.
        const timeRange = encodeURIComponent(JSON.stringify({ since: state.since, until: state.until }));
        const fields = [
          'ad_id', 'date_start', 'spend', 'impressions', 'clicks', 'unique_inline_link_clicks',
          'actions', 'action_values',
          'video_thruplay_watched_actions',
        ].join(',');

        const PURCHASE_TYPES = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_in_store_purchase'];
        const pickAction = (arr) => {
          if (!Array.isArray(arr)) return 0;
          for (const t of PURCHASE_TYPES) {
            const hit = arr.find(a => a.action_type === t);
            if (hit) return parseFloat(hit.value || 0);
          }
          return 0;
        };
        const pickVideoAction = (arr) => {
          if (!Array.isArray(arr) || arr.length === 0) return 0;
          // Sum across action_type variants (Meta returns a small list keyed by action_type)
          return arr.reduce((s, a) => s + (parseFloat(a.value) || 0), 0);
        };

        let insightsPage = state.cursor || `${BASE}/${adAccountId}/insights?level=ad&time_increment=1&time_range=${timeRange}&fields=${fields}&limit=200`;
        let insightsUpserted = state.insightsUpserted || 0;
        for (let pageGuard = 0; pageGuard < 5 && insightsPage; pageGuard++) {
          const r = await fetch(withAccessToken(insightsPage, accessToken), { signal: AbortSignal.timeout(30000) });
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d.error?.message || 'Meta insights fetch failed');
          // Pull a specific action_type from the actions[] array (e.g. video_view = 3-sec views).
          const pickActionType = (arr, type) => {
            if (!Array.isArray(arr)) return 0;
            const hit = arr.find(a => a.action_type === type);
            return hit ? parseFloat(hit.value || 0) : 0;
          };
          for (const row of (d.data || [])) {
            if (!row.ad_id || !row.date_start) continue;
            const purchases = pickAction(row.actions);
            const purchaseValue = pickAction(row.action_values);
            // 3-sec video views moved into actions[] under action_type 'video_view' in newer Graph versions.
            const v3s = pickActionType(row.actions, 'video_view');
            const vThru = pickVideoAction(row.video_thruplay_watched_actions);
            const vAvg = 0;
            await sql`
              INSERT INTO creative_insights_daily
                (ad_id, date, spend, impressions, clicks, unique_link_clicks, purchases, purchase_value, video_3s_views, video_thruplays, video_avg_watch, synced_at)
              VALUES
                (${row.ad_id}, ${row.date_start}, ${parseFloat(row.spend || 0)}, ${parseInt(row.impressions || 0, 10)}, ${parseInt(row.clicks || 0, 10)}, ${parseInt(row.unique_inline_link_clicks || 0, 10)}, ${purchases}, ${purchaseValue}, ${v3s}, ${vThru}, ${vAvg}, NOW())
              ON CONFLICT (ad_id, date) DO UPDATE SET
                spend = EXCLUDED.spend,
                impressions = EXCLUDED.impressions,
                clicks = EXCLUDED.clicks,
                unique_link_clicks = EXCLUDED.unique_link_clicks,
                purchases = EXCLUDED.purchases,
                purchase_value = EXCLUDED.purchase_value,
                video_3s_views = EXCLUDED.video_3s_views,
                video_thruplays = EXCLUDED.video_thruplays,
                video_avg_watch = EXCLUDED.video_avg_watch,
                synced_at = NOW()
            `;
            insightsUpserted++;
          }
          insightsPage = withoutAccessToken(d.paging?.next);
          state = { ...state, phase: insightsPage ? 'insights' : 'done', cursor: insightsPage, insightsUpserted };
          await checkpointSync(sql, job, state, !insightsPage);
          if (Date.now() > deadline) break;
        }

    const queuedForAnalysis = state.phase === 'done' ? await enqueueCreativeAnalyses(sql, 'meta_sync') : 0;
    return { ok: true, complete: state.phase === 'done', ...state, queuedForAnalysis, sinceDays };
  } catch (error) {
    await releaseSync(sql, job, error.message).catch(() => {});
    throw error;
  } finally {
    // Preserve any error recorded by the catch above.
    await sql`UPDATE app_sync_state SET lease_token = NULL, lease_until = NULL
      WHERE name = ${job.name} AND lease_token = ${job.token}`;
  }
}
