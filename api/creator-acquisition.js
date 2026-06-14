import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { discoverInstagramProfile, normalizeInstagramHandle } from './_lib/instagram-discovery.js';

const REVIEW_STATUSES = new Set(['new', 'reviewing', 'approved', 'declined', 'archived']);

function text(value, max = 5000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function list(value, max = 20) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map(item => text(item, 200)).filter(Boolean).slice(0, max);
}

function mergeInstagramSocial(socials, profile) {
  const accounts = Array.isArray(socials) ? socials : [];
  return [...accounts.filter(account => account.platform !== 'instagram'), profile];
}

async function promote(sql, access, sourceType, record) {
  if (record.promoted_creator_id) {
    const [creator] = await sql`SELECT id, name FROM creators WHERE id = ${record.promoted_creator_id}`;
    return creator;
  }
  const socials = Array.isArray(record.socials) ? record.socials : [];
  const instagram = socials.find(item => item.platform === 'instagram');
  const [duplicate] = await sql`
    SELECT id, name FROM creators
    WHERE (${record.email || null}::text IS NOT NULL AND lower(email) = ${record.email?.toLowerCase() || null})
      OR (
        ${instagram?.handle || null}::text IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM creator_social_accounts s
          WHERE s.creator_id = creators.id
            AND s.platform = 'instagram'
            AND lower(s.handle) = ${instagram?.handle?.replace(/^@/, '').toLowerCase() || null}
        )
      )
    LIMIT 1
  `;
  if (duplicate) throw new Error(`This person already exists as ${duplicate.name}.`);

  const activities = Array.isArray(record.activities) ? record.activities : [];
  const [creator] = await sql`
    INSERT INTO creators (
      name, email, phone, location, timezone, bio, niche, strengths,
      audience_demographics, activities, rate_notes, notes, avatar_url,
      source, source_external_id, source_metadata, stage, status, created_by
    ) VALUES (
      ${record.name || instagram?.handle || 'New creator'}, ${record.email || null}, ${record.phone || null},
      ${record.location || null}, ${record.timezone || null},
      ${record.creator_experience || record.biography || record.enrichment?.biography || null},
      ${record.niche || null}, ${record.strengths || null}, ${record.audience_description || null},
      ${activities}, ${record.rate_expectations || null}, ${record.review_notes || record.fit_notes || null},
      ${record.avatar_url || instagram?.avatar_url || null}, ${sourceType}, ${String(record.id)},
      ${JSON.stringify({ acquisition_source: sourceType, application_code: record.application_code || null })}::jsonb,
      'sourced', 'qualified', ${access.userId}
    )
    RETURNING *
  `;
  for (const account of socials) {
    await sql`
      INSERT INTO creator_social_accounts (
        creator_id, platform, handle, profile_url, followers, following,
        avg_views, engagement_rate, metrics, last_synced_at
      ) VALUES (
        ${creator.id}, ${account.platform}, ${text(account.handle, 300)}, ${text(account.profile_url, 2000)},
        ${Number(account.followers) || null}, ${Number(account.following) || null},
        ${Number(account.avg_views) || null}, ${Number(account.engagement_rate) || null},
        ${JSON.stringify(account.metrics || {})}::jsonb,
        ${account.followers ? new Date().toISOString() : null}
      )
      ON CONFLICT (creator_id, platform) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
    VALUES (
      ${creator.id}, 'acquisition_promoted', ${`Promoted from ${sourceType}`},
      ${JSON.stringify({ source_id: Number(record.id) })}::jsonb, ${access.userId}
    )
  `;
  return creator;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql } = access;
  try {
    await ensureCreatorOpsTables(sql);
    if (req.method === 'GET') {
      const [applications, candidates, counts] = await Promise.all([
        sql`SELECT * FROM creator_applications ORDER BY
          CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
          created_at DESC LIMIT 500`,
        sql`SELECT * FROM creator_candidates ORDER BY
          CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END,
          created_at DESC LIMIT 500`,
        sql`SELECT
          (SELECT count(*) FROM creator_applications WHERE status = 'new')::int AS new_applications,
          (SELECT count(*) FROM creator_candidates WHERE status = 'new')::int AS new_candidates`,
      ]);
      return res.json({ applications, candidates, counts: counts[0] || {} });
    }

    if (req.method === 'POST' && req.body?.action === 'discover_instagram') {
      const handle = normalizeInstagramHandle(req.body?.handle);
      if (!handle) return res.status(400).json({ error: 'Instagram handle required.' });
      const profile = await discoverInstagramProfile(handle);
      const [existing] = await sql`
        SELECT * FROM creator_candidates
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(socials) account
          WHERE account->>'platform' = 'instagram'
            AND lower(account->>'handle') = ${profile.handle.toLowerCase()}
        )
        ORDER BY created_at DESC LIMIT 1
      `;
      if (existing) return res.json({ candidate: existing, duplicate: true });
      const [candidate] = await sql`
        INSERT INTO creator_candidates (
          source, name, niche, fit_notes, avatar_url, socials, enrichment, created_by
        ) VALUES (
          'instagram_discovery', ${profile.name || profile.handle}, ${text(req.body?.niche, 1000)},
          ${text(req.body?.fit_notes, 3000)}, ${profile.avatar_url},
          ${JSON.stringify([profile])}::jsonb,
          ${JSON.stringify({ biography: profile.biography, website: profile.website, metrics: profile.metrics })}::jsonb,
          ${access.userId}
        )
        RETURNING *
      `;
      return res.status(201).json({ candidate });
    }

    if (req.method !== 'PATCH') return res.status(405).end();
    const type = req.body?.type;
    const id = Number(req.body?.id);
    if (!id || !['application', 'candidate'].includes(type)) {
      return res.status(400).json({ error: 'Valid type and id required.' });
    }
    const table = type === 'application' ? 'creator_applications' : 'creator_candidates';
    const records = table === 'creator_applications'
      ? await sql`SELECT * FROM creator_applications WHERE id = ${id}`
      : await sql`SELECT * FROM creator_candidates WHERE id = ${id}`;
    const record = records[0];
    if (!record) return res.status(404).json({ error: 'Acquisition record not found.' });

    if (req.body?.action === 'enrich_instagram') {
      const instagram = (Array.isArray(record.socials) ? record.socials : [])
        .find(account => account.platform === 'instagram');
      const handle = normalizeInstagramHandle(instagram?.handle || req.body?.handle);
      if (!handle) return res.status(400).json({ error: 'Add a valid Instagram handle before enriching.' });
      const profile = await discoverInstagramProfile(handle);
      const socials = mergeInstagramSocial(record.socials, profile);
      const enrichment = {
        ...(record.enrichment || {}),
        biography: profile.biography,
        website: profile.website,
        instagram_metrics: profile.metrics,
        instagram_enriched_at: new Date().toISOString(),
      };
      const [updated] = type === 'application'
        ? await sql`
            UPDATE creator_applications SET
              socials = ${JSON.stringify(socials)}::jsonb,
              enrichment = ${JSON.stringify(enrichment)}::jsonb,
              updated_at = now()
            WHERE id = ${id} RETURNING *
          `
        : await sql`
            UPDATE creator_candidates SET
              name = COALESCE(name, ${profile.name}),
              avatar_url = COALESCE(${profile.avatar_url}, avatar_url),
              socials = ${JSON.stringify(socials)}::jsonb,
              enrichment = ${JSON.stringify(enrichment)}::jsonb,
              updated_at = now()
            WHERE id = ${id} RETURNING *
          `;
      return res.json({ record: updated });
    }

    if (req.body?.action === 'promote') {
      const creator = await promote(sql, access, type === 'application' ? 'application' : 'discovery', record);
      if (type === 'application') {
        await sql`
          UPDATE creator_applications SET status = 'approved', promoted_creator_id = ${creator.id},
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE creator_candidates SET status = 'approved', promoted_creator_id = ${creator.id},
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
      }
      return res.json({ creator });
    }

    const status = REVIEW_STATUSES.has(req.body?.status) ? req.body.status : record.status;
    const reviewNotes = req.body?.review_notes === undefined ? record.review_notes : text(req.body.review_notes, 5000);
    const [updated] = type === 'application'
      ? await sql`
          UPDATE creator_applications SET
            status = ${status}, review_notes = ${reviewNotes},
            name = COALESCE(${text(req.body?.name, 200)}, name),
            email = COALESCE(${text(req.body?.email, 320)?.toLowerCase()}, email),
            location = COALESCE(${text(req.body?.location, 300)}, location),
            niche = COALESCE(${text(req.body?.niche, 1000)}, niche),
            strengths = COALESCE(${text(req.body?.strengths, 2000)}, strengths),
            audience_description = COALESCE(${text(req.body?.audience_description, 2000)}, audience_description),
            rate_expectations = COALESCE(${text(req.body?.rate_expectations, 1000)}, rate_expectations),
            activities = CASE WHEN ${req.body?.activities !== undefined} THEN ${list(req.body?.activities)} ELSE activities END,
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id} RETURNING *
        `
      : await sql`
          UPDATE creator_candidates SET status = ${status}, review_notes = ${reviewNotes},
            name = COALESCE(${text(req.body?.name, 200)}, name),
            email = COALESCE(${text(req.body?.email, 320)?.toLowerCase()}, email),
            location = COALESCE(${text(req.body?.location, 300)}, location),
            niche = COALESCE(${text(req.body?.niche, 1000)}, niche),
            strengths = COALESCE(${text(req.body?.strengths, 2000)}, strengths),
            audience_description = COALESCE(${text(req.body?.audience_description, 2000)}, audience_description),
            rate_expectations = COALESCE(${text(req.body?.rate_expectations, 1000)}, rate_expectations),
            activities = CASE WHEN ${req.body?.activities !== undefined} THEN ${list(req.body?.activities)} ELSE activities END,
            fit_notes = COALESCE(${text(req.body?.fit_notes, 3000)}, fit_notes),
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id} RETURNING *
        `;
    return res.json({ record: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
