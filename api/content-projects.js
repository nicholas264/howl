import { requirePermission } from './_lib/app-access.js';
import {
  cleanText,
  ensureContentStudioTables,
  markdownToHtml,
  projectPayload,
  selectedSourceIds,
} from './_lib/content-studio.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  await ensureContentStudioTables(sql);

  try {
    if (req.method === 'GET') {
      const projectId = Number(req.query?.id);
      if (Number.isFinite(projectId)) {
        const [project] = await sql`SELECT * FROM content_projects WHERE id = ${projectId}`;
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const drafts = await sql`
          SELECT *
          FROM content_drafts
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
          LIMIT 50
        `;
        const feedback = await sql`
          SELECT *
          FROM content_feedback
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
          LIMIT 50
        `;
        return res.json({ project, drafts, feedback });
      }
      const rows = await sql`
        SELECT
          p.*,
          COALESCE(MAX(d.created_at), p.updated_at) AS last_draft_at,
          COUNT(d.id)::int AS draft_count
        FROM content_projects p
        LEFT JOIN content_drafts d ON d.project_id = p.id
        WHERE p.status <> 'archived'
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 100
      `;
      return res.json({ rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const action = req.body?.action || 'save';

    if (action === 'save') {
      const payload = projectPayload(req.body);
      const ids = selectedSourceIds(req.body?.selected_source_ids || req.body?.selectedSourceIds);
      if (!payload.title && !payload.topic) return res.status(400).json({ error: 'title or topic required' });
      if (req.body?.id) {
        const id = Number(req.body.id);
        const [row] = await sql`
          UPDATE content_projects
          SET title = ${payload.title || payload.topic},
              topic = ${payload.topic || null},
              target_query = ${payload.target_query || null},
              audience = ${payload.audience || null},
              product = ${payload.product || null},
              search_intent = ${payload.search_intent || null},
              desired_cta = ${payload.desired_cta || null},
              must_include = ${payload.must_include || null},
              avoid = ${payload.avoid || null},
              status = ${payload.status},
              selected_source_ids = ${ids},
              updated_at = now()
          WHERE id = ${id}
          RETURNING *
        `;
        if (!row) return res.status(404).json({ error: 'Project not found' });
        return res.json({ project: row });
      }
      const [row] = await sql`
        INSERT INTO content_projects (
          title, topic, target_query, audience, product, search_intent,
          desired_cta, must_include, avoid, status, selected_source_ids, created_by
        ) VALUES (
          ${payload.title || payload.topic}, ${payload.topic || null}, ${payload.target_query || null},
          ${payload.audience || null}, ${payload.product || null}, ${payload.search_intent || null},
          ${payload.desired_cta || null}, ${payload.must_include || null}, ${payload.avoid || null},
          ${payload.status}, ${ids}, ${access.userId}
        )
        RETURNING *
      `;
      return res.json({ project: row });
    }

    if (action === 'save_draft') {
      const projectId = Number(req.body?.project_id || req.body?.projectId);
      const kind = cleanText(req.body?.kind || 'draft', 40) || 'draft';
      const title = cleanText(req.body?.title, 300);
      const bodyMarkdown = cleanText(req.body?.body_markdown || req.body?.bodyMarkdown, 200000);
      if (!Number.isFinite(projectId) || !bodyMarkdown) {
        return res.status(400).json({ error: 'projectId and bodyMarkdown required' });
      }
      const [project] = await sql`SELECT id FROM content_projects WHERE id = ${projectId}`;
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const [{ next_version: nextVersion }] = await sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM content_drafts
        WHERE project_id = ${projectId} AND kind = ${kind}
      `;
      const [draft] = await sql`
        INSERT INTO content_drafts (
          project_id, kind, version, title, body_markdown, body_html, metadata,
          source_influence, guardrail_violations, model, user_id
        ) VALUES (
          ${projectId}, ${kind}, ${Number(nextVersion)}, ${title || null},
          ${bodyMarkdown}, ${markdownToHtml(bodyMarkdown)},
          ${JSON.stringify(req.body?.metadata || {})}::jsonb,
          ${JSON.stringify(req.body?.source_influence || req.body?.sourceInfluence || [])}::jsonb,
          ${Array.isArray(req.body?.guardrail_violations) ? req.body.guardrail_violations : []},
          ${cleanText(req.body?.model, 120) || null},
          ${access.userId}
        )
        RETURNING *
      `;
      await sql`UPDATE content_projects SET status = 'ready', updated_at = now() WHERE id = ${projectId}`;
      return res.json({ draft });
    }

    if (action === 'save_feedback') {
      const projectId = Number(req.body?.project_id || req.body?.projectId);
      const draftId = Number(req.body?.draft_id || req.body?.draftId);
      const note = cleanText(req.body?.note, 5000);
      const appliesTo = cleanText(req.body?.applies_to || req.body?.appliesTo || 'general', 80) || 'general';
      const rating = cleanText(req.body?.rating, 80);
      if (!Number.isFinite(projectId) || !note) {
        return res.status(400).json({ error: 'projectId and note required' });
      }
      const [project] = await sql`SELECT id FROM content_projects WHERE id = ${projectId}`;
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const [feedback] = await sql`
        INSERT INTO content_feedback (project_id, draft_id, applies_to, note, rating, created_by)
        VALUES (
          ${projectId},
          ${Number.isFinite(draftId) ? draftId : null},
          ${appliesTo},
          ${note},
          ${rating || null},
          ${access.userId}
        )
        RETURNING *
      `;
      await sql`UPDATE content_projects SET updated_at = now() WHERE id = ${projectId}`;
      return res.json({ feedback });
    }

    if (action === 'delete') {
      const id = Number(req.body?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
      const [project] = await sql`DELETE FROM content_projects WHERE id = ${id} RETURNING id, title`;
      if (!project) return res.status(404).json({ error: 'Project not found' });
      return res.json({ ok: true, deleted: project });
    }

    if (action === 'archive') {
      const id = Number(req.body?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
      const [project] = await sql`
        UPDATE content_projects
        SET status = 'archived', updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!project) return res.status(404).json({ error: 'Project not found' });
      return res.json({ project });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
