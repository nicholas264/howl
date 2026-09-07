export async function ensureLibrarySchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS image_library (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT,
      url        TEXT NOT NULL,
      file_name  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_image_library_user ON image_library(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_image_library_created_at ON image_library(created_at DESC)`;
  await sql`ALTER TABLE copy_library ADD COLUMN IF NOT EXISTS product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_type TEXT`;
  await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_label TEXT`;
}


export async function ensureDriveLibrarySchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS ugc_asset_pairs (
      id BIGSERIAL PRIMARY KEY,
      feed_file_id TEXT NOT NULL,
      story_file_id TEXT NOT NULL,
      created_by_user_id TEXT,
      created_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ugc_asset_pairs_distinct_files CHECK (feed_file_id <> story_file_id)
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ugc_asset_pairs_feed_idx ON ugc_asset_pairs(feed_file_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ugc_asset_pairs_story_idx ON ugc_asset_pairs(story_file_id)`;
  await sql`CREATE TABLE IF NOT EXISTS ugc_hidden (file_id TEXT PRIMARY KEY, hidden_at TIMESTAMPTZ DEFAULT NOW())`;
}
