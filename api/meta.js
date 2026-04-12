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
  const defaultPageId = process.env.META_PAGE_ID || '404789730317028';

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
        const { imageBase64, squareImageBase64, storyImageBase64, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        const squareBase64 = squareImageBase64 || imageBase64;
        const storyBase64  = storyImageBase64 || null;

        // 1. Upload image(s)
        let squareHash, storyHash;
        try {
          squareHash = await uploadImage(squareBase64, adAccountId, accessToken, BASE);
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_square' });
        }
        if (storyBase64) {
          try {
            storyHash = await uploadImage(storyBase64, adAccountId, accessToken, BASE);
          } catch (err) {
            return res.status(400).json({ error: err.message, step: 'upload_story' });
          }
        }

        // 2. Create ad creative
        let creativeParams;
        if (storyHash) {
          // Multi-placement: 1:1 → Feed, 9:16 → Stories/Reels
          const bodyLabel    = { name: 'copy' };
          const titleLabel   = { name: 'copy' };
          const linkLabel    = { name: 'copy' };
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            asset_feed_spec: JSON.stringify({
              ad_formats: ['SINGLE_IMAGE'],
              images: [
                { hash: squareHash, adlabels: [{ name: 'square' }] },
                { hash: storyHash,  adlabels: [{ name: 'story'  }] },
              ],
              bodies:    [{ text: primaryText || headline, adlabels: [bodyLabel]  }],
              titles:    [{ text: headline,                adlabels: [titleLabel] }],
              link_urls: [{ website_url: destUrl,          adlabels: [linkLabel]  }],
              call_to_action_types: ['SHOP_NOW'],
              asset_customization_rules: [
                {
                  customization_spec: {
                    publisher_platforms: ['facebook', 'instagram'],
                    facebook_positions: ['feed'],
                    instagram_positions: ['stream'],
                  },
                  image_label:    { name: 'square' },
                  body_label:     bodyLabel,
                  title_label:    titleLabel,
                  link_url_label: linkLabel,
                },
                {
                  customization_spec: {
                    publisher_platforms: ['facebook', 'instagram'],
                    facebook_positions: ['story', 'facebook_reels'],
                    instagram_positions: ['story', 'reels'],
                  },
                  image_label:    { name: 'story' },
                  body_label:     bodyLabel,
                  title_label:    titleLabel,
                  link_url_label: linkLabel,
                },
              ],
            }),
            access_token: accessToken,
          });
        } else {
          // Single image fallback
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              link_data: {
                image_hash: squareHash,
                link: destUrl,
                message: primaryText || headline,
                name: headline,
                call_to_action: { type: 'SHOP_NOW' },
              },
            }),
            access_token: accessToken,
          });
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
