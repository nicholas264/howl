import { mirrorVideoToBlob } from './_lib/blob/mirror.js';

// Best-effort launch logger — swallows errors so a DB outage doesn't break Meta publishes.
async function logLaunch(row) {
  try {
    if (!process.env.DATABASE_URL) return;
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO launch_history
        (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type, launched_by_user_id, launched_by_email, source_video_url)
      VALUES
        (${row.ad_id}, ${row.adset_id || null}, ${row.campaign_id || null}, ${row.drive_file_id || null}, ${row.drive_file_name || null}, ${row.creator || null}, ${row.product_id || null}, ${row.angle_id || null}, ${row.ad_name || null}, ${row.headline || null}, ${row.primary_text || null}, ${row.dest_url || null}, ${row.mime_type || null}, ${row.launched_by_user_id || null}, ${row.launched_by_email || null}, ${row.source_video_url || null})
    `;
  } catch (err) {
    console.error('launch_history insert failed:', err.message);
  }
}

// Returns { videoId, blobUrl } — blobUrl is best-effort and may be null.
async function uploadVideo(base64, name, adAccountId, accessToken, BASE) {
  const clean = base64.replace(/^data:video\/\w+;base64,/, '');
  const videoBuffer = Buffer.from(clean, 'base64');
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('title', name || `howl-video-${Date.now()}`);
  form.append('source', new Blob([videoBuffer], { type: 'video/mp4' }), 'video.mp4');
  const r = await fetch(`${BASE}/${adAccountId}/advideos`, { method: 'POST', body: form });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  if (!d.id) throw new Error('Video upload returned no ID');
  const blobUrl = await mirrorVideoToBlob(videoBuffer, 'video/mp4', name || 'howl-video');
  return { videoId: d.id, blobUrl };
}

async function uploadImage(base64, adAccountId, accessToken, BASE) {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const params = new URLSearchParams({
    bytes: clean,
    name: `howl-${Date.now()}.jpg`,
    access_token: accessToken,
  });
  const r = await fetch(`${BASE}/${adAccountId}/adimages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const hash = Object.values(d.images || {})[0]?.hash;
  if (!hash) throw new Error('Image upload returned no hash');
  return hash;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

import { requireAuth } from './_lib/auth.js';
import {
  analyzeCreativeGroup,
  getCreativeAnalysis,
  listAnalyzedWinners,
} from './_lib/meta/creative-analysis.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const actor = { launched_by_user_id: auth.userId, launched_by_email: auth.email };
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  const adAccountId = `act_${rawId}`;
  const defaultPageId = process.env.META_PAGE_ID;

  if (!accessToken || !rawId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID not configured' });
  }

  const BASE = 'https://graph.facebook.com/v21.0';
  const { action } = req.body;

  try {
    switch (action) {

      case 'get_tool_roi': {
        // Pulls all ads in launch_history within `sinceDays` (default 90), queries Meta
        // Insights once per chunk (500 ad_ids per call), aggregates spend/revenue/ROAS.
        if (!process.env.DATABASE_URL) {
          return res.json({ error: 'DATABASE_URL not configured' });
        }
        const sinceDays = parseInt(req.body.sinceDays || 90, 10);
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        const launches = await sql`
          SELECT ad_id, creator, mime_type, ad_name, launched_at
          FROM launch_history
          WHERE ad_id IS NOT NULL
            AND launched_at >= NOW() - (${sinceDays} || ' days')::interval
        `;

        if (launches.length === 0) {
          return res.json({ totals: { spend: 0, revenue: 0, purchases: 0, roas: 0, adsLaunched: 0 }, byMimeType: [], byCreator: [], sinceDays });
        }

        // Build lookup so we can attribute insights back to mime_type / creator
        const launchById = new Map();
        for (const l of launches) launchById.set(l.ad_id, l);
        const adIds = [...launchById.keys()];

        // Fetch Meta insights — single call per chunk of 500 ad IDs
        const PURCHASE_TYPES = new Set([
          'omni_purchase',
          'offsite_conversion.fb_pixel_purchase',
          'purchase',
          'web_in_store_purchase',
        ]);
        const pickPurchaseValue = (arr) => {
          if (!Array.isArray(arr)) return 0;
          // Prefer omni_purchase (deduped), fall back through preference order
          const preference = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_in_store_purchase'];
          for (const t of preference) {
            const hit = arr.find(a => a.action_type === t);
            if (hit) return parseFloat(hit.value || 0);
          }
          return 0;
        };
        const pickPurchaseCount = (arr) => {
          if (!Array.isArray(arr)) return 0;
          const preference = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_in_store_purchase'];
          for (const t of preference) {
            const hit = arr.find(a => a.action_type === t);
            if (hit) return parseFloat(hit.value || 0);
          }
          return 0;
        };

        const CHUNK = 500;
        const insightsRows = [];
        for (let i = 0; i < adIds.length; i += CHUNK) {
          const chunk = adIds.slice(i, i + CHUNK);
          const filtering = encodeURIComponent(JSON.stringify([
            { field: 'ad.id', operator: 'IN', value: chunk },
          ]));
          // Use a date_preset that matches sinceDays as closely as possible; fall back to
          // an explicit time_range for arbitrary windows.
          const tsNow = new Date();
          const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
          const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const timeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(tsSince), until: fmtYmd(tsNow) }));

          const url = `${BASE}/${adAccountId}/insights?level=ad&fields=ad_id,spend,actions,action_values&filtering=${filtering}&time_range=${timeRange}&limit=500&access_token=${accessToken}`;
          const r = await fetch(url);
          const d = await r.json();
          if (d.error) {
            return res.status(400).json({ error: d.error.message, step: 'meta_insights' });
          }
          if (Array.isArray(d.data)) insightsRows.push(...d.data);
        }

        const totals = { spend: 0, revenue: 0, purchases: 0, roas: 0, adsLaunched: launches.length };
        const mimeAgg = {};
        const creatorAgg = {};

        for (const row of insightsRows) {
          const launch = launchById.get(row.ad_id);
          if (!launch) continue;
          const spend = parseFloat(row.spend || 0);
          const revenue = pickPurchaseValue(row.action_values);
          const purchases = pickPurchaseCount(row.actions);

          totals.spend += spend;
          totals.revenue += revenue;
          totals.purchases += purchases;

          const mt = launch.mime_type || 'unknown';
          if (!mimeAgg[mt]) mimeAgg[mt] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          mimeAgg[mt].spend += spend;
          mimeAgg[mt].revenue += revenue;
          mimeAgg[mt].purchases += purchases;

          const cr = launch.creator || 'Unknown';
          if (!creatorAgg[cr]) creatorAgg[cr] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          creatorAgg[cr].spend += spend;
          creatorAgg[cr].revenue += revenue;
          creatorAgg[cr].purchases += purchases;
        }

        // Count ads per mime_type/creator from launch_history (not insights — captures
        // ads that ran but had zero spend/insights)
        for (const l of launches) {
          const mt = l.mime_type || 'unknown';
          const cr = l.creator || 'Unknown';
          if (!mimeAgg[mt]) mimeAgg[mt] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          mimeAgg[mt].ads += 1;
          if (!creatorAgg[cr]) creatorAgg[cr] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          creatorAgg[cr].ads += 1;
        }

        totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
        const byMimeType = Object.entries(mimeAgg).map(([k, v]) => ({ mimeType: k, ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0 })).sort((a, b) => b.revenue - a.revenue);
        const byCreator = Object.entries(creatorAgg).map(([k, v]) => ({ creator: k, ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0 })).sort((a, b) => b.revenue - a.revenue);

        return res.json({ totals, byMimeType, byCreator, sinceDays, _meta: { adsWithInsights: insightsRows.length, metaCalls: Math.ceil(adIds.length / CHUNK) } });
      }

      case 'get_dashboard': {
        const sinceTs = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365; // 1 year ago
        const filtering = encodeURIComponent(JSON.stringify([{ field: 'created_time', operator: 'GREATER_THAN', value: sinceTs }]));
        const activeFilter = encodeURIComponent(JSON.stringify([
          { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
        ]));

        // Monthly insights time series — 13 months back to first of that month
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getFullYear(), tsNow.getMonth() - 12, 1);
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const monthlyTimeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(tsSince), until: fmtYmd(tsNow) }));

        const [adsRes, insightsRes, monthlyInsightsRes, adsetsRes, campaignsRes, creativesRes] = await Promise.all([
          fetch(`${BASE}/${adAccountId}/ads?fields=id,name,created_time,status,effective_status,creative{id,object_type}&limit=500&filtering=${filtering}&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,impressions,clicks,ctr,reach,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,impressions,clicks,actions,cost_per_action_type,purchase_roas&time_range=${monthlyTimeRange}&time_increment=monthly&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/adsets?fields=id,name,daily_budget,lifetime_budget,budget_remaining,campaign_id,effective_status,bid_strategy,bid_amount&filtering=${activeFilter}&limit=200&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,budget_remaining,bid_strategy&filtering=${activeFilter}&limit=100&access_token=${accessToken}`),
          // Fetch creatives directly to get actual asset identifiers
          fetch(`${BASE}/${adAccountId}/adcreatives?fields=id,image_hash,video_id,object_type&limit=500&access_token=${accessToken}`),
        ]);
        const [adsData, insightsData, monthlyInsightsData, adsetsData, campaignsData, creativesData] = await Promise.all([adsRes.json(), insightsRes.json(), monthlyInsightsRes.json(), adsetsRes.json(), campaignsRes.json(), creativesRes.json()]);

        if (adsData.error) throw new Error(adsData.error.message);

        // Build creative ID → asset key lookup
        const creativeAssets = {};
        for (const c of (creativesData.data || [])) {
          creativeAssets[c.id] = {
            image_hash: c.image_hash || null,
            video_id: c.video_id || null,
            object_type: c.object_type || null,
          };
        }

        // Build campaign ID → name + budget lookup
        const campaignNames = {};
        const campaignBudgetData = {};
        for (const c of (campaignsData.data || [])) {
          campaignNames[c.id] = c.name;
          campaignBudgetData[c.id] = {
            daily_budget: c.daily_budget || null,
            lifetime_budget: c.lifetime_budget || null,
            budget_remaining: c.budget_remaining || null,
            bid_strategy: c.bid_strategy || null,
          };
        }

        // Reduce monthly insights to {month: 'YYYY-MM', spend, purchases, roas, ...}
        const monthlyInsightsError = monthlyInsightsData?.error?.message || null;
        const monthlyInsights = (monthlyInsightsData.data || []).map(row => {
          const month = (row.date_start || '').slice(0, 7);
          const purchases = parseInt(((row.actions || []).find(a => a.action_type === 'purchase')?.value) || 0);
          const cpaRaw = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value;
          const roasRaw = (row.purchase_roas || []).find(a => a.action_type === 'omni_purchase' || a.action_type === 'purchase')?.value;
          return {
            month,
            spend: parseFloat(row.spend || 0),
            impressions: parseInt(row.impressions || 0),
            clicks: parseInt(row.clicks || 0),
            purchases,
            cpa: cpaRaw ? parseFloat(cpaRaw) : null,
            roas: roasRaw ? parseFloat(roasRaw) : null,
          };
        });

        return res.json({
          ads: adsData.data || [],
          insights: insightsData.data?.[0] || null,
          monthlyInsights,
          monthlyInsightsError,
          activeAdsets: adsetsData.data || [],
          campaignNames,
          campaignBudgetData,
          creativeAssets,
        });
      }

      case 'list_campaigns': {
        const activeFilter = encodeURIComponent(JSON.stringify([
          { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
        ]));
        const r = await fetch(
          `${BASE}/${adAccountId}/campaigns?fields=id,name,status,effective_status,objective&filtering=${activeFilter}&limit=200&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'list_adsets': {
        const { campaign_id } = req.body;
        // Fetch from the campaign's own adsets edge so the list is scoped to it.
        const r = await fetch(
          `${BASE}/${campaign_id}/adsets?fields=id,name,status,effective_status&limit=200&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_campaign': {
        const { name, objective } = req.body;
        const r = await fetch(`${BASE}/${adAccountId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            objective,
            status: 'PAUSED',
            special_ad_categories: [],
            is_adset_budget_sharing_enabled: false,
            access_token: accessToken,
          }),
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_adset': {
        const { name, campaign_id, daily_budget_dollars, objective, pixel_id } = req.body;
        const dailyBudgetCents = Math.round(parseFloat(daily_budget_dollars || '10') * 100);

        const adsetBody = {
          name,
          campaign_id,
          daily_budget: String(dailyBudgetCents),
          billing_event: 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          status: 'PAUSED',
          targeting: {
            geo_locations: { countries: ['US'] },
            age_min: 18,
            age_max: 65,
          },
          access_token: accessToken,
        };

        if (objective === 'OUTCOME_SALES' && pixel_id) {
          adsetBody.optimization_goal = 'OFFSITE_CONVERSIONS';
          adsetBody.promoted_object = {
            pixel_id,
            custom_event_type: 'PURCHASE',
          };
        } else if (objective === 'OUTCOME_TRAFFIC') {
          adsetBody.optimization_goal = 'LINK_CLICKS';
        } else {
          adsetBody.optimization_goal = 'REACH';
        }

        const r = await fetch(`${BASE}/${adAccountId}/adsets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adsetBody),
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_creative': {
        // Build + create the ad creative. Supports image, video, and carousel.
        // Returns { creativeId } so the client can call create_ad_from_creative next.
        const { imageHash, videoId: preUploadedVideoId, cards, adName, headline, primaryText, destUrl } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        let creativeParams;
        if (cards && cards.length >= 2) {
          const childAttachments = cards.map(card => ({
            link: card.destUrl || destUrl,
            image_hash: card.imageHash,
            name: card.headline || headline || '',
            description: card.body || '',
            call_to_action: { type: 'SHOP_NOW' },
          }));
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              link_data: {
                link: destUrl,
                message: primaryText || headline,
                child_attachments: childAttachments,
                multi_share_optimized: false,
              },
            }),
            access_token: accessToken,
          });
        } else if (preUploadedVideoId) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              video_data: {
                video_id: preUploadedVideoId,
                message: primaryText || headline,
                title: headline,
                call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
              },
            }),
            access_token: accessToken,
          });
        } else if (imageHash) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              link_data: {
                image_hash: imageHash,
                link: destUrl,
                message: primaryText || headline,
                name: headline,
                call_to_action: { type: 'SHOP_NOW' },
              },
            }),
            access_token: accessToken,
          });
        } else {
          return res.status(400).json({ error: 'No imageHash, videoId, or cards provided', step: 'create_creative' });
        }

        const r = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const d = await r.json();
        if (d.error) {
          return res.status(400).json({ error: d.error.error_user_msg || d.error.message, detail: d.error, step: 'create_creative' });
        }
        return res.json({ success: true, creativeId: d.id });
      }

      case 'create_ad_from_creative': {
        const { creativeId, adName, adsetId, headline, primaryText, destUrl, mimeType } = req.body;
        if (!creativeId || !adsetId) {
          return res.status(400).json({ error: 'creativeId and adsetId required', step: 'create_ad' });
        }
        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const r = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const d = await r.json();
        if (d.error) {
          return res.status(400).json({ error: d.error.message, step: 'create_ad' });
        }
        await logLaunch({
          ad_id: d.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: mimeType || 'image',
          creator: req.body.creator || 'Static Builder',
          source_video_url: req.body.sourceVideoUrl || null,
          ...actor,
        });
        return res.json({ success: true, adId: d.id });
      }

      case 'create_paired_image_ad': {
        const { feedImageHash, storyImageHash, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;
        const instagramUserId = (req.body.instagramUserId || '').trim() || undefined;
        if (!feedImageHash || !storyImageHash) return res.status(400).json({ error: 'feedImageHash and storyImageHash required', step: 'validate' });
        if (!adsetId || !pageId || !destUrl || !adName) return res.status(400).json({ error: 'Missing required fields', step: 'validate' });

        const assetFeedSpec = {
          images: [
            { hash: feedImageHash, adlabels: [{ name: 'image_feed' }] },
            { hash: storyImageHash, adlabels: [{ name: 'image_story' }] },
          ],
          bodies: [{ text: primaryText || headline || '' }],
          titles: [{ text: headline || '' }],
          link_urls: [{ website_url: destUrl }],
          call_to_action_types: ['SHOP_NOW'],
          ad_formats: ['SINGLE_IMAGE'],
          asset_customization_rules: [
            {
              customization_spec: {
                publisher_platforms: ['facebook', 'instagram'],
                facebook_positions: ['feed', 'marketplace'],
                instagram_positions: ['stream', 'explore'],
              },
              image_label: { name: 'image_feed' },
            },
            {
              customization_spec: {
                publisher_platforms: ['facebook', 'instagram'],
                facebook_positions: ['story', 'facebook_reels'],
                instagram_positions: ['story', 'reels'],
              },
              image_label: { name: 'image_story' },
            },
          ],
        };

        const creativeParams = new URLSearchParams({
          name: `${adName} Creative`,
          object_story_spec: JSON.stringify({
            page_id: pageId,
            ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
          }),
          asset_feed_spec: JSON.stringify(assetFeedSpec),
          access_token: accessToken,
        });
        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: creativeParams,
        });
        const creativeData = await creativeRes.json();
        if (creativeData.error) {
          return res.status(400).json({ error: creativeData.error.error_user_msg || creativeData.error.message, detail: creativeData.error, step: 'create_creative' });
        }

        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: adParams,
        });
        const adData = await adRes.json();
        if (adData.error) return res.status(400).json({ error: adData.error.message, step: 'create_ad' });

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: 'image (paired)',
          creator: req.body.creator || 'Static Builder',
          ...actor,
        });

        return res.json({ success: true, adId: adData.id, creativeId: creativeData.id });
      }

      case 'push_ad': {
        const { imageHash, videoId: preUploadedVideoId, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        let creativeParams;

        if (preUploadedVideoId) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              video_data: {
                video_id: preUploadedVideoId,
                message: primaryText || headline,
                title: headline,
                call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
              },
            }),
            access_token: accessToken,
          });
        } else if (imageHash) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              link_data: {
                image_hash: imageHash,
                link: destUrl,
                message: primaryText || headline,
                name: headline,
                call_to_action: { type: 'SHOP_NOW' },
              },
            }),
            access_token: accessToken,
          });
        } else {
          return res.status(400).json({ error: 'No imageHash or videoId provided. Upload asset first.', step: 'validate' });
        }

        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const creativeData = await creativeRes.json();

        if (creativeData.error) {
          // Return full error detail for debugging
          return res.status(400).json({
            error: creativeData.error.error_user_msg || creativeData.error.message,
            detail: creativeData.error,
            step: 'create_creative',
          });
        }

        // 3. Create ad (PAUSED — review before going live)
        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const adData = await adRes.json();

        if (adData.error) {
          return res.status(400).json({ error: adData.error.message, step: 'create_ad' });
        }

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: preUploadedVideoId ? 'video/mp4' : 'image',
          creator: req.body.creator || 'Static Builder',
          source_video_url: req.body.sourceVideoUrl || null,
          ...actor,
        });

        return res.json({ success: true, adId: adData.id });
      }

      case 'push_carousel': {
        const { cards, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        if (!cards || cards.length < 2) {
          return res.status(400).json({ error: 'Carousel requires at least 2 cards', step: 'validate' });
        }

        // Cards come with pre-uploaded imageHash (no base64)
        const childAttachments = cards.map(card => ({
          link: card.destUrl || destUrl,
          image_hash: card.imageHash,
          name: card.headline || headline || '',
          description: card.body || '',
          call_to_action: { type: 'SHOP_NOW' },
        }));

        const creativeParams = new URLSearchParams({
          name: `${adName} Creative`,
          object_story_spec: JSON.stringify({
            page_id: pageId,
            link_data: {
              link: destUrl,
              message: primaryText || headline,
              child_attachments: childAttachments,
              multi_share_optimized: false,
            },
          }),
          access_token: accessToken,
        });

        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const creativeData = await creativeRes.json();

        if (creativeData.error) {
          return res.status(400).json({
            error: creativeData.error.error_user_msg || creativeData.error.message,
            detail: creativeData.error,
            step: 'create_creative',
          });
        }

        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const adData = await adRes.json();

        if (adData.error) {
          return res.status(400).json({ error: adData.error.message, step: 'create_ad' });
        }

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: 'carousel',
          creator: req.body.creator || 'Static Builder',
          ...actor,
        });

        return res.json({ success: true, adId: adData.id });
      }

      case 'upload_image': {
        const { imageBase64 } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
        try {
          const hash = await uploadImage(imageBase64, adAccountId, accessToken, BASE);
          return res.json({ success: true, hash });
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_image' });
        }
      }

      case 'upload_video': {
        const { videoBase64, name } = req.body;
        if (!videoBase64) return res.status(400).json({ error: 'No video data provided' });
        try {
          const { videoId, blobUrl } = await uploadVideo(videoBase64, name, adAccountId, accessToken, BASE);
          return res.json({ success: true, videoId, sourceVideoUrl: blobUrl });
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_video' });
        }
      }

      case 'create_creative_test': {
        const { testName, dailyBudgetDollars, costCapCents, pixelId, items } = req.body;
        const pageId = req.body.pageId || defaultPageId;
        const destUrl = req.body.destUrl;

        if (!items || items.length === 0) {
          return res.status(400).json({ error: 'No creatives provided', step: 'validate' });
        }

        // 1. Create ABO campaign (PAUSED)
        const campaignBody = {
          name: testName || `[CT] HOWL — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          objective: 'OUTCOME_SALES',
          status: 'PAUSED',
          special_ad_categories: [],
          is_adset_budget_sharing_enabled: false,
          access_token: accessToken,
        };
        const campaignRes = await fetch(`${BASE}/${adAccountId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignBody),
        });
        const campaignData = await campaignRes.json();
        if (campaignData.error) {
          return res.status(400).json({ error: campaignData.error.error_user_msg || campaignData.error.message, detail: campaignData.error, step: 'create_campaign' });
        }
        const campaignId = campaignData.id;

        // 2. Create one ad set per creative, each with equal budget
        const dailyBudgetCents = String(Math.round(parseFloat(dailyBudgetDollars || '20') * 100));
        const results = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];

          // Create ad set
          const adsetBody = {
            name: `${item.name || `Creative ${i + 1}`}`,
            campaign_id: campaignId,
            daily_budget: dailyBudgetCents,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'OFFSITE_CONVERSIONS',
            bid_strategy: costCapCents ? 'COST_CAP' : 'LOWEST_COST_WITHOUT_CAP',
            ...(costCapCents ? { bid_amount: String(costCapCents) } : {}),
            status: 'PAUSED',
            targeting: {
              geo_locations: { countries: ['US'] },
              age_min: 18,
              age_max: 65,
              ...(req.body.excludeAudienceId
                ? { exclusions: { custom_audiences: [{ id: req.body.excludeAudienceId }] } }
                : {}),
            },
            access_token: accessToken,
          };

          if (pixelId) {
            adsetBody.promoted_object = {
              pixel_id: pixelId,
              custom_event_type: 'PURCHASE',
            };
          }

          const adsetRes = await fetch(`${BASE}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adsetBody),
          });
          const adsetData = await adsetRes.json();
          if (adsetData.error) {
            results.push({ item: item.name, error: adsetData.error.error_user_msg || adsetData.error.message, step: 'create_adset' });
            continue;
          }

          // Build creative using pre-uploaded asset hashes/videoIds (no base64 here)
          let creativeParams;
          try {
            if (item.type === 'carousel' && item.cardHashes) {
              const childAttachments = item.cardHashes.map((hash, ci) => ({
                link: destUrl,
                image_hash: hash,
                name: (item.cards && item.cards[ci]?.headline) || item.hook || '',
                description: (item.cards && item.cards[ci]?.body) || '',
                call_to_action: { type: 'SHOP_NOW' },
              }));
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  link_data: {
                    link: destUrl,
                    message: item.body || item.hook || '',
                    child_attachments: childAttachments,
                    multi_share_optimized: false,
                  },
                }),
                access_token: accessToken,
              });
            } else if (item.type === 'video' && item.videoId) {
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  video_data: {
                    video_id: item.videoId,
                    message: item.body || item.hook || '',
                    title: item.hook || '',
                    call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
                  },
                }),
                access_token: accessToken,
              });
            } else if (item.imageHash) {
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  link_data: {
                    image_hash: item.imageHash,
                    link: destUrl,
                    message: item.body || item.hook || '',
                    name: item.hook || '',
                    call_to_action: { type: 'SHOP_NOW' },
                  },
                }),
                access_token: accessToken,
              });
            }
          } catch (err) {
            results.push({ item: item.name, error: err.message, step: 'build_creative' });
            continue;
          }

          const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: creativeParams,
          });
          const creativeData = await creativeRes.json();
          if (creativeData.error) {
            results.push({ item: item.name, error: creativeData.error.error_user_msg || creativeData.error.message, step: 'create_creative' });
            continue;
          }

          // Create ad (PAUSED)
          const adParams = new URLSearchParams({
            name: item.name || `Creative ${i + 1}`,
            adset_id: adsetData.id,
            creative: JSON.stringify({ creative_id: creativeData.id }),
            status: 'PAUSED',
            access_token: accessToken,
          });
          const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: adParams,
          });
          const adData = await adRes.json();
          if (adData.error) {
            results.push({ item: item.name, error: adData.error.message, step: 'create_ad' });
            continue;
          }

          await logLaunch({
            ad_id: adData.id,
            adset_id: adsetData.id,
            campaign_id: campaignId,
            ad_name: item.name || `Creative ${i + 1}`,
            headline: item.hook || '',
            primary_text: item.body || '',
            dest_url: destUrl,
            angle_id: item.angle || null,
            product_id: item.product || null,
            mime_type: item.type || 'static',
            creator: item.creator || req.body.creator || 'Static Builder',
            source_video_url: item.sourceVideoUrl || null,
            ...actor,
          });

          results.push({ item: item.name, adsetId: adsetData.id, adId: adData.id, success: true });
        }

        return res.json({ success: true, campaignId, results });
      }

      case 'get_cpa_analysis': {
        // Pull conversion data across multiple time windows for cost cap recommendation
        const [insights7d, insights14d, insights30d, campaignInsights, adInsights] = await Promise.all([
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_7d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_14d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&access_token=${accessToken}`),
          // Per-campaign breakdown (last 30d, only campaigns that spent)
          fetch(`${BASE}/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&level=campaign&limit=50&access_token=${accessToken}`),
          // Top ads by spend (last 30d)
          fetch(`${BASE}/${adAccountId}/insights?fields=ad_id,ad_name,spend,actions,cost_per_action_type&date_preset=last_30d&level=ad&sort=spend_descending&limit=30&access_token=${accessToken}`),
        ]);
        const [d7, d14, d30, dCamp, dAds] = await Promise.all([
          insights7d.json(), insights14d.json(), insights30d.json(), campaignInsights.json(), adInsights.json(),
        ]);

        if (d7.error) throw new Error(d7.error.message);

        const extractCPA = (data) => {
          const row = data?.data?.[0];
          if (!row) return null;
          const spend = parseFloat(row.spend || 0);
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          const roas = (row.purchase_roas || []).find(a => a.action_type === 'omni_purchase')?.value || null;
          return { spend, purchases: parseInt(purchases), cpa: cpa ? parseFloat(cpa) : null, roas: roas ? parseFloat(roas) : null };
        };

        const campaignBreakdown = (dCamp.data || []).map(row => {
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          const roas = (row.purchase_roas || []).find(a => a.action_type === 'omni_purchase')?.value || null;
          return {
            campaign_id: row.campaign_id,
            campaign_name: row.campaign_name,
            spend: parseFloat(row.spend || 0),
            purchases: parseInt(purchases),
            cpa: cpa ? parseFloat(cpa) : null,
            roas: roas ? parseFloat(roas) : null,
          };
        }).filter(c => c.spend > 0);

        const topAds = (dAds.data || []).map(row => {
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          return {
            ad_id: row.ad_id,
            ad_name: row.ad_name,
            spend: parseFloat(row.spend || 0),
            purchases: parseInt(purchases),
            cpa: cpa ? parseFloat(cpa) : null,
          };
        }).filter(a => a.spend > 0);

        return res.json({
          last7d: extractCPA(d7),
          last14d: extractCPA(d14),
          last30d: extractCPA(d30),
          campaigns: campaignBreakdown,
          topAds,
        });
      }

      case 'sync_creative_analytics': {
        if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not configured' });
        const sinceDays = Math.max(1, Math.min(365, parseInt(req.body.sinceDays || 30, 10)));
        const force = !!req.body.force;
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        // Throttle to once / 10 min unless forced
        if (!force) {
          const [last] = await sql`SELECT MAX(synced_at) AS t FROM creative_performance`;
          if (last?.t && Date.now() - new Date(last.t).getTime() < 10 * 60 * 1000) {
            return res.json({ ok: true, skipped: 'throttled', lastSyncedAt: last.t });
          }
        }

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
        let adsPage = `${BASE}/${adAccountId}/ads?fields=id,name,status,adset_id,campaign_id,created_time,creative{${creativeSubfields}}&limit=50&access_token=${accessToken}`;
        let adsUpserted = 0;
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

        for (let pageGuard = 0; pageGuard < 50 && adsPage; pageGuard++) {
          const r = await fetch(adsPage);
          const d = await r.json();
          if (d.error) return res.status(400).json({ error: d.error.message, step: 'list_ads' });
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
            adsUpserted++;
            adIds.push(ad.id);
          }
          adsPage = d.paging?.next || null;
        }

        // 2) Pull daily insights for the window. Use account-level call with time_increment=1.
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
        const timeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(tsSince), until: fmtYmd(tsNow) }));
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

        let insightsPage = `${BASE}/${adAccountId}/insights?level=ad&time_increment=1&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${accessToken}`;
        let insightsUpserted = 0;
        for (let pageGuard = 0; pageGuard < 100 && insightsPage; pageGuard++) {
          const r = await fetch(insightsPage);
          const d = await r.json();
          if (d.error) return res.status(400).json({ error: d.error.message, step: 'insights' });
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
          insightsPage = d.paging?.next || null;
        }

        return res.json({ ok: true, adsUpserted, insightsUpserted, sinceDays });
      }

      case 'get_creative_table': {
        if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not configured' });
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        const sinceDays = Math.max(1, Math.min(365, parseInt(req.body.sinceDays || 14, 10)));
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
        const since = fmtYmd(tsSince);
        const until = fmtYmd(tsNow);

        const rows = await sql`
          WITH agg AS (
            SELECT
              cp.group_key,
              SUM(i.spend)::float           AS spend,
              SUM(i.impressions)::bigint    AS impressions,
              SUM(i.clicks)::bigint         AS clicks,
              SUM(i.unique_link_clicks)::bigint AS unique_link_clicks,
              SUM(i.purchases)::bigint      AS purchases,
              SUM(i.purchase_value)::float  AS purchase_value,
              SUM(i.video_3s_views)::bigint AS video_3s_views,
              SUM(i.video_thruplays)::bigint AS video_thruplays
            FROM creative_performance cp
            JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
            WHERE i.date BETWEEN ${since} AND ${until}
            GROUP BY cp.group_key
          ),
          meta AS (
            SELECT DISTINCT ON (cp.group_key)
              cp.group_key,
              cp.ad_name        AS name,
              cp.thumbnail_url,
              MIN(cp.created_time) OVER (PARTITION BY cp.group_key) AS first_launch_date,
              COUNT(*)          OVER (PARTITION BY cp.group_key) AS ad_count
            FROM creative_performance cp
            ORDER BY cp.group_key, cp.created_time ASC
          )
          SELECT
            m.group_key, m.name, m.thumbnail_url, m.first_launch_date, m.ad_count,
            COALESCE(a.spend, 0)              AS spend,
            COALESCE(a.purchase_value, 0)     AS purchase_value,
            COALESCE(a.purchases, 0)          AS purchases,
            COALESCE(a.impressions, 0)        AS impressions,
            COALESCE(a.clicks, 0)             AS clicks,
            COALESCE(a.unique_link_clicks, 0) AS unique_link_clicks,
            COALESCE(a.video_3s_views, 0)     AS video_3s_views,
            COALESCE(a.video_thruplays, 0)    AS video_thruplays,
            EXISTS (SELECT 1 FROM creative_analysis ca WHERE ca.group_key = m.group_key) AS is_analyzed
          FROM meta m
          LEFT JOIN agg a USING (group_key)
          WHERE COALESCE(a.spend, 0) > 0 OR COALESCE(a.impressions, 0) > 0
          ORDER BY spend DESC NULLS LAST
          LIMIT 500
        `;

        const groups = rows.map(r => {
          const spend = Number(r.spend) || 0;
          const purchaseValue = Number(r.purchase_value) || 0;
          const purchases = Number(r.purchases) || 0;
          const clicks = Number(r.clicks) || 0;
          const impressions = Number(r.impressions) || 0;
          const v3s = Number(r.video_3s_views) || 0;
          const vThru = Number(r.video_thruplays) || 0;
          return {
            groupKey: r.group_key,
            name: r.name,
            thumbnailUrl: r.thumbnail_url,
            firstLaunchDate: r.first_launch_date,
            adCount: Number(r.ad_count) || 0,
            spend,
            purchaseValue,
            purchases,
            roas: spend > 0 ? purchaseValue / spend : 0,
            cpa: purchases > 0 ? spend / purchases : null,
            cpc: clicks > 0 ? spend / clicks : null,
            ctr: impressions > 0 ? clicks / impressions : 0,
            hookRate: impressions > 0 ? v3s / impressions : 0,
            holdRate: v3s > 0 ? vThru / v3s : 0,
            impressions,
            clicks,
            isAnalyzed: !!r.is_analyzed,
          };
        });

        return res.json({ groups, sinceDays, since, until });
      }

      case 'get_creative_group_ads': {
        if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not configured' });
        const groupKey = req.body.groupKey;
        if (!groupKey) return res.status(400).json({ error: 'groupKey required' });
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        const sinceDays = Math.max(1, Math.min(365, parseInt(req.body.sinceDays || 14, 10)));
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);

        const ads = await sql`
          SELECT
            cp.ad_id, cp.ad_name, cp.thumbnail_url, cp.created_time, cp.status,
            COALESCE(SUM(i.spend), 0)::float          AS spend,
            COALESCE(SUM(i.purchase_value), 0)::float AS purchase_value,
            COALESCE(SUM(i.purchases), 0)::bigint     AS purchases,
            COALESCE(SUM(i.impressions), 0)::bigint   AS impressions,
            COALESCE(SUM(i.clicks), 0)::bigint        AS clicks
          FROM creative_performance cp
          LEFT JOIN creative_insights_daily i
            ON i.ad_id = cp.ad_id AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
          WHERE cp.group_key = ${groupKey}
          GROUP BY cp.ad_id, cp.ad_name, cp.thumbnail_url, cp.created_time, cp.status
          ORDER BY spend DESC
        `;

        return res.json({ ads });
      }

      case 'analyze_creative_group': {
        const out = await analyzeCreativeGroup({
          groupKey: req.body.groupKey,
          manualTranscript: (req.body.manualTranscript || '').trim(),
          ctx: { BASE, accessToken, adAccountId },
        });
        return res.status(out.status).json(out.body);
      }

      case 'get_creative_analysis': {
        const out = await getCreativeAnalysis({ groupKey: req.body.groupKey });
        return res.status(out.status).json(out.body);
      }

      case 'list_analyzed_winners': {
        const out = await listAnalyzedWinners({ sinceDays: req.body.sinceDays });
        return res.status(out.status).json(out.body);
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Meta API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
