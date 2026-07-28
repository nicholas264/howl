let creativeAuditReady = null;

export async function createCreativeAuditTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS creative_operator_events (
      id           BIGSERIAL PRIMARY KEY,
      event_type   TEXT NOT NULL,
      group_key    TEXT,
      group_name   TEXT,
      creator_id   BIGINT,
      creator_name TEXT,
      source_type  TEXT,
      source_label TEXT,
      metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
      user_id      TEXT,
      user_email   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_operator_events_created_at ON creative_operator_events(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_operator_events_group_key ON creative_operator_events(group_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_operator_events_type ON creative_operator_events(event_type)`;
}

export async function ensureCreativeAuditTables(sql) {
  if (!creativeAuditReady) creativeAuditReady = createCreativeAuditTables(sql);
  try {
    await creativeAuditReady;
  } catch (err) {
    creativeAuditReady = null;
    throw err;
  }
}

export async function resolveCreativeGroupName(sql, groupKey) {
  if (!groupKey) return null;
  const [row] = await sql`
    SELECT ad_name
    FROM creative_performance
    WHERE group_key = ${groupKey}
      AND ad_name IS NOT NULL
    ORDER BY created_time DESC NULLS LAST, synced_at DESC NULLS LAST
    LIMIT 1
  `;
  return row?.ad_name || null;
}

export async function logCreativeOperatorEvent(sql, event) {
  await ensureCreativeAuditTables(sql);
  const groupName = event.groupName || await resolveCreativeGroupName(sql, event.groupKey);
  const [row] = await sql`
    INSERT INTO creative_operator_events
      (event_type, group_key, group_name, creator_id, creator_name, source_type, source_label, metadata, user_id, user_email)
    VALUES
      (${event.eventType}, ${event.groupKey || null}, ${groupName}, ${event.creatorId || null}, ${event.creatorName || null},
       ${event.sourceType || null}, ${event.sourceLabel || null}, ${JSON.stringify(event.metadata || {})}::jsonb,
       ${event.userId || null}, ${event.userEmail || null})
    RETURNING *
  `;
  return row;
}
