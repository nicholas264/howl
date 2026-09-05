export async function saveSessionEdits(sql, id, set, expectedRevision) {
  const settings = set.settings && typeof set.settings === 'object' && !Array.isArray(set.settings)
    ? Object.fromEntries(Object.entries(set.settings).filter(([key]) => !key.startsWith('remotion_'))) : {};
      const [saved] = await sql`
        UPDATE ugc_sessions SET
          title = CASE WHEN ${Object.hasOwn(set, 'title')} THEN ${set.title ?? null} ELSE title END,
          duration = CASE WHEN ${Object.hasOwn(set, 'duration')} THEN ${set.duration ?? null} ELSE duration END,
          words = CASE WHEN ${Object.hasOwn(set, 'words')} THEN ${JSON.stringify(set.words ?? null)}::jsonb ELSE words END,
          audio_url = CASE WHEN ${Object.hasOwn(set, 'audio_url')} THEN ${set.audio_url ?? null} ELSE audio_url END,
          thumbnail_url = CASE WHEN ${Object.hasOwn(set, 'thumbnail_url')} THEN ${set.thumbnail_url ?? null} ELSE thumbnail_url END,
          status = CASE WHEN ${Object.hasOwn(set, 'status')} THEN ${set.status ?? null} ELSE status END,
          creator_id = CASE WHEN ${Object.hasOwn(set, 'creator_id')} THEN ${Number(set.creator_id) || null} ELSE creator_id END,
          source_type = CASE WHEN ${Object.hasOwn(set, 'source_type')} THEN ${set.source_type ?? null} ELSE source_type END,
          source_label = CASE WHEN ${Object.hasOwn(set, 'source_label')} THEN ${set.source_label ?? null} ELSE source_label END,
          brief_id = CASE WHEN ${Object.hasOwn(set, 'brief_id')} THEN ${Number(set.brief_id) || null} ELSE brief_id END,
          deliverable_id = CASE WHEN ${Object.hasOwn(set, 'deliverable_id')} THEN ${Number(set.deliverable_id) || null} ELSE deliverable_id END,
          settings = CASE WHEN ${Object.hasOwn(set, 'settings')}
            THEN COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(settings)}::jsonb ELSE settings END,
          revision = revision + 1, updated_at = now()
        WHERE id = ${id} AND revision = ${expectedRevision}
        RETURNING id
      `;
  return saved || null;
}
