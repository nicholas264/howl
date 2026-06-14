import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

const STAGES = new Set(['sourced', 'contacted', 'interested', 'briefing', 'producing', 'active', 'alumni']);
const STATUSES = new Set(['prospect', 'qualified', 'contracted', 'inactive']);
const PLATFORMS = new Set(['instagram', 'tiktok', 'youtube', 'facebook', 'other']);

function text(value, max = 5000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function list(value) {
  if (Array.isArray(value)) return value.map(v => text(v, 100)).filter(Boolean).slice(0, 30);
  return text(value, 2000)?.split(',').map(v => v.trim()).filter(Boolean).slice(0, 30) || [];
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function creatorDetail(sql, id) {
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((
        SELECT json_agg(s ORDER BY s.platform)
        FROM creator_social_accounts s
        WHERE s.creator_id = c.id
      ), '[]'::json) AS social_accounts,
      COALESCE((
        SELECT json_agg(a ORDER BY a.created_at DESC)
        FROM (
          SELECT id, kind, summary, metadata, user_id, created_at
          FROM creator_activity
          WHERE creator_id = c.id
          ORDER BY created_at DESC
          LIMIT 30
        ) a
      ), '[]'::json) AS activity,
      (SELECT count(*)::int FROM launch_history l WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)) AS launch_count,
      (SELECT max(l.launched_at) FROM launch_history l WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)) AS last_launch_at,
      COALESCE((
        SELECT json_build_object(
          'spend', COALESCE(sum(i.spend), 0),
          'revenue', COALESCE(sum(i.purchase_value), 0),
          'purchases', COALESCE(sum(i.purchases), 0),
          'impressions', COALESCE(sum(i.impressions), 0)
        )
        FROM launch_history l
        JOIN creative_insights_daily i ON i.ad_id = l.ad_id
        WHERE (l.creator_id = c.id OR lower(l.creator) = lower(c.name))
          AND i.date >= current_date - interval '90 days'
      ), '{}'::json) AS performance,
      COALESCE((
        SELECT json_agg(asset ORDER BY asset.revenue DESC, asset.launched_at DESC)
        FROM (
          SELECT
            l.ad_id,
            l.ad_name,
            l.mime_type,
            l.launched_at,
            l.brief_id,
            l.deliverable_id,
            b.title AS brief_title,
            d.title AS deliverable_title,
            COALESCE(ca.durable_url, l.source_video_url, cp.asset_url) AS asset_url,
            cp.thumbnail_url,
            COALESCE(metrics.spend, 0) AS spend,
            COALESCE(metrics.revenue, 0) AS revenue,
            COALESCE(metrics.purchases, 0) AS purchases,
            COALESCE(metrics.impressions, 0) AS impressions,
            COALESCE(metrics.clicks, 0) AS clicks
          FROM launch_history l
          LEFT JOIN creator_briefs b ON b.id = l.brief_id
          LEFT JOIN creator_deliverables d ON d.id = l.deliverable_id
          LEFT JOIN creative_performance cp ON cp.ad_id = l.ad_id
          LEFT JOIN LATERAL (
            SELECT durable_url
            FROM creative_assets
            WHERE ad_id = l.ad_id
            ORDER BY updated_at DESC
            LIMIT 1
          ) ca ON true
          LEFT JOIN LATERAL (
            SELECT
              sum(i.spend) AS spend,
              sum(i.purchase_value) AS revenue,
              sum(i.purchases) AS purchases,
              sum(i.impressions) AS impressions,
              sum(i.clicks) AS clicks
            FROM creative_insights_daily i
            WHERE i.ad_id = l.ad_id
              AND i.date >= current_date - interval '90 days'
          ) metrics ON true
          WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)
          ORDER BY COALESCE(metrics.revenue, 0) DESC, l.launched_at DESC
          LIMIT 50
        ) asset
      ), '[]'::json) AS performance_assets
    FROM creators c
    WHERE c.id = ${id}
  `;
  return creator;
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'creators.read' : 'creators.write';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);

    if (req.method === 'GET') {
      const id = req.query.id ? Number(req.query.id) : null;
      if (id) {
        const creator = await creatorDetail(sql, id);
        return creator ? res.json({ creator }) : res.status(404).json({ error: 'Creator not found' });
      }
      const search = text(req.query.search, 200);
      const stage = STAGES.has(req.query.stage) ? req.query.stage : null;
      const rows = await sql`
        SELECT c.*,
          COALESCE((
            SELECT json_agg(s ORDER BY s.platform)
            FROM creator_social_accounts s
            WHERE s.creator_id = c.id
          ), '[]'::json) AS social_accounts,
          (
            SELECT min(o.next_follow_up_at)
            FROM creator_outreach o
            WHERE o.creator_id = c.id
              AND o.next_follow_up_at IS NOT NULL
              AND o.replied_at IS NULL
              AND o.outcome IS NULL
              AND o.status IN ('sent', 'follow_up')
          ) AS next_follow_up_at,
          (SELECT count(*)::int FROM launch_history l WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)) AS launch_count,
          (SELECT max(l.launched_at) FROM launch_history l WHERE l.creator_id = c.id OR lower(l.creator) = lower(c.name)) AS last_launch_at
        FROM creators c
        WHERE (${search}::text IS NULL OR c.name ILIKE ${search ? `%${search}%` : null} OR c.email ILIKE ${search ? `%${search}%` : null})
          AND (${stage}::text IS NULL OR c.stage = ${stage})
        ORDER BY
          next_follow_up_at ASC NULLS LAST,
          CASE c.stage
            WHEN 'active' THEN 1 WHEN 'producing' THEN 2 WHEN 'briefing' THEN 3
            WHEN 'interested' THEN 4 WHEN 'contacted' THEN 5 WHEN 'sourced' THEN 6 ELSE 7
          END,
          c.updated_at DESC
        LIMIT 500
      `;
      return res.json({ creators: rows });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'activity') {
        const creatorId = Number(body.creator_id);
        if (!creatorId || !text(body.summary, 1000)) return res.status(400).json({ error: 'creator_id and summary required' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (${creatorId}, ${text(body.kind, 50) || 'note'}, ${text(body.summary, 1000)}, ${JSON.stringify(body.metadata || {})}::jsonb, ${access.userId})
        `;
        return res.json({ creator: await creatorDetail(sql, creatorId) });
      }

      const name = text(body.name, 200);
      if (!name) return res.status(400).json({ error: 'Name is required' });
      const stage = STAGES.has(body.stage) ? body.stage : 'sourced';
      const status = STATUSES.has(body.status) ? body.status : 'prospect';
      const [creator] = await sql`
        INSERT INTO creators (
          name, email, phone, status, stage, source, source_external_id,
          location, timezone, bio, niche, strengths, audience_demographics,
          audience_psychographics, activities, tags, rate_notes, notes,
          avatar_url, owner_user_id, shipping_address1, shipping_address2,
          shipping_city, shipping_region, shipping_postal_code, shipping_country_code,
          product_seeding_required, created_by
        ) VALUES (
          ${name}, ${text(body.email, 320)}, ${text(body.phone, 100)}, ${status}, ${stage},
          ${text(body.source, 50) || 'manual'}, ${text(body.source_external_id, 200)},
          ${text(body.location, 200)}, ${text(body.timezone, 100)}, ${text(body.bio)},
          ${text(body.niche)}, ${text(body.strengths)}, ${text(body.audience_demographics)},
          ${text(body.audience_psychographics)},
          ${list(body.activities)}, ${list(body.tags)}, ${text(body.rate_notes)},
          ${text(body.notes)}, ${text(body.avatar_url, 2000)}, ${text(body.owner_user_id, 200)},
          ${text(body.shipping_address1, 300)}, ${text(body.shipping_address2, 300)},
          ${text(body.shipping_city, 200)}, ${text(body.shipping_region, 100)},
          ${text(body.shipping_postal_code, 40)}, ${text(body.shipping_country_code, 2)?.toUpperCase() || 'US'},
          ${body.product_seeding_required !== false}, ${access.userId}
        )
        RETURNING *
      `;
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, user_id)
        VALUES (${creator.id}, 'created', 'Creator added to the pipeline', ${access.userId})
      `;
      return res.status(201).json({ creator: await creatorDetail(sql, creator.id) });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const id = Number(body.id);
      if (!id) return res.status(400).json({ error: 'id required' });

      if (body.action === 'social') {
        if (!PLATFORMS.has(body.platform)) return res.status(400).json({ error: 'Valid platform required' });
        await sql`
          INSERT INTO creator_social_accounts (
            creator_id, platform, handle, profile_url, followers, following,
            avg_views, engagement_rate, metrics, last_synced_at, updated_at
          ) VALUES (
            ${id}, ${body.platform}, ${text(body.handle, 200)}, ${text(body.profile_url, 2000)},
            ${numberOrNull(body.followers)}, ${numberOrNull(body.following)}, ${numberOrNull(body.avg_views)},
            ${numberOrNull(body.engagement_rate)}, ${JSON.stringify(body.metrics || {})}::jsonb,
            ${body.last_synced_at || null}, now()
          )
          ON CONFLICT (creator_id, platform) DO UPDATE SET
            handle = EXCLUDED.handle, profile_url = EXCLUDED.profile_url,
            followers = EXCLUDED.followers, following = EXCLUDED.following,
            avg_views = EXCLUDED.avg_views, engagement_rate = EXCLUDED.engagement_rate,
            metrics = EXCLUDED.metrics, last_synced_at = EXCLUDED.last_synced_at, updated_at = now()
        `;
        return res.json({ creator: await creatorDetail(sql, id) });
      }

      const current = await creatorDetail(sql, id);
      if (!current) return res.status(404).json({ error: 'Creator not found' });
      const stage = body.stage === undefined ? current.stage : (STAGES.has(body.stage) ? body.stage : current.stage);
      const status = body.status === undefined ? current.status : (STATUSES.has(body.status) ? body.status : current.status);
      const [updated] = await sql`
        UPDATE creators SET
          name = ${text(body.name, 200) || current.name},
          email = ${body.email === undefined ? current.email : text(body.email, 320)},
          phone = ${body.phone === undefined ? current.phone : text(body.phone, 100)},
          status = ${status}, stage = ${stage},
          location = ${body.location === undefined ? current.location : text(body.location, 200)},
          timezone = ${body.timezone === undefined ? current.timezone : text(body.timezone, 100)},
          bio = ${body.bio === undefined ? current.bio : text(body.bio)},
          niche = ${body.niche === undefined ? current.niche : text(body.niche)},
          strengths = ${body.strengths === undefined ? current.strengths : text(body.strengths)},
          audience_demographics = ${body.audience_demographics === undefined ? current.audience_demographics : text(body.audience_demographics)},
          audience_psychographics = ${body.audience_psychographics === undefined ? current.audience_psychographics : text(body.audience_psychographics)},
          activities = ${body.activities === undefined ? current.activities : list(body.activities)},
          tags = ${body.tags === undefined ? current.tags : list(body.tags)},
          rate_notes = ${body.rate_notes === undefined ? current.rate_notes : text(body.rate_notes)},
          notes = ${body.notes === undefined ? current.notes : text(body.notes)},
          avatar_url = ${body.avatar_url === undefined ? current.avatar_url : text(body.avatar_url, 2000)},
          owner_user_id = ${body.owner_user_id === undefined ? current.owner_user_id : text(body.owner_user_id, 200)},
          shipping_address1 = ${body.shipping_address1 === undefined ? current.shipping_address1 : text(body.shipping_address1, 300)},
          shipping_address2 = ${body.shipping_address2 === undefined ? current.shipping_address2 : text(body.shipping_address2, 300)},
          shipping_city = ${body.shipping_city === undefined ? current.shipping_city : text(body.shipping_city, 200)},
          shipping_region = ${body.shipping_region === undefined ? current.shipping_region : text(body.shipping_region, 100)},
          shipping_postal_code = ${body.shipping_postal_code === undefined ? current.shipping_postal_code : text(body.shipping_postal_code, 40)},
          shipping_country_code = ${body.shipping_country_code === undefined ? current.shipping_country_code : (text(body.shipping_country_code, 2)?.toUpperCase() || 'US')},
          product_seeding_required = ${body.product_seeding_required === undefined ? current.product_seeding_required : body.product_seeding_required !== false},
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (stage !== current.stage) {
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (${id}, 'stage_change', ${`Moved from ${current.stage} to ${stage}`}, ${JSON.stringify({ from: current.stage, to: stage })}::jsonb, ${access.userId})
        `;
      }
      return res.json({ creator: await creatorDetail(sql, updated.id) });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || req.body?.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM creators WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
