import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { mapClickupCreator } from './_lib/clickup-creators.js';
import {
  CLICKUP_CREATOR_LIST_ID,
  CLICKUP_CREATOR_VIEW_ID,
  getIntegrationHealth,
} from './_lib/integration-health.js';

function value(row, names) {
  const keys = Object.keys(row || {});
  for (const name of names) {
    const key = keys.find(item => item.toLowerCase().replace(/[^a-z0-9]/g, '') === name);
    if (key && row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
  }
  return '';
}

function metric(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().toLowerCase().replace(/,/g, '');
  const parsed = Number.parseFloat(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  if (text.includes('m')) return Math.round(parsed * 1_000_000);
  if (text.includes('k')) return Math.round(parsed * 1_000);
  return parsed;
}

async function clickupRequest(path, token) {
  const response = await fetch(`https://api.clickup.com/api/v2${path}`, {
    headers: { Authorization: token },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.err || data.error || `ClickUp request failed (${response.status})`);
    error.status = response.status;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  return data;
}

function mergeClickupTask(base, enriched) {
  const fields = new Map((base.custom_fields || []).map(field => [field.id, field]));
  for (const field of enriched.custom_fields || []) {
    const current = fields.get(field.id);
    const hasValue = field.value !== null && field.value !== undefined && field.value !== '';
    if (!current || hasValue) fields.set(field.id, field);
  }
  return {
    ...base,
    ...enriched,
    custom_fields: Array.from(fields.values()),
    markdown_description: enriched.markdown_description || base.markdown_description,
    description: enriched.description || base.description,
  };
}

async function loadClickupTasks(token, listId, viewId = CLICKUP_CREATOR_VIEW_ID) {
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const data = await clickupRequest(
      `/list/${encodeURIComponent(listId)}/task?page=${page}&include_closed=true&include_timl=true&include_markdown_description=true`,
      token,
    );
    const tasks = data.tasks || [];
    rows.push(...tasks);
    if (tasks.length < 100 || rows.length >= 2000) break;
  }

  if (!viewId) return rows.slice(0, 2000);
  const byId = new Map(rows.map(task => [String(task.id), task]));
  for (let page = 0; page < 50; page++) {
    let data;
    try {
      data = await clickupRequest(`/view/${encodeURIComponent(viewId)}/task?page=${page}`, token);
    } catch {
      break;
    }
    const tasks = data.tasks || [];
    for (const task of tasks) {
      const id = String(task.id);
      byId.set(id, byId.has(id) ? mergeClickupTask(byId.get(id), task) : task);
    }
    if (!tasks.length || data.last_page === true || byId.size >= 2000) break;
  }
  return Array.from(byId.values()).slice(0, 2000);
}

async function backfillClickupEmails(sql, token, listId, batchSize = 50) {
  const tasks = await loadClickupTasks(token, listId);
  const existing = await sql`
    SELECT source_external_id
    FROM creators
    WHERE source = 'clickup'
      AND email IS NULL
      AND source_external_id IS NOT NULL
      AND source_metadata->>'clickup_email_checked_at' IS NULL
  `;
  const missingIds = new Set(existing.map(row => String(row.source_external_id)));
  const candidates = tasks.filter(task => missingIds.has(String(task.id))).slice(0, batchSize);
  let checked = 0;
  let found = 0;
  let throttled = false;

  for (let offset = 0; offset < candidates.length; offset += 10) {
    const batch = candidates.slice(offset, offset + 10);
    const results = await Promise.all(batch.map(async task => {
      try {
        const detail = await clickupRequest(
          `/task/${encodeURIComponent(task.id)}?include_subtasks=true&include_markdown_description=true`,
          token,
        );
        return { task, detail };
      } catch (error) {
        return { task, error };
      }
    }));
    for (const result of results) {
      if (result.error?.status === 429) {
        throttled = true;
        continue;
      }
      if (result.error) continue;
      const mapped = mapClickupCreator(result.detail);
      const metadata = {
        clickup_email_checked_at: new Date().toISOString(),
        clickup_email_source: mapped.email ? 'task_detail' : 'not_returned',
      };
      const changed = await sql`
        UPDATE creators SET
          email = COALESCE(${mapped.email || null}, email),
          source_metadata = source_metadata || ${JSON.stringify(metadata)}::jsonb,
          updated_at = now()
        WHERE source = 'clickup' AND source_external_id = ${String(result.task.id)}
        RETURNING email
      `;
      checked++;
      if (mapped.email && changed[0]?.email) found++;
    }
    if (throttled) break;
  }

  const [remaining] = await sql`
    SELECT count(*)::int AS count
    FROM creators
    WHERE source = 'clickup'
      AND email IS NULL
      AND source_external_id IS NOT NULL
      AND source_metadata->>'clickup_email_checked_at' IS NULL
  `;
  return {
    checked,
    found,
    remaining: Number(remaining?.count || 0),
    throttled,
  };
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.write');
  if (!access) return;
  if (req.method === 'GET') {
    const clickup = getIntegrationHealth().clickup;
    return res.json({
      clickup_configured: clickup.ready,
      clickup_state: clickup.state,
      clickup_detail: clickup.detail,
    });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    if (req.body?.action === 'clickup_email_backfill') {
      const token = process.env.CLICKUP_API_TOKEN?.trim();
      const listId = CLICKUP_CREATOR_LIST_ID;
      if (!token || !listId) return res.status(409).json({ error: 'ClickUp sync is not configured' });
      const result = await backfillClickupEmails(
        sql,
        token,
        listId,
        Math.max(1, Math.min(75, Number(req.body?.batch_size) || 50)),
      );
      return res.json({ ok: true, ...result });
    }
    let rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
    if (req.body?.action === 'clickup_sync') {
      const token = process.env.CLICKUP_API_TOKEN?.trim();
      const listId = CLICKUP_CREATOR_LIST_ID;
      if (!token || !listId) return res.status(409).json({ error: 'ClickUp sync is not configured' });
      const tasks = await loadClickupTasks(token, listId);
      rows = tasks.map(task => ({ ...mapClickupCreator(task), external_id: task.id, source: 'clickup' }));
    }
    if (!rows.length) return res.status(400).json({ error: 'rows[] required' });

    let created = 0;
    let updated = 0;
    const skipped = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const mapped = row.source_metadata ? row : {
        name: value(row, ['name', 'creatorname', 'fullname', 'applicant']),
        email: value(row, ['email', 'emailaddress']),
        phone: value(row, ['phone', 'phonenumber']),
        location: value(row, ['location', 'city', 'state']),
        timezone: value(row, ['timezone']),
        bio: value(row, ['bio', 'about', 'creatorinfo']),
        activities: value(row, ['activities', 'activity', 'interests']),
        tags: value(row, ['tags', 'labels', 'creatorcategory']),
        rate_notes: value(row, ['rates', 'rate', 'ratenotes', 'pricing']),
        notes: value(row, ['notes', 'applicationnotes', 'description']),
        avatar_url: value(row, ['avatarurl', 'photo', 'headshot']),
        external_id: value(row, ['id', 'taskid', 'clickupid']),
        source: value(row, ['source']) || 'clickup_import',
        stage: 'sourced',
        status: 'prospect',
        source_metadata: {},
        socials: [],
      };
      const name = mapped.name;
      const email = mapped.email;
      if (!name) {
        skipped.push({ row: index + 1, reason: 'Missing name' });
        continue;
      }
      const externalId = mapped.external_id || null;
      const activities = String(mapped.activities || '').split(',').map(item => item.trim()).filter(Boolean);
      const tags = String(mapped.tags || '').split(',').map(item => item.trim()).filter(Boolean);
      const source = mapped.source || 'clickup_import';
      const existing = externalId || email
        ? await sql`
            SELECT id FROM creators
            WHERE (
              ${externalId}::text IS NOT NULL
              AND source = ${source}
              AND source_external_id = ${externalId}
            ) OR (
              ${email || null}::text IS NOT NULL
              AND lower(email) = ${email ? email.toLowerCase() : null}
            )
            ORDER BY CASE WHEN source = ${source} AND source_external_id = ${externalId} THEN 0 ELSE 1 END
            LIMIT 1
          `
        : [];
      if (existing[0]) {
        await sql`
          UPDATE creators SET
            name = ${name},
            email = COALESCE(${email || null}, email),
            phone = COALESCE(${mapped.phone || null}, phone),
            location = COALESCE(${mapped.location || null}, location),
            timezone = COALESCE(${mapped.timezone || null}, timezone),
            bio = COALESCE(${mapped.bio || null}, bio),
            activities = CASE WHEN cardinality(${activities}::text[]) > 0 THEN ${activities}::text[] ELSE activities END,
            tags = CASE WHEN cardinality(${tags}::text[]) > 0 THEN ${tags}::text[] ELSE tags END,
            rate_notes = COALESCE(${mapped.rate_notes || null}, rate_notes),
            notes = COALESCE(${mapped.notes || null}, notes),
            avatar_url = COALESCE(${mapped.avatar_url || null}, avatar_url),
            stage = ${mapped.stage || 'sourced'},
            status = ${mapped.status || 'prospect'},
            source_metadata = source_metadata || ${JSON.stringify(mapped.source_metadata || {})}::jsonb,
            updated_at = now()
          WHERE id = ${existing[0].id}
        `;
        for (const account of mapped.socials || []) {
          await sql`
            INSERT INTO creator_social_accounts (
              creator_id, platform, handle, profile_url, followers, avg_views, engagement_rate, metrics, updated_at
            ) VALUES (
              ${existing[0].id}, ${account.platform}, ${account.handle || null}, ${account.profile_url || null},
              ${metric(account.followers)}, ${metric(account.avg_views)},
              ${metric(account.engagement_rate)}, ${JSON.stringify({ source: 'clickup' })}::jsonb, now()
            )
            ON CONFLICT (creator_id, platform) DO UPDATE SET
              handle = COALESCE(EXCLUDED.handle, creator_social_accounts.handle),
              profile_url = COALESCE(EXCLUDED.profile_url, creator_social_accounts.profile_url),
              followers = COALESCE(EXCLUDED.followers, creator_social_accounts.followers),
              avg_views = COALESCE(EXCLUDED.avg_views, creator_social_accounts.avg_views),
              engagement_rate = COALESCE(EXCLUDED.engagement_rate, creator_social_accounts.engagement_rate),
              metrics = creator_social_accounts.metrics || EXCLUDED.metrics,
              updated_at = now()
          `;
        }
        updated++;
      } else {
        const [creator] = await sql`
          INSERT INTO creators (
            name, email, phone, location, timezone, bio, activities, tags, rate_notes, notes, avatar_url,
            source_metadata,
            source, source_external_id, stage, status, created_by
          ) VALUES (
            ${name}, ${email || null}, ${mapped.phone || null}, ${mapped.location || null},
            ${mapped.timezone || null}, ${mapped.bio || null}, ${activities}, ${tags},
            ${mapped.rate_notes || null}, ${mapped.notes || null}, ${mapped.avatar_url || null},
            ${JSON.stringify(mapped.source_metadata || {})}::jsonb,
            ${source}, ${externalId}, ${mapped.stage || 'sourced'}, ${mapped.status || 'prospect'}, ${access.userId}
          )
          RETURNING id
        `;
        for (const account of mapped.socials || []) {
          await sql`
            INSERT INTO creator_social_accounts (
              creator_id, platform, handle, profile_url, followers, avg_views, engagement_rate, metrics
            ) VALUES (
              ${creator.id}, ${account.platform}, ${account.handle || null}, ${account.profile_url || null},
              ${metric(account.followers)}, ${metric(account.avg_views)},
              ${metric(account.engagement_rate)}, ${JSON.stringify({ source: 'clickup' })}::jsonb
            )
          `;
        }
        created++;
      }
    }
    return res.json({ ok: true, created, updated, skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
