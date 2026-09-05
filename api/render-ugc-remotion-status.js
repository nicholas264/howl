import { completeRender } from './_lib/render-completion.js';
import { getRenderProgress } from '@remotion/lambda/client';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { remotionConfig } from './_lib/ugc-remotion.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = Number(req.query?.session_id);
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const lambda = remotionConfig();
  if (!lambda.configured) {
    return res.status(409).json({
      error: `Remotion Lambda is not configured. Missing: ${lambda.missing.join(', ')}`,
      setup_required: true,
      missing: lambda.missing,
    });
  }

  const { sql } = access;
  await ensureCreatorOpsTables(sql);
  const [session] = await sql`
    SELECT id, settings, creator_id, deliverable_id
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const renderState = session.settings?.remotion_render || {};
  for (const key of ['render_id', 'bucket_name', 'function_name', 'region']) {
    if (req.query?.[key] && req.query[key] !== renderState[key]) {
      return res.status(409).json({ error: 'This render is no longer current. Reload the session.' });
    }
  }
  const renderId = renderState.render_id;
  const bucketName = renderState.bucket_name;
  const functionName = renderState.function_name;
  const region = renderState.region;
  if (!renderId || !bucketName || !functionName || !region) {
    return res.status(400).json({ error: 'No Remotion render is attached to this session' });
  }

  try {
    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName,
      region,
    });
    if (progress.fatalErrorEncountered) {
      const message = (progress.errors?.[0]?.message || 'Remotion render failed').slice(0, 2000);
      await sql`
        UPDATE ugc_sessions
        SET status = 'render_error', last_error = ${message}, updated_at = now()
        WHERE id = ${sessionId} AND settings->'remotion_render'->>'render_id' = ${renderId}
      `.catch(() => {});
      return res.status(500).json({ error: message, progress });
    }
    if (progress.done && progress.outputFile) {
      const saved = await completeRender(sql, sessionId, renderState, progress.outputFile, progress.costs);
      if (!saved) return res.status(409).json({ error: 'A newer render has started. Reload the session.' });
    }

    return res.json({
      ok: true,
      done: progress.done,
      output_file: progress.outputFile || null,
      progress: progress.overallProgress || 0,
      render_id: renderId,
      bucket_name: bucketName,
      costs: progress.costs || null,
      render_label: renderState.render_label || null,
      render_key: renderState.render_key || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not fetch Remotion render progress' });
  }
}
