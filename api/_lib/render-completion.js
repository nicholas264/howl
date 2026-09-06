import { finishWork } from './work-controls.js';
export async function completeRender(sql, sessionId, renderState, outputFile, costs) {
  const entry = {
    provider: 'remotion_lambda', render_key: renderState.render_key || 'polished',
    render_label: renderState.render_label || 'Polished ad', render_id: renderState.render_id,
    output_file: outputFile, region: renderState.region,
    duration_in_frames: renderState.duration_in_frames || null, rendered_at: new Date().toISOString(),
    costs: costs || null, settings: renderState.input?.settings || null,
  };
  const [saved] = await sql`
    WITH saved AS (
      UPDATE ugc_sessions u SET rendered_url = ${outputFile}, status = 'rendered', last_error = NULL,
        settings = jsonb_set(COALESCE(u.settings, '{}'::jsonb), '{remotion_renders}',
          jsonb_build_array(${JSON.stringify(entry)}::jsonb) || COALESCE((
            SELECT jsonb_agg(item ORDER BY ordinal) FROM (
              SELECT item, ordinal FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(u.settings->'remotion_renders') = 'array' THEN u.settings->'remotion_renders' ELSE '[]'::jsonb END
              ) WITH ORDINALITY AS history(item, ordinal)
              WHERE item->>'render_id' IS DISTINCT FROM ${renderState.render_id}
                AND item->>'output_file' IS DISTINCT FROM ${outputFile}
              ORDER BY ordinal LIMIT 11
            ) prior
          ), '[]'::jsonb)), updated_at = now()
      WHERE u.id = ${sessionId} AND u.settings->'remotion_render'->>'render_id' = ${renderState.render_id}
      RETURNING id, creator_id, deliverable_id
    ), deliverable_update AS (
      UPDATE creator_deliverables d SET output_url = ${outputFile}, status = 'edited',
        completed_asset_count = GREATEST(completed_asset_count, 1),
        completed_at = COALESCE(completed_at, now()), updated_at = now()
      FROM saved WHERE d.id = saved.deliverable_id AND d.creator_id = saved.creator_id
        AND d.status IN ('requested', 'received', 'editing', 'edited')
    ) SELECT id FROM saved
  `;
  if (saved && renderState.work_id) await finishWork(sql,renderState.work_id,'render',200,
    {provider:'remotion',costUsd:Number.isFinite(costs?.accruedSoFar) ? costs.accruedSoFar : null});
  return saved || null;
}
