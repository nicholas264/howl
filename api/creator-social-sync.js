import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function normalizeHandle(value) {
  return (value || '').toString().trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#]/)[0];
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.body?.creator_id);
    const platform = (req.body?.platform || '').toString().toLowerCase();
    if (!creatorId || platform !== 'instagram') {
      return res.status(400).json({ error: 'Instagram creator_id and platform are required' });
    }
    const [account] = await sql`
      SELECT * FROM creator_social_accounts
      WHERE creator_id = ${creatorId} AND platform = 'instagram'
    `;
    if (!account) return res.status(404).json({ error: 'Instagram account not found on this creator' });
    const handle = normalizeHandle(account.handle || account.profile_url);
    if (!handle) return res.status(400).json({ error: 'Add an Instagram handle first' });

    const token = process.env.META_ACCESS_TOKEN;
    let instagramUserId = process.env.META_INSTAGRAM_USER_ID;
    if (!token) {
      return res.status(409).json({ error: 'Meta connection is not configured' });
    }
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
      return res.status(409).json({ error: 'The configured Facebook Page does not expose a connected Instagram professional account' });
    }
    const discoveryFields = [
      'username', 'name', 'biography', 'website', 'followers_count',
      'follows_count', 'media_count', 'profile_picture_url',
      'media.limit(25){id,like_count,comments_count,timestamp,media_type,permalink}',
    ].join(',');
    const fields = `business_discovery.username(${handle}){${discoveryFields}}`;
    const url = new URL(`https://graph.facebook.com/${version}/${instagramUserId}`);
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', token);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.error) {
      const message = data.error?.message || `Meta request failed (${response.status})`;
      return res.status(422).json({
        error: `${message}. Instagram Business Discovery only supports eligible professional accounts.`,
      });
    }
    const profile = data.business_discovery;
    if (!profile) return res.status(404).json({ error: 'Instagram profile was not discoverable' });
    const media = profile.media?.data || [];
    const interactions = media.reduce((sum, item) => sum + Number(item.like_count || 0) + Number(item.comments_count || 0), 0);
    const avgInteractions = media.length ? interactions / media.length : 0;
    const engagementRate = profile.followers_count
      ? Number(((avgInteractions / profile.followers_count) * 100).toFixed(4))
      : null;
    const metrics = {
      name: profile.name || null,
      biography: profile.biography || null,
      website: profile.website || null,
      media_count: profile.media_count || 0,
      recent_media_count: media.length,
      avg_interactions: Number(avgInteractions.toFixed(2)),
      recent_media: media,
      provider: 'instagram_business_discovery',
    };

    await sql`
      UPDATE creator_social_accounts SET
        handle = ${profile.username || handle},
        profile_url = ${`https://www.instagram.com/${profile.username || handle}/`},
        followers = ${profile.followers_count ?? null},
        following = ${profile.follows_count ?? null},
        engagement_rate = ${engagementRate},
        metrics = ${JSON.stringify(metrics)}::jsonb,
        last_synced_at = now(),
        updated_at = now()
      WHERE id = ${account.id}
    `;
    await sql`
      UPDATE creators
      SET avatar_url = COALESCE(${profile.profile_picture_url || null}, avatar_url), updated_at = now()
      WHERE id = ${creatorId}
    `;
    await sql`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      VALUES (
        ${creatorId}, 'social_sync', 'Instagram metrics refreshed',
        ${JSON.stringify({ platform: 'instagram', followers: profile.followers_count, engagement_rate: engagementRate })}::jsonb,
        ${access.userId}
      )
    `;
    return res.json({
      ok: true,
      followers: profile.followers_count,
      engagement_rate: engagementRate,
      last_synced_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
