import { finishWork } from './work-controls.js';
import { completeRender } from './render-completion.js';

export async function recoverRenders(sql, getProgress) {
  // Unknown starts cannot safely be retried: a provider might have accepted the
  // request before its response was lost. Make that state visible to operators.
  const unknown = await sql`
    UPDATE ugc_sessions SET status = 'render_unknown',
      last_error = 'Render start receipt was lost. Provider reconciliation is required before retrying.', updated_at = now()
    WHERE status = 'rendering' AND settings->'remotion_render'->>'provider' = 'starting'
      AND COALESCE((settings->'remotion_render'->>'started_at')::timestamptz, updated_at) < now()-interval '5 minutes'
    RETURNING id
  `;
  const sessions = await sql`
    SELECT id, settings FROM ugc_sessions
    WHERE status = 'rendering' AND settings->'remotion_render'->>'render_id' IS NOT NULL
    ORDER BY updated_at ASC LIMIT 20
  `;
  const results = unknown.map(row => ({ id: row.id, status: 'unknown' }));
  for (const session of sessions) {
    const state = session.settings.remotion_render;
    try {
      const progress = await getProgress({ renderId: state.render_id, bucketName: state.bucket_name,
        functionName: state.function_name, region: state.region });
      if (progress.fatalErrorEncountered) {
        await sql`UPDATE ugc_sessions SET status = 'render_error', last_error = ${(progress.errors?.[0]?.message || 'Render failed').slice(0, 2000)}, updated_at = now()
          WHERE id = ${session.id} AND settings->'remotion_render'->>'render_id' = ${state.render_id}`;
        if (state.work_id) await finishWork(sql,state.work_id,'render',500);
        results.push({ id: session.id, status: 'failed' });
      } else if (progress.done && progress.outputFile) {
        const saved = await completeRender(sql, session.id, state, progress.outputFile, progress.costs);
        results.push({ id: session.id, status: saved ? 'completed' : 'superseded' });
      } else {
        await sql`UPDATE ugc_sessions SET updated_at = now() WHERE id = ${session.id} AND status = 'rendering'
          AND settings->'remotion_render'->>'render_id' = ${state.render_id}`;
        results.push({ id: session.id, status: 'rendering' });
      }
    } catch (error) {
      // Rotate the polling order even when a provider is unavailable, so one
      // batch cannot permanently starve later sessions.
      await sql`UPDATE ugc_sessions SET updated_at = now() WHERE id = ${session.id} AND status = 'rendering'
        AND settings->'remotion_render'->>'render_id' = ${state.render_id}`;
      results.push({ id: session.id, status: 'poll_error', error: error.message });
    }
  }
  return results;
}
