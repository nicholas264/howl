let creativeEvidenceTasksReady = null;

export async function createCreativeEvidenceTaskTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS creative_evidence_tasks (
      group_key    TEXT NOT NULL,
      task_type    TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open',
      owner        TEXT,
      note         TEXT,
      due_date     DATE,
      group_name   TEXT,
      spend        NUMERIC(14,4),
      updated_by   TEXT,
      updated_email TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_key, task_type)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_evidence_tasks_status ON creative_evidence_tasks(task_type, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_evidence_tasks_updated ON creative_evidence_tasks(updated_at DESC)`;
}

export async function ensureCreativeEvidenceTaskTables(sql) {
  if (!creativeEvidenceTasksReady) creativeEvidenceTasksReady = createCreativeEvidenceTaskTables(sql);
  try {
    await creativeEvidenceTasksReady;
  } catch (err) {
    creativeEvidenceTasksReady = null;
    throw err;
  }
}

export function normalizeEvidenceTaskType(value) {
  const taskType = (value || '').toString().trim();
  return ['transcript', 'source_review'].includes(taskType) ? taskType : null;
}

export function normalizeEvidenceTaskStatus(value) {
  const status = (value || '').toString().trim();
  return ['open', 'in_progress', 'waiting', 'blocked', 'done'].includes(status) ? status : 'open';
}

export async function upsertCreativeEvidenceTask(sql, {
  groupKey,
  taskType,
  status,
  owner,
  note,
  dueDate,
  groupName,
  spend,
  userId,
  userEmail,
}) {
  await ensureCreativeEvidenceTaskTables(sql);
  const normalizedTaskType = normalizeEvidenceTaskType(taskType);
  if (!groupKey || !normalizedTaskType) throw new Error('groupKey and valid taskType are required');
  const normalizedStatus = normalizeEvidenceTaskStatus(status);
  const [row] = await sql`
    INSERT INTO creative_evidence_tasks
      (group_key, task_type, status, owner, note, due_date, group_name, spend, updated_by, updated_email, updated_at)
    VALUES
      (${groupKey}, ${normalizedTaskType}, ${normalizedStatus}, ${owner || null}, ${note || null},
       ${dueDate || null}, ${groupName || null}, ${spend == null ? null : spend}, ${userId || null}, ${userEmail || null}, now())
    ON CONFLICT (group_key, task_type) DO UPDATE SET
      status = EXCLUDED.status,
      owner = EXCLUDED.owner,
      note = EXCLUDED.note,
      due_date = EXCLUDED.due_date,
      group_name = COALESCE(EXCLUDED.group_name, creative_evidence_tasks.group_name),
      spend = COALESCE(EXCLUDED.spend, creative_evidence_tasks.spend),
      updated_by = EXCLUDED.updated_by,
      updated_email = EXCLUDED.updated_email,
      updated_at = now()
    RETURNING *
  `;
  return row;
}
