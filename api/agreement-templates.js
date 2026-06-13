import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function clean(value, max) {
  const result = (value || '').toString().trim();
  return result ? result.slice(0, max) : null;
}

async function audit(sql, access, action, target, metadata = {}) {
  await sql`
    INSERT INTO app_admin_audit (actor_id, actor_email, action, target, metadata)
    VALUES (${access.userId}, ${access.email || null}, ${action}, ${target}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' && req.query?.include_inactive !== 'true'
    ? 'creators.read'
    : 'admin.users';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);

    if (req.method === 'GET') {
      const includeInactive = req.query?.include_inactive === 'true';
      const templates = includeInactive
        ? await sql`
            SELECT id, name, title, agreement_body, version, status, created_at, updated_at
            FROM creator_agreement_templates
            ORDER BY CASE status WHEN 'active' THEN 1 ELSE 2 END, lower(name)
          `
        : await sql`
            SELECT id, name, title, agreement_body, version, status, created_at, updated_at
            FROM creator_agreement_templates
            WHERE status = 'active'
            ORDER BY lower(name)
          `;
      return res.json({ templates });
    }

    if (req.method === 'POST') {
      const name = clean(req.body?.name, 200);
      const title = clean(req.body?.title, 300);
      const agreementBody = clean(req.body?.agreement_body, 50000);
      if (!name || !title || !agreementBody) {
        return res.status(400).json({ error: 'Template name, agreement title, and agreement text are required' });
      }
      const [template] = await sql`
        INSERT INTO creator_agreement_templates (
          name, title, agreement_body, status, created_by, updated_by
        ) VALUES (
          ${name}, ${title}, ${agreementBody}, 'active', ${access.userId}, ${access.userId}
        )
        RETURNING id, name, title, agreement_body, version, status, created_at, updated_at
      `;
      await audit(sql, access, 'agreement_template.created', `agreement-template:${template.id}`, { name });
      return res.status(201).json({ template });
    }

    if (req.method === 'PATCH') {
      const id = Number(req.body?.id);
      if (!id) return res.status(400).json({ error: 'Template id required' });
      const status = req.body?.status;
      if (status !== undefined && !['active', 'archived'].includes(status)) {
        return res.status(400).json({ error: 'Template status must be active or archived' });
      }
      const name = req.body?.name === undefined ? null : clean(req.body.name, 200);
      const title = req.body?.title === undefined ? null : clean(req.body.title, 300);
      const agreementBody = req.body?.agreement_body === undefined ? null : clean(req.body.agreement_body, 50000);
      if ((req.body?.name !== undefined && !name)
        || (req.body?.title !== undefined && !title)
        || (req.body?.agreement_body !== undefined && !agreementBody)) {
        return res.status(400).json({ error: 'Template fields cannot be empty' });
      }
      const changesContent = name !== null || title !== null || agreementBody !== null;
      const [template] = await sql`
        UPDATE creator_agreement_templates
        SET name = COALESCE(${name}, name),
            title = COALESCE(${title}, title),
            agreement_body = COALESCE(${agreementBody}, agreement_body),
            status = COALESCE(${status || null}, status),
            version = version + ${changesContent ? 1 : 0},
            updated_by = ${access.userId},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id, name, title, agreement_body, version, status, created_at, updated_at
      `;
      if (!template) return res.status(404).json({ error: 'Template not found' });
      await audit(sql, access, 'agreement_template.updated', `agreement-template:${id}`, {
        version: template.version,
        status: template.status,
      });
      return res.json({ template });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not manage agreement templates' });
  }
}
