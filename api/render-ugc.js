import {videoReadUrl,redactPrivateMediaError} from './_lib/private-video.js';
import {claimFfmpegRender,saveFfmpegRender,failFfmpegRender,runFfmpeg} from './_lib/ffmpeg-render-job.js';
import {checkWorkLimit} from './_lib/work-limits.js';
import { createReadStream, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import { requirePermission } from './_lib/app-access.js';


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
  if (!Number.isSafeInteger(sessionId) || sessionId<1) return res.status(400).json({ error: 'session_id required' });

  const [session] = await sql`
    SELECT *
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session) return res.status(404).json({ error: 'Session not found' });
  let sourceUrl;
  try {
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
  if (!(await checkWorkLimit(access,res,'render'))) return;
  const attempt=await claimFfmpegRender(sql,session);
  if(!attempt)return res.status(409).json({error:'Session changed or a job is active. Reload before rendering.'});
  const signal=AbortSignal.timeout(240000);
  const token = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const outputPath = join(tmpdir(), `howl-render-${token}.mp4`);
  const subtitlePath = join(tmpdir(), `howl-render-${token}.srt`);

  try {
    const readableSource=await videoReadUrl(sql,sourceUrl.href);
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
      '-rw_timeout', '30000000',
      '-i', readableSource,
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
    ],signal);
    signal.throwIfAborted();

    const blob = await put(`ugc-renders/session-${sessionId}-${Date.now()}.mp4`, createReadStream(outputPath), {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: true,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    if(!await saveFfmpegRender(sql,session,attempt,blob.url,access.userId))
      return res.status(409).json({error:'Render was superseded. Reload the current session.'});
    return res.json({ ok: true, url: blob.url, session_id: sessionId, revision: Number(session.revision)+1 });
  } catch (err) {
    const message=redactPrivateMediaError(err,'Render failed');
    await failFfmpegRender(sql,sessionId,attempt,message).catch(()=>{});
    return res.status(500).json({ error: message });
  } finally {
    if (existsSync(outputPath)) try { unlinkSync(outputPath); } catch {}
    if (existsSync(subtitlePath)) try { unlinkSync(subtitlePath); } catch {}
  }
}
