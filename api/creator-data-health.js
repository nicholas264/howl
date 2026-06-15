import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function normalizeHandle(value) {
  return (value || '').toString().trim().replace(/^@/, '').toLowerCase();
}

async function loadHealth(sql) {
  const [summaryRows, emailRows, socialRows, gapRows] = await Promise.all([
    sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE email IS NULL)::int AS missing_email,
        count(*) FILTER (WHERE niche IS NULL)::int AS missing_niche,
        count(*) FILTER (WHERE strengths IS NULL)::int AS missing_strengths,
        count(*) FILTER (WHERE audience_demographics IS NULL)::int AS missing_audience,
        count(*) FILTER (WHERE rate_notes IS NULL)::int AS missing_rates,
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM creator_social_accounts s WHERE s.creator_id = creators.id
        ))::int AS missing_social,
        COALESCE(round(avg((
          (CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN location IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN niche IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN strengths IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN audience_demographics IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN rate_notes IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN EXISTS (
            SELECT 1 FROM creator_social_accounts s WHERE s.creator_id = creators.id
          ) THEN 1 ELSE 0 END)
        )::numeric / 7 * 100))::int, 0) AS average_completeness
      FROM creators
      WHERE status <> 'inactive'
    `,
    sql`
      SELECT lower(email) AS match_key,
        json_agg(json_build_object(
          'id', id, 'name', name, 'email', email, 'stage', stage, 'status', status,
          'location', location, 'updated_at', updated_at,
          'relationship_count', (
            SELECT count(*) FROM creator_activity a WHERE a.creator_id = creators.id
          )
        ) ORDER BY updated_at DESC) AS records
      FROM creators
      WHERE email IS NOT NULL
      GROUP BY lower(email)
      HAVING count(*) > 1
      ORDER BY count(*) DESC, lower(email)
    `,
    sql`
      WITH duplicate_handles AS (
        SELECT platform, lower(regexp_replace(trim(handle), '^@', '')) AS match_key
        FROM creator_social_accounts
        WHERE handle IS NOT NULL AND length(trim(handle)) > 1
        GROUP BY platform, lower(regexp_replace(trim(handle), '^@', ''))
        HAVING count(DISTINCT creator_id) > 1
      )
      SELECT d.platform, d.match_key,
        json_agg(json_build_object(
          'id', c.id, 'name', c.name, 'email', c.email, 'stage', c.stage, 'status', c.status,
          'location', c.location, 'updated_at', c.updated_at, 'handle', s.handle,
          'followers', s.followers, 'last_synced_at', s.last_synced_at,
          'relationship_count', (
            SELECT count(*) FROM creator_activity a WHERE a.creator_id = c.id
          )
        ) ORDER BY
          (s.followers IS NOT NULL) DESC, s.followers DESC NULLS LAST, c.updated_at DESC
        ) AS records
      FROM duplicate_handles d
      JOIN creator_social_accounts s
        ON s.platform = d.platform
        AND lower(regexp_replace(trim(s.handle), '^@', '')) = d.match_key
      JOIN creators c ON c.id = s.creator_id
      GROUP BY d.platform, d.match_key
      ORDER BY count(DISTINCT c.id) DESC, d.platform, d.match_key
    `,
    sql`
      SELECT c.id, c.name, c.email, c.stage, c.status, c.location, c.avatar_url,
        c.niche, c.strengths, c.audience_demographics, c.rate_notes,
        c.updated_at,
        COALESCE((
          SELECT json_build_object(
            'platform', s.platform, 'handle', s.handle, 'followers', s.followers
          )
          FROM creator_social_accounts s
          WHERE s.creator_id = c.id
          ORDER BY s.followers DESC NULLS LAST
          LIMIT 1
        ), '{}'::json) AS primary_social,
        (
          (CASE WHEN c.email IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN c.location IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN c.niche IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN c.strengths IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN c.audience_demographics IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN c.rate_notes IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN EXISTS (
            SELECT 1 FROM creator_social_accounts s WHERE s.creator_id = c.id
          ) THEN 1 ELSE 0 END)
        ) AS complete_fields
      FROM creators c
      WHERE c.status <> 'inactive'
      ORDER BY complete_fields ASC,
        CASE c.stage
          WHEN 'active' THEN 0 WHEN 'producing' THEN 1 WHEN 'briefing' THEN 2
          WHEN 'interested' THEN 3 WHEN 'contacted' THEN 4 ELSE 5
        END,
        c.updated_at DESC
      LIMIT 150
    `,
  ]);

  const summary = summaryRows[0] || {};
  const duplicateGroups = [
    ...emailRows.map(group => ({
      type: 'email', platform: 'email', match_key: group.match_key, records: group.records,
    })),
    ...socialRows.map(group => ({
      type: 'social', platform: group.platform, match_key: group.match_key, records: group.records,
    })),
  ];
  return {
    summary: {
      ...summary,
      duplicate_groups: duplicateGroups.length,
    },
    duplicate_groups: duplicateGroups,
    incomplete_profiles: gapRows.map(row => ({
      ...row,
      completeness: Math.round((Number(row.complete_fields) / 7) * 100),
      missing: [
        !row.email && 'Email',
        !row.location && 'Location',
        !row.primary_social?.handle && 'Social',
        !row.niche && 'Niche',
        !row.strengths && 'Strengths',
        !row.audience_demographics && 'Audience',
        !row.rate_notes && 'Rates',
      ].filter(Boolean),
    })),
  };
}

async function mergeCreators(sql, access, primaryId, duplicateId) {
  if (!primaryId || !duplicateId || primaryId === duplicateId) throw new Error('Choose two different creator records.');
  const creators = await sql`
    SELECT * FROM creators
    WHERE id IN (${primaryId}, ${duplicateId})
    ORDER BY id
  `;
  const primary = creators.find(item => Number(item.id) === primaryId);
  const duplicate = creators.find(item => Number(item.id) === duplicateId);
  if (!primary || !duplicate) throw new Error('Both creator records must exist.');

  await sql.transaction(transaction => [
    transaction`
      UPDATE creators SET
        email = COALESCE(email, ${duplicate.email}),
        phone = COALESCE(phone, ${duplicate.phone}),
        location = COALESCE(location, ${duplicate.location}),
        timezone = COALESCE(timezone, ${duplicate.timezone}),
        bio = COALESCE(bio, ${duplicate.bio}),
        niche = COALESCE(niche, ${duplicate.niche}),
        strengths = COALESCE(strengths, ${duplicate.strengths}),
        audience_demographics = COALESCE(audience_demographics, ${duplicate.audience_demographics}),
        audience_psychographics = COALESCE(audience_psychographics, ${duplicate.audience_psychographics}),
        rate_notes = COALESCE(rate_notes, ${duplicate.rate_notes}),
        notes = COALESCE(notes, ${duplicate.notes}),
        avatar_url = COALESCE(avatar_url, ${duplicate.avatar_url}),
        shipping_address1 = COALESCE(shipping_address1, ${duplicate.shipping_address1}),
        shipping_address2 = COALESCE(shipping_address2, ${duplicate.shipping_address2}),
        shipping_city = COALESCE(shipping_city, ${duplicate.shipping_city}),
        shipping_region = COALESCE(shipping_region, ${duplicate.shipping_region}),
        shipping_postal_code = COALESCE(shipping_postal_code, ${duplicate.shipping_postal_code}),
        activities = ARRAY(
          SELECT DISTINCT item FROM unnest(activities || ${duplicate.activities || []}::text[]) item
          WHERE item IS NOT NULL AND item <> ''
        ),
        tags = ARRAY(
          SELECT DISTINCT item FROM unnest(tags || ${duplicate.tags || []}::text[]) item
          WHERE item IS NOT NULL AND item <> ''
        ),
        source_metadata = ${JSON.stringify(duplicate.source_metadata || {})}::jsonb || source_metadata,
        updated_at = now()
      WHERE id = ${primaryId}
    `,
    transaction`
      INSERT INTO creator_social_accounts (
        creator_id, platform, handle, profile_url, followers, following, avg_views,
        engagement_rate, metrics, last_synced_at, created_at, updated_at
      )
      SELECT ${primaryId}, platform, handle, profile_url, followers, following, avg_views,
        engagement_rate, metrics, last_synced_at, created_at, now()
      FROM creator_social_accounts WHERE creator_id = ${duplicateId}
      ON CONFLICT (creator_id, platform) DO UPDATE SET
        handle = COALESCE(NULLIF(creator_social_accounts.handle, ''), EXCLUDED.handle),
        profile_url = COALESCE(creator_social_accounts.profile_url, EXCLUDED.profile_url),
        followers = GREATEST(
          COALESCE(creator_social_accounts.followers, EXCLUDED.followers),
          COALESCE(EXCLUDED.followers, creator_social_accounts.followers)
        ),
        following = GREATEST(
          COALESCE(creator_social_accounts.following, EXCLUDED.following),
          COALESCE(EXCLUDED.following, creator_social_accounts.following)
        ),
        avg_views = GREATEST(
          COALESCE(creator_social_accounts.avg_views, EXCLUDED.avg_views),
          COALESCE(EXCLUDED.avg_views, creator_social_accounts.avg_views)
        ),
        engagement_rate = GREATEST(
          COALESCE(creator_social_accounts.engagement_rate, EXCLUDED.engagement_rate),
          COALESCE(EXCLUDED.engagement_rate, creator_social_accounts.engagement_rate)
        ),
        metrics = EXCLUDED.metrics || creator_social_accounts.metrics,
        last_synced_at = GREATEST(
          COALESCE(creator_social_accounts.last_synced_at, EXCLUDED.last_synced_at),
          COALESCE(EXCLUDED.last_synced_at, creator_social_accounts.last_synced_at)
        ),
        updated_at = now()
    `,
    transaction`DELETE FROM creator_social_accounts WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_activity SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_outreach SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_engagements SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_agreements SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_briefs SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_product_seeds SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_deliverables SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_submission_links SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE launch_history SET creator_id = ${primaryId}, creator = ${primary.name} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creative_assets SET creator_id = ${primaryId}, creator = ${primary.name} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creative_creator_assignments SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE ugc_sessions SET creator_id = ${primaryId} WHERE creator_id = ${duplicateId}`,
    transaction`UPDATE creator_applications SET promoted_creator_id = ${primaryId} WHERE promoted_creator_id = ${duplicateId}`,
    transaction`UPDATE creator_candidates SET promoted_creator_id = ${primaryId} WHERE promoted_creator_id = ${duplicateId}`,
    transaction`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      VALUES (
        ${primaryId}, 'creator_merged', ${`Merged duplicate creator record: ${duplicate.name}`},
        ${JSON.stringify({ duplicate_creator_id: duplicateId, duplicate_name: duplicate.name })}::jsonb,
        ${access.userId}
      )
    `,
    transaction`DELETE FROM creators WHERE id = ${duplicateId}`,
  ]);

  return { primary_id: primaryId, duplicate_id: duplicateId, name: primary.name };
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'creators.read' : 'admin.users';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') return res.json(await loadHealth(sql));
    if (req.method !== 'POST' || req.body?.action !== 'merge') return res.status(405).end();

    const primaryId = Number(req.body?.primary_id);
    const duplicateId = Number(req.body?.duplicate_id);
    const expectedConfirmation = `MERGE ${duplicateId} INTO ${primaryId}`;
    if (req.body?.confirmation !== expectedConfirmation) {
      return res.status(400).json({ error: `Type ${expectedConfirmation} to confirm this merge.` });
    }
    const result = await mergeCreators(sql, access, primaryId, duplicateId);
    return res.json({ ok: true, merge: result, health: await loadHealth(sql) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export { mergeCreators, normalizeHandle };
