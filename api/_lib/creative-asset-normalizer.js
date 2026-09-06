import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegPath from 'ffmpeg-static';
import { ensureCreativeAssetTables } from './creative-assets.js';
import { getGoogleAccessToken } from './gcp-auth.js';
import { fetchPublicResource } from './safe-fetch.js';
import { boundedWork, workSignal, checkWork, workFetch as fetch } from './bounded-work.js';
import { writeFile } from 'node:fs/promises';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)(\?|$)/i;

const sanitize = (name) =>
  (name || 'asset').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'asset';

function statusBody(status, body) {
  return { status, body };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    checkWork();
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], signal:workSignal(),killSignal:'SIGKILL' });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr+chunk.toString()).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(stderr)
      : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-1800)}`)));
  });
}

async function downloadToTemp({ url, driveFileId, fileName }) {
  let response;
  if (driveFileId) {
    const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/drive.readonly']);
    response = await fetch(`${DRIVE}/files/${driveFileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    const media=await fetchPublicResource(url,{maxBytes:256*1024*1024,timeoutMs:60000,contentTypes:/^(video\/|application\/octet-stream)/i});
    checkWork();
    const path=join(tmpdir(),`creative-normalize-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    await writeFile(path,media.bytes);
    return {path,contentType:media.contentType};
  }
  if (!response.ok || !response.body) throw new Error(`source fetch failed: HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  const ext = extname((fileName || '').split('?')[0]) || (type.includes('quicktime') ? '.mov' : type.includes('webm') ? '.webm' : '.mp4');
  const path = join(tmpdir(), `creative-normalize-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  let bytes=0;
  try {
    await pipeline(Readable.fromWeb(response.body),async function* (source){for await(const chunk of source){bytes+=chunk.length;
      if(bytes>256*1024*1024)throw new Error('Normalization source exceeds 256 MB');yield chunk;}},createWriteStream(path),{signal:workSignal()});
  } catch(error){try{unlinkSync(path);}catch{}throw error;}
  return { path, contentType: type };
}

async function uploadFile(path, key, contentType) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN not configured');
  const { url } = await put(key, createReadStream(path), {
    access: 'public',
    contentType,
    addRandomSuffix: true,
    abortSignal:workSignal(),
  });
  return url;
}

async function resolveMetaVideoSource({ videoId, ctx }) {
  if (!videoId || !ctx?.BASE || !ctx?.accessToken) return null;
  const { BASE, accessToken, adAccountId } = ctx;
  const direct = await fetch(`${BASE}/${videoId}?fields=source,picture,format,permalink_url,embed_html&access_token=${accessToken}`);
  const directData = await direct.json();
  if (directData?.source) return { url: directData.source, posterUrl: directData.picture || null, note: 'meta video source' };
  if (directData?.embed_html) {
    const match = directData.embed_html.match(/src=["']([^"']+\.mp4[^"']*)["']/i);
    if (match) return { url: match[1].replace(/&amp;/g, '&'), posterUrl: directData.picture || null, note: 'meta embed html mp4' };
  }
  if (adAccountId) {
    try {
      const fallback = await fetch(`${BASE}/${adAccountId}/advideos?ids=${encodeURIComponent(videoId)}&fields=source,picture&access_token=${accessToken}`);
      const fallbackData = await fallback.json();
      const inner = fallbackData && fallbackData[videoId];
      if (inner?.source) return { url: inner.source, posterUrl: inner.picture || directData?.picture || null, note: 'meta advideos source' };
    } catch {}
  }
  return directData?.picture ? { url: null, posterUrl: directData.picture, note: 'meta poster only' } : null;
}

async function pickAsset(sql, { groupKey, assetId }) {
  if (assetId) {
    const [asset] = await sql`SELECT * FROM creative_assets WHERE id = ${assetId}`;
    return asset || null;
  }
  const [asset] = await sql`
    SELECT *
    FROM creative_assets
    WHERE group_key = ${groupKey}
       OR ad_id = ${groupKey}
       OR meta_video_id = ${groupKey}
       OR meta_image_hash = ${groupKey}
    ORDER BY
      (COALESCE(playable_url, durable_url) IS NOT NULL) DESC,
      (placement_role = 'feed') DESC,
      updated_at DESC
    LIMIT 1
  `;
  if (asset) return asset;
  const [fromPerformance] = await sql`
    SELECT
      NULL::bigint AS id,
      cp.group_key,
      cp.ad_id,
      cp.ad_name AS drive_file_name,
      cp.video_id AS meta_video_id,
      cp.image_hash AS meta_image_hash,
      cp.thumbnail_url AS preview_url,
      cp.thumbnail_url AS drive_thumbnail_url,
      CASE WHEN cp.video_id IS NOT NULL THEN 'video/mp4' ELSE 'image/jpeg' END AS mime_type,
      NULL::text AS durable_url,
      NULL::text AS playable_url,
      NULL::text AS drive_file_id
    FROM creative_performance cp
    WHERE cp.group_key = ${groupKey}
    ORDER BY cp.created_time ASC
    LIMIT 1
  `;
  return fromPerformance || null;
}

async function markAsset(sql, asset, patch) {
  if (!asset?.id) return null;
  const [row] = await sql`
    UPDATE creative_assets SET
      playable_url = COALESCE(${patch.playableUrl || null}, playable_url),
      preview_url = COALESCE(${patch.previewUrl || null}, preview_url, drive_thumbnail_url),
      playback_status = ${patch.playbackStatus},
      playback_error = ${patch.playbackError || null},
      playback_checked_at = now(),
      duration_seconds = COALESCE(${patch.durationSeconds || null}, duration_seconds),
      mime_type = COALESCE(${patch.mimeType || null}, mime_type),
      updated_at = now()
    WHERE id = ${asset.id}
    RETURNING *
  `;
  return row || null;
}

async function createAssetFromPerformance(sql, asset, patch) {
  if (asset?.id) return markAsset(sql, asset, patch);
  const [row] = await sql`
    INSERT INTO creative_assets
      (drive_file_name, mime_type, durable_url, playable_url, preview_url, ad_id,
       meta_video_id, meta_image_hash, group_key, playback_status, playback_error,
       playback_checked_at, duration_seconds, transcript_status, updated_at)
    VALUES
      (${asset?.drive_file_name || null}, ${patch.mimeType || asset?.mime_type || null}, ${patch.playableUrl || null},
       ${patch.playableUrl || null}, ${patch.previewUrl || asset?.preview_url || asset?.drive_thumbnail_url || null},
       ${asset?.ad_id || null}, ${asset?.meta_video_id || null}, ${asset?.meta_image_hash || null},
       ${asset?.group_key || null}, ${patch.playbackStatus}, ${patch.playbackError || null}, now(),
       ${patch.durationSeconds || null}, 'pending', now())
    RETURNING *
  `;
  return row || null;
}

function parseDuration(ffmpegStderr) {
  const match = String(ffmpegStderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function normalizeCreativeAsset(input) {
  return boundedWork(()=>normalizeCreativeAssetWork(input),240000);
}
async function normalizeCreativeAssetWork({ groupKey, assetId = null, ctx = {} }) {
  if (!process.env.DATABASE_URL) return statusBody(200, { error: 'DATABASE_URL not configured' });
  if (!groupKey && !assetId) return statusBody(400, { error: 'groupKey or assetId required' });
  const database = neon(process.env.DATABASE_URL);
  const sql=(...args)=>{checkWork();return database(...args);};
  await ensureCreativeAssetTables(sql);

  const asset = await pickAsset(sql, { groupKey, assetId });
  if (!asset) return statusBody(404, { error: 'No creative asset found to normalize' });

  const mimeType = (asset.mime_type || '').toLowerCase();
  const isVideo = mimeType.startsWith('video/') || !!asset.meta_video_id || VIDEO_EXT_RE.test(asset.playable_url || asset.durable_url || '');
  const existingPlayable = asset.playable_url || asset.durable_url;
  if (!isVideo) {
    const row = await createAssetFromPerformance(sql, asset, {
      playableUrl: existingPlayable || null,
      previewUrl: asset.preview_url || asset.drive_thumbnail_url || null,
      playbackStatus: 'not-needed',
      playbackError: null,
      mimeType: asset.mime_type || 'image/jpeg',
    });
    return statusBody(200, { ok: true, asset: row, normalized: false, message: 'Static creative does not require video playback.' });
  }

  let sourceUrl = existingPlayable || null;
  let previewUrl = asset.preview_url || asset.drive_thumbnail_url || null;
  let sourceNote = sourceUrl ? 'stored playable/durable URL' : null;
  if (!sourceUrl && asset.meta_video_id) {
    const resolved = await resolveMetaVideoSource({ videoId: asset.meta_video_id, ctx });
    sourceUrl = resolved?.url || null;
    previewUrl = resolved?.posterUrl || previewUrl;
    sourceNote = resolved?.note || sourceNote;
  }

  if (!sourceUrl && !asset.drive_file_id) {
    const row = await createAssetFromPerformance(sql, asset, {
      previewUrl,
      playbackStatus: 'missing',
      playbackError: 'No playable source URL or Drive file is available for this creative.',
      mimeType: asset.mime_type || 'video/mp4',
    });
    return statusBody(200, { ok: false, asset: row, message: 'No playable source URL or Drive file is available.' });
  }

  const tempPaths = [];
  try {
    const source = await downloadToTemp({ url: sourceUrl, driveFileId: sourceUrl ? null : asset.drive_file_id, fileName: asset.drive_file_name || basename(sourceUrl || 'creative.mp4') });
    tempPaths.push(source.path);
    const outputPath = join(tmpdir(), `creative-playable-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    const posterPath = join(tmpdir(), `creative-poster-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    tempPaths.push(outputPath, posterPath);

    const probeOutput = await runFfmpeg(['-hide_banner', '-i', source.path, '-f', 'null', '-']);
    const durationSeconds = parseDuration(probeOutput);
    await runFfmpeg([
      '-y', '-i', source.path,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-vf', 'scale=trunc(min(1080\\,iw)/2)*2:-2',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ]);
    await runFfmpeg(['-y', '-ss', durationSeconds && durationSeconds > 2 ? '1' : '0', '-i', source.path, '-frames:v', '1', '-q:v', '3', posterPath]);

    const d = new Date();
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const base = sanitize(asset.drive_file_name || asset.group_key || asset.meta_video_id || 'creative');
    const playableUrl = await uploadFile(outputPath, `creative-renditions/${ym}/${Date.now()}-${base}.mp4`, 'video/mp4');
    let posterUrl = previewUrl;
    if (existsSync(posterPath) && statSync(posterPath).size > 0) {
      posterUrl = await uploadFile(posterPath, `creative-renditions/${ym}/${Date.now()}-${base}.jpg`, 'image/jpeg');
    }

    const row = await createAssetFromPerformance(sql, asset, {
      playableUrl,
      previewUrl: posterUrl,
      playbackStatus: 'ready',
      playbackError: null,
      durationSeconds,
      mimeType: 'video/mp4',
    });
    return statusBody(200, {
      ok: true,
      normalized: true,
      asset: row,
      source: sourceNote || (asset.drive_file_id ? 'google drive' : 'source URL'),
      playableUrl,
      previewUrl: posterUrl,
      durationSeconds,
    });
  } catch (err) {
    const row = await createAssetFromPerformance(sql, asset, {
      previewUrl,
      playbackStatus: 'error',
      playbackError: err.message,
      mimeType: asset.mime_type || 'video/mp4',
    });
    return statusBody(200, { ok: false, asset: row, error: err.message });
  } finally {
    for (const path of tempPaths) {
      try { if (path && existsSync(path)) unlinkSync(path); } catch {}
    }
  }
}

export async function normalizeCreativeAssetBatch({ ctx = {}, limit: rawLimit = 3 } = {}) {
  if (!process.env.DATABASE_URL) return statusBody(200, { error: 'DATABASE_URL not configured' });
  const limit = Math.max(1, Math.min(8, parseInt(rawLimit || 3, 10)));
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAssetTables(sql);
  const rows = await sql`
    WITH asset_candidates AS (
      SELECT DISTINCT ON (COALESCE(group_key, ad_id, meta_video_id, meta_image_hash))
        id,
        COALESCE(group_key, ad_id, meta_video_id, meta_image_hash) AS group_key,
        1000000::numeric AS priority,
        updated_at
      FROM creative_assets
      WHERE (mime_type ILIKE 'video/%' OR durable_url ~* '\\.(mp4|mov|m4v|webm)(\\?|$)' OR meta_video_id IS NOT NULL)
        AND COALESCE(playable_url, durable_url) IS NULL
        AND COALESCE(playback_status, 'unknown') NOT IN ('ready', 'not-needed')
        AND (playback_checked_at IS NULL OR playback_checked_at < now() - interval '7 days')
      ORDER BY COALESCE(group_key, ad_id, meta_video_id, meta_image_hash), updated_at DESC
    ),
    performance_candidates AS (
      SELECT
        NULL::bigint AS id,
        cp.group_key,
        COALESCE(SUM(i.spend), 0)::numeric AS priority,
        MAX(cp.created_time) AS updated_at
      FROM creative_performance cp
      LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
      WHERE cp.video_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM creative_assets a
          WHERE (a.group_key = cp.group_key OR a.ad_id = cp.ad_id OR a.meta_video_id = cp.video_id)
            AND COALESCE(a.playable_url, a.durable_url) IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM creative_assets a
          WHERE (a.group_key = cp.group_key OR a.ad_id = cp.ad_id OR a.meta_video_id = cp.video_id)
            AND COALESCE(a.playable_url, a.durable_url) IS NULL
            AND a.playback_checked_at > now() - interval '7 days'
        )
      GROUP BY cp.group_key
    )
    SELECT DISTINCT ON (group_key) id, group_key
    FROM (
      SELECT * FROM asset_candidates
      UNION ALL
      SELECT * FROM performance_candidates
    ) candidates
    WHERE group_key IS NOT NULL
    ORDER BY group_key, priority DESC, updated_at DESC NULLS LAST
    LIMIT ${limit}
  `;
  const results = [];
  for (const row of rows) {
    const result = await normalizeCreativeAsset({ groupKey: row.group_key, assetId: row.id, ctx });
    results.push({ groupKey: row.group_key, assetId: row.id ? Number(row.id) : null, ...result.body });
  }
  return statusBody(200, { ok: true, processed: results.length, results });
}
