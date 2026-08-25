import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { discoverInstagramProfile } from './_lib/instagram-discovery.js';

function normalizeHandle(value) {
  return (value || '').toString().trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#]/)[0];
}

async function syncInstagramAccount({ sql, creatorId, account, userId }) {
  const handle = normalizeHandle(account.handle || account.profile_url);
  if (!handle) throw new Error('Add an Instagram handle first');
  const profile = await discoverInstagramProfile(handle);
  await sql`
    UPDATE creator_social_accounts SET
      handle = ${profile.handle || handle},
      profile_url = ${profile.profile_url},
      followers = ${profile.followers ?? null},
      following = ${profile.following ?? null},
      engagement_rate = ${profile.engagement_rate},
      metrics = ${JSON.stringify(profile.metrics || {})}::jsonb,
      last_synced_at = now(),
      updated_at = now()
    WHERE id = ${account.id}
  `;
  await sql`
    UPDATE creators
    SET avatar_url = COALESCE(${profile.avatar_url || null}, avatar_url), updated_at = now()
    WHERE id = ${creatorId}
  `;
  await sql`
    INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
    VALUES (
      ${creatorId}, 'social_sync', 'Instagram metrics refreshed',
      ${JSON.stringify({ platform: 'instagram', followers: profile.followers, engagement_rate: profile.engagement_rate })}::jsonb,
      ${userId}
    )
  `;
  return profile;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    if (req.body?.action === 'batch_missing_avatars') {
      const limit = Math.min(Math.max(Number(req.body.limit) || 25, 1), 50);
      const rows = await sql`
        SELECT c.id AS creator_id, c.name, s.*
        FROM creators c
        JOIN creator_social_accounts s ON s.creator_id = c.id AND s.platform = 'instagram'
        WHERE c.archived_at IS NULL
          AND (c.avatar_url IS NULL OR c.avatar_url = '')
          AND (s.handle IS NOT NULL OR s.profile_url IS NOT NULL)
        ORDER BY s.last_synced_at ASC NULLS FIRST, c.updated_at DESC
        LIMIT ${limit}
      `;
      const results = [];
      for (const row of rows) {
        try {
          const profile = await syncInstagramAccount({
            sql,
            creatorId: row.creator_id,
            account: row,
            userId: access.userId,
          });
          results.push({ creator_id: row.creator_id, name: row.name, status: 'synced', avatar_url: profile.avatar_url || null });
        } catch (err) {
          results.push({ creator_id: row.creator_id, name: row.name, status: 'skipped', error: err.message });
        }
      }
      const synced = results.filter(item => item.status === 'synced').length;
      return res.json({ ok: true, attempted: rows.length, synced, skipped: results.length - synced, results });
    }

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

    const profile = await syncInstagramAccount({ sql, creatorId, account, userId: access.userId });
    return res.json({
      ok: true,
      followers: profile.followers,
      engagement_rate: profile.engagement_rate,
      avatar_url: profile.avatar_url,
      last_synced_at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
