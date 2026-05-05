// Best-effort launch logger — swallows errors so a DB outage doesn't break Meta publishes.
async function logLaunch(row) {
  try {
    if (!process.env.DATABASE_URL) return;
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO launch_history
        (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type)
      VALUES
        (${row.ad_id}, ${row.adset_id || null}, ${row.campaign_id || null}, ${row.drive_file_id || null}, ${row.drive_file_name || null}, ${row.creator || null}, ${row.product_id || null}, ${row.angle_id || null}, ${row.ad_name || null}, ${row.headline || null}, ${row.primary_text || null}, ${row.dest_url || null}, ${row.mime_type || null})
    `;
  } catch (err) {
    console.error('launch_history insert failed:', err.message);
  }
}

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
  return d.id;
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

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
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
        });
        return res.json({ success: true, adId: d.id });
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
          const videoId = await uploadVideo(videoBase64, name, adAccountId, accessToken, BASE);
          return res.json({ success: true, videoId });
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

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Meta API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
