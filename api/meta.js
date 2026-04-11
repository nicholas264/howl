export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  const adAccountId = `act_${rawId}`;

  if (!accessToken || !rawId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID not configured' });
  }

  const BASE = 'https://graph.facebook.com/v21.0';
  const { action } = req.body;

  try {
    switch (action) {

      case 'list_campaigns': {
        const r = await fetch(
          `${BASE}/${adAccountId}/campaigns?fields=id,name,status,objective&limit=100&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'list_adsets': {
        const { campaign_id } = req.body;
        const r = await fetch(
          `${BASE}/${adAccountId}/adsets?campaign_id=${campaign_id}&fields=id,name,status&limit=100&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_campaign': {
        const { name, objective } = req.body;
        const params = new URLSearchParams({
          name,
          objective,
          status: 'PAUSED',
          special_ad_categories: '[]',
          access_token: accessToken,
        });
        const r = await fetch(`${BASE}/${adAccountId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
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
          status: 'PAUSED',
          targeting: JSON.stringify({
            geo_locations: { countries: ['US'] },
            age_min: 18,
            age_max: 65,
          }),
          access_token: accessToken,
        };

        if (objective === 'OUTCOME_SALES' && pixel_id) {
          adsetBody.optimization_goal = 'OFFSITE_CONVERSIONS';
          adsetBody.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
          adsetBody.promoted_object = JSON.stringify({
            pixel_id,
            custom_event_type: 'PURCHASE',
          });
        } else if (objective === 'OUTCOME_TRAFFIC') {
          adsetBody.optimization_goal = 'LINK_CLICKS';
          adsetBody.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
        } else {
          adsetBody.optimization_goal = 'REACH';
          adsetBody.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
        }

        const params = new URLSearchParams(adsetBody);
        const r = await fetch(`${BASE}/${adAccountId}/adsets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'push_ad': {
        const { imageBase64, adName, headline, primaryText, destUrl, pageId, adsetId } = req.body;

        // 1. Upload image
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imgParams = new URLSearchParams({
          bytes: cleanBase64,
          name: `howl-${Date.now()}.jpg`,
          access_token: accessToken,
        });
        const imgRes = await fetch(`${BASE}/${adAccountId}/adimages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: imgParams,
        });
        const imgData = await imgRes.json();

        if (imgData.error) {
          return res.status(400).json({ error: imgData.error.message, step: 'upload_image' });
        }

        const imageHash = Object.values(imgData.images || {})[0]?.hash;
        if (!imageHash) {
          return res.status(400).json({ error: 'Image upload returned no hash', step: 'upload_image' });
        }

        // 2. Create ad creative
        const creativeParams = new URLSearchParams({
          name: `${adName} Creative`,
          object_story_spec: JSON.stringify({
            page_id: pageId,
            link_data: {
              image_hash: imageHash,
              link: destUrl,
              message: primaryText,
              name: headline,
              call_to_action: { type: 'SHOP_NOW' },
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
          return res.status(400).json({ error: creativeData.error.message, step: 'create_creative' });
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

        return res.json({ success: true, adId: adData.id });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Meta API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
