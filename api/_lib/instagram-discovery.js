export function normalizeInstagramHandle(value) {
  const handle = (value || '').toString().trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .split(/[/?#]/)[0];
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : '';
}

export async function discoverInstagramProfile(handleValue) {
  const handle = normalizeInstagramHandle(handleValue);
  if (!handle) throw new Error('Instagram handle required');
  const token = process.env.META_ACCESS_TOKEN;
  let instagramUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!token) throw new Error('Meta connection is not configured');
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!instagramUserId && process.env.META_PAGE_ID) {
    const pageUrl = new URL(`https://graph.facebook.com/${version}/${process.env.META_PAGE_ID}`);
    pageUrl.searchParams.set('fields', 'instagram_business_account');
    pageUrl.searchParams.set('access_token', token);
    const pageResponse = await fetch(pageUrl);
    const pageData = await pageResponse.json();
    instagramUserId = pageData.instagram_business_account?.id || null;
  }
  if (!instagramUserId) {
    throw new Error('The configured Facebook Page does not expose a connected Instagram professional account');
  }

  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(25){id,like_count,comments_count,timestamp,media_type,permalink}}`;
  const url = new URL(`https://graph.facebook.com/${version}/${instagramUserId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`${data.error?.message || `Meta request failed (${response.status})`}. Instagram discovery supports eligible professional accounts.`);
  }
  const profile = data.business_discovery;
  if (!profile) throw new Error('Instagram profile was not discoverable');
  const media = profile.media?.data || [];
  const interactions = media.reduce(
    (sum, item) => sum + Number(item.like_count || 0) + Number(item.comments_count || 0),
    0,
  );
  const avgInteractions = media.length ? interactions / media.length : 0;
  const engagementRate = profile.followers_count
    ? Number(((avgInteractions / profile.followers_count) * 100).toFixed(4))
    : null;

  return {
    platform: 'instagram',
    handle: profile.username || handle,
    profile_url: `https://www.instagram.com/${profile.username || handle}/`,
    followers: profile.followers_count ?? null,
    following: profile.follows_count ?? null,
    engagement_rate: engagementRate,
    avatar_url: profile.profile_picture_url || null,
    name: profile.name || null,
    biography: profile.biography || null,
    website: profile.website || null,
    metrics: {
      media_count: profile.media_count || 0,
      recent_media_count: media.length,
      avg_interactions: Number(avgInteractions.toFixed(2)),
      recent_media: media,
      provider: 'instagram_business_discovery',
    },
  };
}
