import { spawn } from 'node:child_process';
import { createReadStream, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import ffmpegPath from 'ffmpeg-static';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
  maxDuration: 300,
};

function validSegments(input, duration) {
  if (!Array.isArray(input) || !input.length || input.length > 300) return null;
  const result = [];
  for (const segment of input) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
    if (duration && end > duration + 1) return null;
    result.push({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
  }
  return result;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-12000);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

function subtitleStyle(settings = {}) {
  const position = settings.captionPosition || 'bottom';
  const scale = Math.max(0.78, Math.min(1.22, Number(settings.captionScale || 1)));
  const alignment = position === 'top' ? 8 : position === 'center' ? 5 : 2;
  const marginV = position === 'top' ? 90 : position === 'center' ? 20 : 56;
  const fontSize = Math.round(18 * scale);
  return [
    'Fontname=Arial',
    `Fontsize=${fontSize}`,
    'PrimaryColour=&H00FFFFFF&',
    'OutlineColour=&H00000000&',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    `Alignment=${alignment}`,
    `MarginV=${marginV}`,
  ].join(',');
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();
  const { sql } = access;

  const sessionId = Number(req.body?.session_id);
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  await ensureCreatorOpsTables(sql);
  const [session] = await sql`
    SELECT *
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session) return res.status(404).json({ error: 'Session not found' });
  let sourceUrl;
  try {
    await sql`
      UPDATE ugc_sessions
      SET status = 'rendering', last_error = NULL, updated_at = now()
      WHERE id = ${sessionId}
    `;
    sourceUrl = new URL(session.video_url);
  } catch {
    return res.status(400).json({ error: 'Session source URL is invalid' });
  }
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.blob.vercel-storage.com')) {
    return res.status(400).json({ error: 'Session source must be stored in HOWL Vercel Blob' });
  }

  const segments = validSegments(req.body?.segments, Number(session.duration || 0));
  if (!segments) return res.status(400).json({ error: 'Valid segments[] required' });
  const captions = typeof req.body?.captions_srt === 'string'
    ? req.body.captions_srt.slice(0, 500000)
    : '';
  const captionSettings = req.body?.caption_settings && typeof req.body.caption_settings === 'object'
    ? req.body.caption_settings
    : {};
  const token = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const outputPath = join(tmpdir(), `howl-render-${token}.mp4`);
  const subtitlePath = join(tmpdir(), `howl-render-${token}.srt`);

  try {
    const filterParts = [];
    segments.forEach((segment, index) => {
      filterParts.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}]`);
      filterParts.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`);
    });
    const inputs = segments.map((_, index) => `[v${index}][a${index}]`).join('');
    filterParts.push(`${inputs}concat=n=${segments.length}:v=1:a=1[vcut][acut]`);
    let videoMap = '[vcut]';
    if (captions) {
      writeFileSync(subtitlePath, captions, 'utf8');
      const escapedPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      filterParts.push(`[vcut]subtitles='${escapedPath}':force_style='${subtitleStyle(captionSettings)}'[vout]`);
      videoMap = '[vout]';
    }

    await runFfmpeg([
      '-y',
      '-i', sourceUrl.toString(),
      '-filter_complex', filterParts.join(';'),
      '-map', videoMap,
      '-map', '[acut]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);

    const blob = await put(`ugc-renders/session-${sessionId}-${Date.now()}.mp4`, createReadStream(outputPath), {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: true,
    });
    await sql`
      UPDATE ugc_sessions
      SET rendered_url = ${blob.url}, status = 'rendered', last_error = NULL, updated_at = now()
      WHERE id = ${sessionId}
    `;
    if (session.deliverable_id) {
      await sql`
        UPDATE creator_deliverables
        SET output_url = ${blob.url}, status = 'edited',
            completed_asset_count = GREATEST(completed_asset_count, 1),
            completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE id = ${session.deliverable_id}
          AND creator_id = ${session.creator_id}
      `;
    }
    if (session.creator_id) {
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        VALUES (
          ${session.creator_id}, 'edit_rendered', 'Creator footage rendered',
          ${JSON.stringify({ session_id: sessionId, deliverable_id: session.deliverable_id, output_url: blob.url })}::jsonb,
          ${access.userId}
        )
      `;
    }
    return res.json({ ok: true, url: blob.url, session_id: sessionId });
  } catch (err) {
    await sql`
      UPDATE ugc_sessions
      SET status = 'render_error', last_error = ${(err.message || 'Render failed').slice(0, 2000)}, updated_at = now()
      WHERE id = ${sessionId}
    `.catch(() => {});
    return res.status(500).json({ error: err.message || 'Render failed' });
  } finally {
    if (existsSync(outputPath)) try { unlinkSync(outputPath); } catch {}
    if (existsSync(subtitlePath)) try { unlinkSync(subtitlePath); } catch {}
  }
}
