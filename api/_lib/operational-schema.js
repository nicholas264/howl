// Release migration only: application requests must not create schema.
export async function ensureOperationalTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS meta_cache (
      key        TEXT PRIMARY KEY,
      payload    JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      usage      JSONB
    )
  `;
  await sql`
          CREATE TABLE IF NOT EXISTS forecast_cache (
            key        TEXT PRIMARY KEY,
            value      JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `;
  await sql`
    CREATE TABLE IF NOT EXISTS dashboard_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
      CREATE TABLE IF NOT EXISTS creative_analysis_cron_slots (
        run_key TEXT PRIMARY KEY,
        run_date DATE NOT NULL DEFAULT CURRENT_DATE,
        run_hour INTEGER,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        processed INTEGER NOT NULL DEFAULT 0
      )
    `;
  await sql`ALTER TABLE creative_analysis_cron_slots ADD COLUMN IF NOT EXISTS lease_token TEXT`;
}
