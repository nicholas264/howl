import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { CLICKUP_CREATOR_LIST_ID, getIntegrationHealth } from './_lib/integration-health.js';

function value(row, names) {
  const keys = Object.keys(row || {});
  for (const name of names) {
    const key = keys.find(item => item.toLowerCase().replace(/[^a-z0-9]/g, '') === name);
    if (key && row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
  }
  return '';
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
    let rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
    if (req.body?.action === 'clickup_sync') {
      const token = process.env.CLICKUP_API_TOKEN?.trim();
      const listId = CLICKUP_CREATOR_LIST_ID;
      if (!token || !listId) return res.status(409).json({ error: 'ClickUp sync is not configured' });
      rows = [];
      for (let page = 0; page < 20; page++) {
        const response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task?page=${page}&include_closed=true&include_markdown_description=true`, {
          headers: { Authorization: token },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.err || data.error || `ClickUp request failed (${response.status})`);
        const tasks = data.tasks || [];
        for (const task of tasks) {
          const custom = Object.fromEntries((task.custom_fields || []).map(field => {
            const raw = field.value;
            const display = Array.isArray(raw)
              ? raw.map(item => item?.name || item?.label || item).join(', ')
              : raw && typeof raw === 'object'
                ? raw.name || raw.label || JSON.stringify(raw)
                : raw;
            return [field.name, display ?? ''];
          }));
          rows.push({
            Name: task.name,
            ID: task.id,
            Source: 'clickup',
            Notes: task.markdown_description || task.description || '',
            Tags: (task.tags || []).map(tag => tag.name).join(', '),
            Status: task.status?.status || '',
            ...custom,
          });
        }
        if (tasks.length < 100 || rows.length >= 2000) break;
      }
      rows = rows.slice(0, 2000);
    }
    if (!rows.length) return res.status(400).json({ error: 'rows[] required' });

    let created = 0;
    let updated = 0;
    const skipped = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const name = value(row, ['name', 'creatorname', 'fullname', 'applicant']);
      const email = value(row, ['email', 'emailaddress']);
      if (!name) {
        skipped.push({ row: index + 1, reason: 'Missing name' });
        continue;
      }
      const externalId = value(row, ['id', 'taskid', 'clickupid']) || null;
      const activities = value(row, ['activities', 'activity', 'interests']).split(',').map(item => item.trim()).filter(Boolean);
      const tags = value(row, ['tags', 'labels', 'creatorcategory']).split(',').map(item => item.trim()).filter(Boolean);
      const source = value(row, ['source']) || 'clickup_import';
      const existing = externalId
        ? await sql`SELECT id FROM creators WHERE source = ${source} AND source_external_id = ${externalId} LIMIT 1`
        : email
          ? await sql`SELECT id FROM creators WHERE lower(email) = ${email.toLowerCase()} LIMIT 1`
          : [];
      if (existing[0]) {
        await sql`
          UPDATE creators SET
            name = ${name},
            email = ${email || null},
            phone = ${value(row, ['phone', 'phonenumber']) || null},
            location = ${value(row, ['location', 'city', 'state']) || null},
            activities = ${activities},
            tags = ${tags},
            notes = COALESCE(${value(row, ['notes', 'applicationnotes', 'description']) || null}, notes),
            updated_at = now()
          WHERE id = ${existing[0].id}
        `;
        updated++;
      } else {
        await sql`
          INSERT INTO creators (
            name, email, phone, location, activities, tags, notes,
            source, source_external_id, stage, status, created_by
          ) VALUES (
            ${name}, ${email || null}, ${value(row, ['phone', 'phonenumber']) || null},
            ${value(row, ['location', 'city', 'state']) || null}, ${activities}, ${tags},
            ${value(row, ['notes', 'applicationnotes', 'description']) || null},
            ${source}, ${externalId}, 'sourced', 'prospect', ${access.userId}
          )
        `;
        created++;
      }
    }
    return res.json({ ok: true, created, updated, skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
