export async function ensureCreativeAssetTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS creative_assets (
      id                   BIGSERIAL PRIMARY KEY,
      drive_file_id        TEXT UNIQUE,
      drive_file_name      TEXT,
      drive_folder_path    TEXT,
      mime_type            TEXT,
      file_size            BIGINT,
      width                INTEGER,
      height               INTEGER,
      drive_created_at     TIMESTAMPTZ,
      drive_modified_at    TIMESTAMPTZ,
      drive_web_view_url   TEXT,
      drive_thumbnail_url  TEXT,
      durable_url          TEXT,
      meta_video_id        TEXT,
      meta_image_hash      TEXT,
      ad_id                TEXT,
      placement_role       TEXT,
      group_key            TEXT,
      creator              TEXT,
      product_id           TEXT,
      angle_id             TEXT,
      transcript           TEXT,
      transcript_status    TEXT NOT NULL DEFAULT 'pending',
      transcript_error     TEXT,
      analyzed_at          TIMESTAMPTZ,
      first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_ad_id ON creative_assets(ad_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_group_key ON creative_assets(group_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_meta_video ON creative_assets(meta_video_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_creative_assets_meta_image ON creative_assets(meta_image_hash)`;
}

export async function backfillCreativeAssetsFromLaunchHistory(sql) {
  await ensureCreativeAssetTables(sql);
  await sql`
    INSERT INTO creative_assets
      (drive_file_id, drive_file_name, mime_type, durable_url, ad_id,
       meta_video_id, meta_image_hash, group_key, creator, product_id, angle_id,
       placement_role, updated_at)
    SELECT DISTINCT ON (lh.drive_file_id)
      lh.drive_file_id,
      lh.drive_file_name,
      lh.mime_type,
      lh.source_video_url,
      lh.ad_id,
      cp.video_id,
      cp.image_hash,
      cp.group_key,
      lh.creator,
      lh.product_id,
      lh.angle_id,
      'historical',
      now()
    FROM launch_history lh
    LEFT JOIN creative_performance cp ON cp.ad_id = lh.ad_id
    WHERE lh.drive_file_id IS NOT NULL
    ORDER BY lh.drive_file_id, lh.launched_at DESC
    ON CONFLICT (drive_file_id) DO UPDATE SET
      drive_file_name = COALESCE(EXCLUDED.drive_file_name, creative_assets.drive_file_name),
      mime_type = COALESCE(EXCLUDED.mime_type, creative_assets.mime_type),
      durable_url = COALESCE(EXCLUDED.durable_url, creative_assets.durable_url),
      ad_id = COALESCE(EXCLUDED.ad_id, creative_assets.ad_id),
      meta_video_id = COALESCE(EXCLUDED.meta_video_id, creative_assets.meta_video_id),
      meta_image_hash = COALESCE(EXCLUDED.meta_image_hash, creative_assets.meta_image_hash),
      group_key = COALESCE(EXCLUDED.group_key, creative_assets.group_key),
      creator = COALESCE(EXCLUDED.creator, creative_assets.creator),
      product_id = COALESCE(EXCLUDED.product_id, creative_assets.product_id),
      angle_id = COALESCE(EXCLUDED.angle_id, creative_assets.angle_id),
      updated_at = now()
  `;
}

export async function upsertDriveAsset(sql, file, folderPath = '', ensureTable = true) {
  if (ensureTable) await ensureCreativeAssetTables(sql);
  const video = file.videoMediaMetadata || {};
  const image = file.imageMediaMetadata || {};
  const width = parseInt(video.width || image.width || 0, 10) || null;
  const height = parseInt(video.height || image.height || 0, 10) || null;
  const [row] = await sql`
    INSERT INTO creative_assets
      (drive_file_id, drive_file_name, drive_folder_path, mime_type, file_size,
       width, height, drive_created_at, drive_modified_at, drive_web_view_url,
       drive_thumbnail_url, updated_at)
    VALUES
      (${file.id}, ${file.name || null}, ${folderPath || null}, ${file.mimeType || null},
       ${file.size ? parseInt(file.size, 10) : null}, ${width}, ${height},
       ${file.createdTime || null}, ${file.modifiedTime || null}, ${file.webViewLink || null},
       ${file.thumbnailLink || null}, now())
    ON CONFLICT (drive_file_id) DO UPDATE SET
      drive_file_name = EXCLUDED.drive_file_name,
      drive_folder_path = EXCLUDED.drive_folder_path,
      mime_type = EXCLUDED.mime_type,
      file_size = EXCLUDED.file_size,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      drive_modified_at = EXCLUDED.drive_modified_at,
      drive_web_view_url = EXCLUDED.drive_web_view_url,
      drive_thumbnail_url = EXCLUDED.drive_thumbnail_url,
      updated_at = now()
    RETURNING *
  `;
  return row;
}

export async function markCreativeAssetLaunched(sql, {
  driveFileId,
  durableUrl,
  metaVideoId,
  metaImageHash,
  adId,
  placementRole,
  groupKey,
  creator,
  productId,
  angleId,
}) {
  await ensureCreativeAssetTables(sql);
  const [row] = await sql`
    UPDATE creative_assets SET
      durable_url = COALESCE(${durableUrl || null}, durable_url),
      meta_video_id = COALESCE(${metaVideoId || null}, meta_video_id),
      meta_image_hash = COALESCE(${metaImageHash || null}, meta_image_hash),
      ad_id = COALESCE(${adId || null}, ad_id),
      placement_role = COALESCE(${placementRole || null}, placement_role),
      group_key = COALESCE(${groupKey || metaVideoId || metaImageHash || null}, group_key),
      creator = COALESCE(${creator || null}, creator),
      product_id = COALESCE(${productId || null}, product_id),
      angle_id = COALESCE(${angleId || null}, angle_id),
      updated_at = now()
    WHERE drive_file_id = ${driveFileId}
    RETURNING *
  `;
  return row || null;
}
