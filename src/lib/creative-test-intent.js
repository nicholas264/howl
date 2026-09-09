// Shared, secret-free settings used before uploads and provider campaign writes.
export function creativeTestIntent(input) {
  const positiveInteger = (value, label) => {
    if (!/^[0-9]+$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`${label} must be a positive whole number.`);
    return String(Number(value));
  };
  const dollars = String(input.dailyBudgetDollars ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(dollars)) throw new Error('Daily budget must be a positive dollar amount with at most two decimal places.');
  const dailyBudget = positiveInteger(Math.round(Number(dollars) * 100), 'Daily budget');
  const bidAmount = positiveInteger(input.costCapCents, 'Cost cap in cents');
  const providerId = (value, label) => {
    const id = String(value ?? '').trim();
    if (!/^[1-9][0-9]*$/.test(id)) throw new Error(`${label} must contain digits only.`);
    return id;
  };
  const pixelId = providerId(input.pixelId, 'Pixel ID');
  providerId(input.pageId, 'Facebook Page ID');
  let destination;
  try { destination = new URL(input.destUrl); } catch { throw new Error('Enter a valid HTTPS destination URL.'); }
  if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error('Enter a valid HTTPS destination URL.');
  const exclusion = input.excludeAudienceId ? providerId(input.excludeAudienceId, 'Excluded audience ID') : null;
  return {
    campaign: {name: String(input.testName || '').trim() || `[CT] HOWL — ${new Date().toLocaleDateString('en-US', {month:'short',day:'numeric'})}`, objective:'OUTCOME_SALES',status:'PAUSED',special_ad_categories:[],is_adset_budget_sharing_enabled:false},
    adset: {daily_budget:dailyBudget,billing_event:'IMPRESSIONS',optimization_goal:'OFFSITE_CONVERSIONS',bid_strategy:'COST_CAP',bid_amount:bidAmount,status:'PAUSED',
      targeting:{geo_locations:{countries:['US']},age_min:18,age_max:65,...(exclusion?{exclusions:{custom_audiences:[{id:exclusion}]}}:{})},
      promoted_object:{pixel_id:pixelId,custom_event_type:'PURCHASE'}}
  };
}

export function validateCreativeTestAssets(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('No creatives provided.');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('Invalid creative.');
    if (!item.id || ids.has(String(item.id))) throw new Error('Each creative requires a unique item ID.');
    ids.add(String(item.id));
    if (item.storyUrl) throw new Error('Use the Launcher for paired feed and story assets.');
    if (item.type === 'carousel') {
      if (!Array.isArray(item.cardHashes) || item.cardHashes.length < 2 || item.cardHashes.length > 10 || item.cardHashes.some(hash => typeof hash !== 'string' || !hash.trim())) throw new Error('A carousel requires two to ten uploaded images.');
    } else if (item.type === 'video') {
      if (!item.videoId) throw new Error('Upload the video before creating the test.');
    } else if (!item.imageHash) throw new Error('Upload the image before creating the test.');
  }
}
