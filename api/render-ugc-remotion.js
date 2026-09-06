import { finishWork } from './_lib/work-controls.js';
import { checkWorkLimit } from './_lib/work-limits.js';
import { randomUUID } from 'node:crypto';
import { renderMediaOnLambda } from '@remotion/lambda/client';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import {
  REMOTION_COMPOSITION_ID,
  REMOTION_FPS,
  REMOTION_HEIGHT,
  REMOTION_WIDTH,
  buildRemotionInput,
  calcDurationInFrames,
  remotionConfig,
  validSegments,
} from './_lib/ugc-remotion.js';

export const config = {
  api: { bodyParser: { sizeLimit: '3mb' } },
  maxDuration: 60,
};

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const lambda = remotionConfig();
  if (!lambda.configured) {
    return res.status(409).json({
      error: `Remotion Lambda is not configured. Missing: ${lambda.missing.join(', ')}`,
      setup_required: true,
      missing: lambda.missing,
    });
  }

  const sessionId = Number(req.body?.session_id);
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const { sql } = access;
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
    sourceUrl = new URL(session.video_url);
  } catch {
    return res.status(400).json({ error: 'Session source URL is invalid' });
  }
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.blob.vercel-storage.com')) {
    return res.status(400).json({ error: 'Session source must be stored in HOWL Vercel Blob' });
  }

  const segments = validSegments(req.body?.segments, Number(session.duration || 0));
  if (!segments) return res.status(400).json({ error: 'Valid segments[] required' });

  const inputProps = buildRemotionInput({
    session,
    segments,
    words: req.body?.words,
    settings: req.body?.settings,
  });
  const renderKey = String(req.body?.render_key || 'polished').slice(0, 80);
  const renderLabel = String(req.body?.render_label || 'Polished ad').slice(0, 120);
  const durationInFrames = calcDurationInFrames({
    segments,
    showIntro: inputProps.showIntro,
    showOutro: inputProps.showOutro,
  });

  if (!(await checkWorkLimit(access,res,'render',{holdUntilCompletion:true}))) return;
  const attemptId = randomUUID();
  try {
    const [claimed] = await sql`
      UPDATE ugc_sessions
      SET status = 'rendering', last_error = NULL,
          settings = COALESCE(settings, '{}'::jsonb) || ${JSON.stringify({ remotion_attempt: attemptId, remotion_render: { work_id:access.workId, attempt_id: attemptId, provider: 'starting', started_at: new Date().toISOString() } })}::jsonb, updated_at = now()
      WHERE id = ${sessionId} AND status NOT IN ('rendering', 'render_unknown')
      RETURNING id
    `;
    if (!claimed) {
      await finishWork(sql,access.workId,'render',409);
      return res.status(409).json({ error: 'A render is already running or needs reconciliation. Check its status before starting another.' });
    }
    const { renderId, bucketName } = await renderMediaOnLambda({
      region: lambda.region,
      functionName: lambda.functionName,
      serveUrl: lambda.serveUrl,
      composition: REMOTION_COMPOSITION_ID,
      inputProps,
      codec: 'h264',
      audioCodec: 'aac',
      privacy: 'public',
      forceWidth: REMOTION_WIDTH,
      forceHeight: REMOTION_HEIGHT,
      forceFps: REMOTION_FPS,
      forceDurationInFrames: durationInFrames,
      x264Preset: 'veryfast',
      maxRetries: 1,
      timeoutInMilliseconds: 120000,
      downloadBehavior: { type: 'play-in-browser' },
      outName: `howl-ugc-session-${sessionId}-${Date.now()}.mp4`,
    });
    const renderState = {
      provider: 'remotion_lambda',
      work_id:access.workId,
      render_key: renderKey,
      render_label: renderLabel,
      render_id: renderId,
      bucket_name: bucketName,
      function_name: lambda.functionName,
      region: lambda.region,
      serve_url: lambda.serveUrl,
      composition: REMOTION_COMPOSITION_ID,
      duration_in_frames: durationInFrames,
      started_at: new Date().toISOString(),
      input: {
        segments,
        settings: req.body?.settings || null,
      },
    };
    await sql`
      UPDATE ugc_sessions
      SET settings = COALESCE(settings, '{}'::jsonb) || ${JSON.stringify({ remotion_render: renderState })}::jsonb,
          updated_at = now()
      WHERE id = ${sessionId} AND settings->>'remotion_attempt' = ${attemptId}
    `;
    return res.json({
      ok: true,
      session_id: sessionId,
      render_id: renderId,
      bucket_name: bucketName,
      function_name: lambda.functionName,
      region: lambda.region,
      duration_in_frames: durationInFrames,
    });
  } catch (err) {
    const message = (err.message || 'Remotion render failed to start').slice(0, 2000);
    await sql`
      UPDATE ugc_sessions
      SET status = 'render_unknown', last_error = ${message}, updated_at = now()
      WHERE id = ${sessionId} AND settings->>'remotion_attempt' = ${attemptId}
    `.catch(() => {});
    return res.status(500).json({ error: message });
  }
}
