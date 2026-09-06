import { randomUUID } from 'node:crypto';
export async function ensureCreativeAnalysisQueue(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS creative_analysis_queue (
      group_key       TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'pending',
      priority        NUMERIC(14,4) NOT NULL DEFAULT 0,
      source          TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 3,
      last_error      TEXT,
      available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE creative_analysis_queue ADD COLUMN IF NOT EXISTS lease_token TEXT`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_creative_analysis_queue_claim
    ON creative_analysis_queue(status, available_at, priority DESC)
  `;
  await sql`
    INSERT INTO creative_analysis_queue
      (group_key, status, source, attempts, completed_at, created_at, updated_at)
    SELECT group_key, 'completed', 'historical', 1, generated_at, generated_at, now()
    FROM creative_analysis
    ON CONFLICT (group_key) DO NOTHING
  `;
}

export async function enqueueCreativeAnalyses(sql, source = 'meta_sync') {
  await ensureCreativeAnalysisQueue(sql);
  // Additive reconciliation: launches may not yet exist in performance ingestion.
  const rows = await sql`
    WITH latest AS (
      SELECT max(date)::date AS max_date FROM creative_insights_daily
    ),
    metrics AS (
      SELECT
        cp.group_key,
        COALESCE(SUM(i.spend), 0)::numeric AS spend,
        COALESCE(SUM(i.purchase_value), 0)::numeric AS purchase_value,
        COALESCE(SUM(i.purchases), 0)::bigint AS purchases,
        EXISTS (
          SELECT 1 FROM creative_assets a WHERE a.group_key = cp.group_key
        ) AS has_drive_asset
      FROM creative_performance cp
      LEFT JOIN creative_insights_daily i
        ON i.ad_id = cp.ad_id
       AND i.date >= (SELECT max_date - interval '30 days' FROM latest)
      LEFT JOIN creative_analysis ca ON ca.group_key = cp.group_key
      WHERE cp.group_key IS NOT NULL
        AND ca.group_key IS NULL
      GROUP BY cp.group_key
    )
    INSERT INTO creative_analysis_queue (group_key, priority, source, status, available_at, updated_at)
    SELECT
      group_key,
      spend + CASE WHEN has_drive_asset THEN 1000000 ELSE 0 END,
      ${source},
      'pending',
      now(),
      now()
    FROM metrics
    WHERE has_drive_asset
       OR spend > 0
       OR (purchases >= 2 AND spend > 0 AND purchase_value / spend >= 2)
    ON CONFLICT (group_key) DO UPDATE SET
      priority = GREATEST(creative_analysis_queue.priority, EXCLUDED.priority),
      source = CASE WHEN creative_analysis_queue.status = 'processing' THEN creative_analysis_queue.source ELSE EXCLUDED.source END,
      status = CASE
        WHEN creative_analysis_queue.status = 'completed' THEN 'pending'
        ELSE creative_analysis_queue.status
      END,
      available_at = CASE
        WHEN creative_analysis_queue.status = 'completed' THEN now()
        ELSE creative_analysis_queue.available_at
      END,
      updated_at = now()
    RETURNING group_key
  `;
  return rows.length;
}

export async function enqueueCreativeAssetAnalysis(sql, groupKey, source = 'launch') {
  if (!groupKey) return 0;
  await ensureCreativeAnalysisQueue(sql);
  const rows = await sql`
    INSERT INTO creative_analysis_queue (group_key, priority, source, status, available_at, updated_at)
    VALUES (${groupKey}, 1000000, ${source}, 'pending', now(), now())
    ON CONFLICT (group_key) DO UPDATE SET
      priority = GREATEST(creative_analysis_queue.priority, EXCLUDED.priority),
      source = CASE WHEN creative_analysis_queue.status = 'processing' THEN creative_analysis_queue.source ELSE EXCLUDED.source END,
      status = CASE
        WHEN creative_analysis_queue.status IN ('completed', 'failed') THEN 'pending'
        ELSE creative_analysis_queue.status
      END,
      available_at = CASE
        WHEN creative_analysis_queue.status IN ('completed', 'failed') THEN now()
        ELSE creative_analysis_queue.available_at
      END,
      attempts = CASE WHEN creative_analysis_queue.status IN ('completed', 'failed') THEN 0 ELSE creative_analysis_queue.attempts END,
      last_error = CASE
        WHEN creative_analysis_queue.status = 'failed' THEN NULL
        ELSE creative_analysis_queue.last_error
      END,
      updated_at = now()
    RETURNING group_key
  `;
  return rows.length;
}

// Manual requests share the worker lease instead of bypassing queue ownership.
export async function claimManualCreativeAnalysis(sql, groupKey) {
  await ensureCreativeAnalysisQueue(sql);
  const [job] = await sql`
    INSERT INTO creative_analysis_queue
      (group_key,status,source,attempts,lease_token,started_at,available_at,updated_at)
    VALUES (${groupKey},'processing','manual',1,${randomUUID()},now(),now(),now())
    ON CONFLICT (group_key) DO UPDATE SET
      status='processing',source='manual',attempts=1,lease_token=EXCLUDED.lease_token,
      started_at=now(),available_at=now(),updated_at=now(),last_error=NULL
    WHERE creative_analysis_queue.status <> 'processing'
      OR creative_analysis_queue.started_at < now()-interval '15 minutes'
    RETURNING *
  `;
  return job || null;
}

export async function claimCreativeAnalysisJob(sql) {
  await ensureCreativeAnalysisQueue(sql);
  await sql`
    UPDATE creative_analysis_queue
    SET status = CASE WHEN source = 'manual' OR attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        available_at = now(),
        started_at = NULL,
        lease_token = NULL,
        last_error = COALESCE(last_error, 'Worker lease expired'),
        updated_at = now()
    WHERE status = 'processing'
      AND started_at < now() - interval '15 minutes'
  `;
  const [job] = await sql`
    UPDATE creative_analysis_queue q
    SET status = 'processing',
        attempts = q.attempts + 1,
        lease_token = ${randomUUID()},
        started_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE q.group_key = (
      SELECT group_key
      FROM creative_analysis_queue
      WHERE status = 'pending'
        AND available_at <= now()
        AND attempts < max_attempts
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return job || null;
}

export async function completeCreativeAnalysisJob(sql, groupKey, job = null) {
  if (job) {
    const rows = await sql`
      UPDATE creative_analysis_queue SET status = 'completed', last_error = NULL, completed_at = now(), lease_token = NULL, updated_at = now()
      WHERE group_key = ${groupKey} AND status = 'processing' AND lease_token = ${job.lease_token}
      RETURNING group_key
    `;
    return rows.length === 1;
  }
  await ensureCreativeAnalysisQueue(sql);
  await sql`
    INSERT INTO creative_analysis_queue
      (group_key, status, source, attempts, completed_at, updated_at)
    VALUES (${groupKey}, 'completed', 'manual', 1, now(), now())
    ON CONFLICT (group_key) DO UPDATE SET
      status = 'completed',
      last_error = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE creative_analysis_queue.status <> 'processing'
  `;
}

export async function failCreativeAnalysisJob(sql, job, error) {
  const retryDelayMinutes = Math.min(60, 5 * (2 ** Math.max(0, job.attempts - 1)));
  const exhausted = job.attempts >= job.max_attempts;
  await sql`
    UPDATE creative_analysis_queue
    SET status = ${exhausted ? 'failed' : 'pending'},
        last_error = ${String(error || 'Unknown analysis error').slice(0, 4000)},
        available_at = now() + (${exhausted ? 0 : retryDelayMinutes} || ' minutes')::interval,
        started_at = NULL,
        updated_at = now()
    WHERE group_key = ${job.group_key}
      AND status = 'processing' AND lease_token = ${job.lease_token}
  `;
  return exhausted ? 'failed' : 'retrying';
}

export async function retryFailedCreativeAnalysisJobs(sql) {
  await ensureCreativeAnalysisQueue(sql);
  const rows = await sql`
    UPDATE creative_analysis_queue
    SET status = 'pending',
        attempts = 0,
        lease_token = NULL,
        last_error = NULL,
        available_at = now(),
        started_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE status = 'failed'
    RETURNING group_key
  `;
  return rows.length;
}

export async function getCreativeAnalysisQueueStatus(sql) {
  await ensureCreativeAnalysisQueue(sql);
  const counts = await sql`
    SELECT status, COUNT(*)::int AS count
    FROM creative_analysis_queue
    GROUP BY status
  `;
  const recent = await sql`
    SELECT
      q.group_key, q.status, q.priority::float, q.attempts, q.max_attempts,
      q.last_error, q.available_at, q.started_at, q.completed_at, q.updated_at,
      COALESCE(
        (SELECT ad_name FROM creative_performance cp
         WHERE cp.group_key = q.group_key
         ORDER BY cp.created_time ASC LIMIT 1),
        (SELECT drive_file_name FROM creative_assets a
         WHERE a.group_key = q.group_key
            OR a.ad_id = q.group_key
            OR a.meta_video_id = q.group_key
            OR a.meta_image_hash = q.group_key
         ORDER BY (a.placement_role = 'feed') DESC, a.updated_at DESC
         LIMIT 1)
      ) AS name
    FROM creative_analysis_queue q
    ORDER BY
      CASE q.status
        WHEN 'processing' THEN 0
        WHEN 'failed' THEN 1
        WHEN 'pending' THEN 2
        ELSE 3
      END,
      q.updated_at DESC
    LIMIT 12
  `;
  const [throughput] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '24 hours')::int AS completed_24h,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '7 days')::int AS completed_7d,
      MAX(completed_at) FILTER (WHERE status = 'completed') AS last_completed_at,
      MIN(available_at) FILTER (WHERE status = 'pending') AS next_available_at
    FROM creative_analysis_queue
  `;
  const summary = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of counts) summary[row.status] = Number(row.count) || 0;
  const completed24h = Number(throughput?.completed_24h || 0);
  const completed7d = Number(throughput?.completed_7d || 0);
  const dailyRate = Math.max(completed24h, completed7d > 0 ? completed7d / 7 : 0);
  const etaDays = summary.pending > 0 && dailyRate > 0 ? Math.ceil(summary.pending / dailyRate) : null;
  return {
    summary,
    recent,
    throughput: {
      completed24h,
      completed7d,
      dailyRate: Number(dailyRate.toFixed(1)),
      etaDays,
      lastCompletedAt: throughput?.last_completed_at || null,
      nextAvailableAt: throughput?.next_available_at || null,
    },
  };
}
