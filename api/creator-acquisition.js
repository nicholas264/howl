import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { discoverInstagramProfile, normalizeInstagramHandle } from './_lib/instagram-discovery.js';

const REVIEW_STATUSES = new Set(['new', 'reviewing', 'approved', 'declined', 'archived']);
const RECOMMENDATIONS = new Set(['strong_fit', 'potential', 'pass']);
const SCORE_FIELDS = ['brand_fit', 'creative_quality', 'audience_fit', 'reliability', 'economics'];

function text(value, max = 5000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function list(value, max = 20) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map(item => text(item, 200)).filter(Boolean).slice(0, max);
}

function reviewScorecard(value, previous = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return previous || {};
  const result = {};
  for (const field of SCORE_FIELDS) {
    const score = Number(value[field]);
    if (Number.isInteger(score) && score >= 1 && score <= 5) result[field] = score;
  }
  const scored = SCORE_FIELDS.map(field => result[field]).filter(Boolean);
  if (scored.length) {
    result.overall = Math.round((scored.reduce((sum, score) => sum + score, 0) / (scored.length * 5)) * 100);
  }
  const recommendation = text(value.recommendation, 40);
  if (RECOMMENDATIONS.has(recommendation)) result.recommendation = recommendation;
  const rationale = text(value.rationale, 2000);
  if (rationale) result.rationale = rationale;
  result.updated_at = new Date().toISOString();
  return result;
}

function promotableScorecard(scorecard = {}) {
  return SCORE_FIELDS.every(field => Number(scorecard[field]) >= 1 && Number(scorecard[field]) <= 5)
    && ['strong_fit', 'potential'].includes(scorecard.recommendation);
}

function mergeInstagramSocial(socials, profile) {
  const accounts = Array.isArray(socials) ? socials : [];
  return [...accounts.filter(account => account.platform !== 'instagram'), profile];
}

function withQualification(record, body) {
  return {
    ...record,
    name: text(body?.name, 200) || record.name,
    email: text(body?.email, 320)?.toLowerCase() || record.email,
    location: text(body?.location, 300) || record.location,
    niche: text(body?.niche, 1000) || record.niche,
    strengths: text(body?.strengths, 2000) || record.strengths,
    audience_description: text(body?.audience_description, 2000) || record.audience_description,
    rate_expectations: text(body?.rate_expectations, 1000) || record.rate_expectations,
    activities: body?.activities !== undefined ? list(body.activities) : record.activities,
    fit_notes: text(body?.fit_notes, 3000) || record.fit_notes,
    review_notes: text(body?.review_notes, 5000) || record.review_notes,
    review_scorecard: reviewScorecard(body?.review_scorecard, record.review_scorecard),
  };
}

async function enrichRecord(sql, type, record) {
  const instagram = (Array.isArray(record.socials) ? record.socials : [])
    .find(account => account.platform === 'instagram');
  const handle = normalizeInstagramHandle(instagram?.handle);
  if (!handle) throw new Error('No valid Instagram handle');
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
        WHERE id = ${record.id} RETURNING *
      `
    : await sql`
        UPDATE creator_candidates SET
          name = COALESCE(name, ${profile.name}),
          avatar_url = COALESCE(${profile.avatar_url}, avatar_url),
          socials = ${JSON.stringify(socials)}::jsonb,
          enrichment = ${JSON.stringify(enrichment)}::jsonb,
          updated_at = now()
        WHERE id = ${record.id} RETURNING *
      `;
  return updated;
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
      ${JSON.stringify({
        acquisition_source: sourceType,
        application_code: record.application_code || null,
        acquisition_review: record.review_scorecard || {},
      })}::jsonb,
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
      ${JSON.stringify({
        source_id: Number(record.id),
        review_scorecard: record.review_scorecard || {},
      })}::jsonb, ${access.userId}
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
          (SELECT count(*) FROM creator_candidates WHERE status = 'new')::int AS new_candidates,
          (SELECT count(*) FROM creator_applications
            WHERE status IN ('new', 'reviewing')
              AND enrichment->>'instagram_enriched_at' IS NULL
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(socials) account
                WHERE account->>'platform' = 'instagram'
              )
          )::int AS applications_needing_enrichment`,
      ]);
      return res.json({ applications, candidates, counts: counts[0] || {} });
    }

    if (req.method === 'POST' && req.body?.action === 'enrich_inbox') {
      const applications = await sql`
        SELECT * FROM creator_applications
        WHERE status IN ('new', 'reviewing')
          AND enrichment->>'instagram_enriched_at' IS NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(socials) account
            WHERE account->>'platform' = 'instagram'
          )
        ORDER BY created_at ASC
        LIMIT 5
      `;
      const results = await Promise.all(applications.map(async application => {
        try {
          const updated = await enrichRecord(sql, 'application', application);
          return { id: updated.id, name: updated.name, ok: true };
        } catch (err) {
          return { id: application.id, name: application.name, ok: false, error: err.message };
        }
      }));
      return res.json({
        processed: results.length,
        enriched: results.filter(result => result.ok).length,
        failed: results.filter(result => !result.ok).length,
        results,
      });
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
      const updated = await enrichRecord(sql, type, record);
      return res.json({ record: updated });
    }

    if (req.body?.action === 'promote') {
      const reviewedRecord = withQualification(record, req.body);
      if (!promotableScorecard(reviewedRecord.review_scorecard)) {
        return res.status(400).json({ error: 'Complete the fit scorecard with a Strong fit or Potential recommendation before promotion.' });
      }
      const creator = await promote(sql, access, type === 'application' ? 'application' : 'discovery', reviewedRecord);
      if (type === 'application') {
        await sql`
          UPDATE creator_applications SET
            status = 'approved', promoted_creator_id = ${creator.id},
            name = ${reviewedRecord.name}, email = ${reviewedRecord.email},
            location = ${reviewedRecord.location}, niche = ${reviewedRecord.niche},
            strengths = ${reviewedRecord.strengths},
            audience_description = ${reviewedRecord.audience_description},
            rate_expectations = ${reviewedRecord.rate_expectations},
            activities = ${reviewedRecord.activities || []},
            review_scorecard = ${JSON.stringify(reviewedRecord.review_scorecard || {})}::jsonb,
            review_notes = ${reviewedRecord.review_notes},
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE creator_candidates SET
            status = 'approved', promoted_creator_id = ${creator.id},
            name = ${reviewedRecord.name}, email = ${reviewedRecord.email},
            location = ${reviewedRecord.location}, niche = ${reviewedRecord.niche},
            strengths = ${reviewedRecord.strengths},
            audience_description = ${reviewedRecord.audience_description},
            rate_expectations = ${reviewedRecord.rate_expectations},
            activities = ${reviewedRecord.activities || []},
            review_scorecard = ${JSON.stringify(reviewedRecord.review_scorecard || {})}::jsonb,
            fit_notes = ${reviewedRecord.fit_notes},
            review_notes = ${reviewedRecord.review_notes},
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
            review_scorecard = ${JSON.stringify(reviewScorecard(req.body?.review_scorecard, record.review_scorecard))}::jsonb,
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
            review_scorecard = ${JSON.stringify(reviewScorecard(req.body?.review_scorecard, record.review_scorecard))}::jsonb,
            fit_notes = COALESCE(${text(req.body?.fit_notes, 3000)}, fit_notes),
            reviewed_by = ${access.userId}, reviewed_at = now(), updated_at = now()
          WHERE id = ${id} RETURNING *
        `;
    return res.json({ record: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
