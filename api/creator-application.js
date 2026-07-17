import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function text(value, max = 5000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function list(value, max = 20) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map(item => text(item, 300)).filter(Boolean).slice(0, max);
}

function urls(value, max = 10) {
  return list(value, max).flatMap(item => {
    try {
      const url = new URL(item);
      return url.protocol === 'https:' ? [url.toString()] : [];
    } catch {
      return [];
    }
  });
}

function social(platform, value) {
  const handle = text(value, 500);
  return handle ? { platform, handle } : null;
}

function bool(value) {
  return value === true || value === 'true' || value === 'yes';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.CREATOR_APPLICATIONS_ENABLED === 'false') {
    return res.status(503).json({ error: 'Creator applications are currently closed.' });
  }
  if (text(req.body?.website, 500)) return res.status(201).json({ ok: true });

  const firstName = text(req.body?.first_name, 100);
  const lastName = text(req.body?.last_name, 100);
  const fallbackName = text(req.body?.name, 200);
  const name = [firstName, lastName].filter(Boolean).join(' ') || fallbackName;
  const email = text(req.body?.email, 320)?.toLowerCase();
  if (!name || !email || !email.includes('@')) {
    return res.status(400).json({ error: 'Name and a valid email are required.' });
  }
  if (req.body?.age_confirmed !== true || req.body?.consent_confirmed !== true) {
    return res.status(400).json({ error: 'Age and application consent must be confirmed.' });
  }

  const forwarded = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  const ipHash = createHash('sha256')
    .update(`${forwarded || 'unknown'}:${process.env.CLERK_SECRET_KEY || 'howl'}`)
    .digest('hex');
  const sql = neon(process.env.DATABASE_URL);

  try {
    await ensureCreatorOpsTables(sql);
    const [usage] = await sql`
      SELECT count(*)::int AS submissions
      FROM creator_applications
      WHERE ip_hash = ${ipHash} AND created_at >= now() - interval '24 hours'
    `;
    if (Number(usage?.submissions || 0) >= 5) {
      return res.status(429).json({ error: 'Too many applications from this connection. Try again tomorrow.' });
    }
    const [duplicate] = await sql`
      SELECT application_code, status
      FROM creator_applications
      WHERE lower(email) = ${email}
        AND created_at >= now() - interval '90 days'
        AND status NOT IN ('declined', 'withdrawn')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (duplicate) {
      return res.status(409).json({
        error: 'An application for this email is already under review.',
        application_code: duplicate.application_code,
      });
    }

    const socials = [
      social('instagram', req.body?.instagram || req.body?.ig_handle),
      social('youtube', req.body?.youtube || req.body?.youtube_handle),
    ].filter(Boolean);
    if (!socials.length) return res.status(400).json({ error: 'Add an Instagram or YouTube handle.' });
    const sampleUrls = urls(req.body?.sample_urls);
    if (!sampleUrls.length) {
      return res.status(400).json({ error: 'Add a valid HTTPS link to past creative work or UGC content.' });
    }
    const applicationCode = `HOWL-${randomBytes(4).toString('hex').toUpperCase()}`;
    await sql`
      INSERT INTO creator_applications (
        application_code, name, email, phone, location, timezone, niche, strengths,
        activities, audience_description, audience_psychographics, creator_experience, why_howl,
        rate_expectations, availability, open_to_product_for_content, open_to_whitelisting,
        referral_source, socials, sample_urls,
        age_confirmed, consent_confirmed, ip_hash
      ) VALUES (
        ${applicationCode}, ${name}, ${email}, ${text(req.body?.phone, 100)},
        ${text(req.body?.location, 300)}, ${text(req.body?.timezone, 100)},
        ${text(req.body?.niche, 1000)}, ${text(req.body?.strengths, 2000)},
        ${list(req.body?.activities)}, ${text(req.body?.audience_description, 2000)},
        ${text(req.body?.audience_psychographics, 2000)},
        ${text(req.body?.creator_experience, 3000)}, ${text(req.body?.why_howl, 3000)},
        ${text(req.body?.rate_expectations, 1000)}, ${text(req.body?.availability, 1000)},
        ${bool(req.body?.open_to_product_for_content)}, ${bool(req.body?.open_to_whitelisting)},
        ${text(req.body?.referral_source, 500)}, ${JSON.stringify(socials)}::jsonb,
        ${sampleUrls}, true, true, ${ipHash}
      )
    `;
    return res.status(201).json({ ok: true, application_code: applicationCode });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
