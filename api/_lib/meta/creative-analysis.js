// AI creative analysis for Meta ads. Extracted from api/meta.js to keep
// that file focused on publishing + insights. Three handlers live here:
//
//   analyzeCreativeGroup({ groupKey, manualTranscript, ctx })
//   getCreativeAnalysis({ groupKey })
//   listAnalyzedWinners({ sinceDays })
//
// `ctx` carries the closure variables the meta handler computed once:
// { BASE, accessToken, adAccountId }.
import { neon } from '@neondatabase/serverless';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegPath from 'ffmpeg-static';
import { backfillCreativeAssetsFromLaunchHistory, ensureCreativeAssetTables } from '../creative-assets.js';
import {
  claimCreativeAnalysisJob,
  completeCreativeAnalysisJob,
  enqueueCreativeAnalyses,
  failCreativeAnalysisJob,
  getCreativeAnalysisQueueStatus,
  retryFailedCreativeAnalysisJobs,
} from '../creative-analysis-queue.js';
import { getGoogleAccessToken } from '../gcp-auth.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

async function ensureCreativeAnalysisColumns(sql) {
  await ensureCreativeAssetTables(sql);
  await backfillCreativeAssetsFromLaunchHistory(sql);
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS source_asset_id BIGINT`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS vision_frame_count INTEGER`;
  await sql`ALTER TABLE creative_analysis ADD COLUMN IF NOT EXISTS transcription_status TEXT`;
}

async function runFfmpeg(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-1600)}`)));
  });
}

async function downloadMediaToTemp({ url, driveFileId }) {
  let response;
  if (driveFileId) {
    const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/drive.readonly']);
    response = await fetch(`${DRIVE}/files/${driveFileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    response = await fetch(url);
  }
  if (!response.ok || !response.body) throw new Error(`media fetch failed: HTTP ${response.status}`);
  const path = join(tmpdir(), `creative-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  return path;
}

async function transcribeAudioFile(audioPath) {
  const sendChunk = async (path, index) => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(path)], { type: 'audio/mpeg' }), `audio-${index}.mp3`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!response.ok) throw new Error(`Whisper HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    return (await response.text()).trim();
  };

  if (statSync(audioPath).size <= WHISPER_MAX_BYTES) return sendChunk(audioPath, 0);

  const prefix = `creative-chunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pattern = join(tmpdir(), `${prefix}-%03d.mp3`);
  await runFfmpeg(['-y', '-i', audioPath, '-f', 'segment', '-segment_time', '1200', '-c', 'copy', pattern]);
  const chunks = readdirSync(tmpdir())
    .filter(name => name.startsWith(prefix) && name.endsWith('.mp3'))
    .sort()
    .map(name => join(tmpdir(), name));
  try {
    const parts = [];
    for (let i = 0; i < chunks.length; i++) parts.push(await sendChunk(chunks[i], i));
    return parts.filter(Boolean).join('\n');
  } finally {
    for (const path of chunks) if (existsSync(path)) unlinkSync(path);
  }
}

async function prepareVideoAsset(source, { transcribe = true } = {}) {
  const sourcePath = await downloadMediaToTemp(source);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const audioPath = join(tmpdir(), `creative-audio-${token}.mp3`);
  const framePrefix = `creative-frame-${token}`;
  const framePattern = join(tmpdir(), `${framePrefix}-%02d.jpg`);
  try {
    let transcript = '';
    let transcriptError = null;
    let visionError = null;
    const transcriptionTask = transcribe
      ? runFfmpeg(['-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath])
        .then(() => transcribeAudioFile(audioPath))
        .then(value => { transcript = value; })
        .catch(err => { transcriptError = err; })
      : Promise.resolve();
    const visionTask = runFfmpeg([
      '-y', '-i', sourcePath, '-vf', 'fps=1/5,scale=960:-2', '-frames:v', '8', '-q:v', '3', framePattern,
    ]).catch(err => { visionError = err; });
    await Promise.all([transcriptionTask, visionTask]);
    const framePaths = readdirSync(tmpdir())
      .filter(name => name.startsWith(framePrefix) && name.endsWith('.jpg'))
      .sort()
      .map(name => join(tmpdir(), name));
    const frames = framePaths.map(path => readFileSync(path).toString('base64'));
    if (transcribe && transcriptError && visionError) {
      throw new Error(`transcription failed: ${transcriptError.message}; vision failed: ${visionError.message}`);
    }
    return {
      transcript,
      frames,
      transcriptError: transcriptError?.message || null,
      visionError: visionError?.message || null,
    };
  } finally {
    for (const name of readdirSync(tmpdir())) {
      if (name.startsWith(framePrefix)) {
        try { unlinkSync(join(tmpdir(), name)); } catch {}
      }
    }
    for (const path of [sourcePath, audioPath]) {
      if (existsSync(path)) {
        try { unlinkSync(path); } catch {}
      }
    }
  }
}

export async function analyzeCreativeGroup({ groupKey, manualTranscript = '', ctx }) {
  if (!groupKey) return { status: 400, body: { error: 'groupKey required' } };
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  if (!process.env.ANTHROPIC_API_KEY) return { status: 200, body: { error: 'ANTHROPIC_API_KEY not configured' } };
  const { BASE, accessToken, adAccountId } = ctx;
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);

  // Pick the top-spend ad in the group as the canonical asset for analysis.
  const [topAd] = await sql`
    SELECT cp.ad_id, cp.ad_name, cp.video_id, cp.image_hash, cp.thumbnail_url, cp.creative_id,
      COALESCE(SUM(i.spend), 0)::float          AS spend,
      COALESCE(SUM(i.purchase_value), 0)::float AS purchase_value,
      COALESCE(SUM(i.purchases), 0)::int        AS purchases,
      COALESCE(SUM(i.impressions), 0)::bigint   AS impressions,
      COALESCE(SUM(i.clicks), 0)::bigint        AS clicks
    FROM creative_performance cp
    LEFT JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
    WHERE cp.group_key = ${groupKey}
    GROUP BY cp.ad_id, cp.ad_name, cp.video_id, cp.image_hash, cp.thumbnail_url, cp.creative_id
    ORDER BY spend DESC
    LIMIT 1
  `;
  if (!topAd) return { status: 404, body: { error: 'No ads found for group' } };

  const isVideo = !!topAd.video_id;
  const assetKind = isVideo ? 'video' : 'image';
  const debug = { asset: null, videoFieldsResolved: null, videoSourceUrl: null, whisper: null, image: null, visionFrames: 0 };
  const [sourceAsset] = await sql`
    SELECT *
    FROM creative_assets
    WHERE group_key = ${groupKey}
       OR ad_id = ${topAd.ad_id}
       OR (${topAd.video_id || null}::text IS NOT NULL AND meta_video_id = ${topAd.video_id || null})
       OR (${topAd.image_hash || null}::text IS NOT NULL AND meta_image_hash = ${topAd.image_hash || null})
    ORDER BY (placement_role = 'feed') DESC, durable_url IS NULL, updated_at DESC
    LIMIT 1
  `;
  if (sourceAsset) debug.asset = `creative_assets:${sourceAsset.id}`;

  let imageUrl = (!isVideo && sourceAsset?.durable_url) || topAd.thumbnail_url;
  let videoSource = sourceAsset?.durable_url || null;
  if (isVideo) {
    const r = await fetch(`${BASE}/${topAd.video_id}?fields=source,picture,format,permalink_url,embed_html&access_token=${accessToken}`);
    const d = await r.json();
    if (d.error) {
      debug.videoFieldsResolved = `meta error: ${d.error.message}`;
    } else {
      debug.videoFieldsResolved = Object.keys(d).join(',');
      videoSource = videoSource || d.source || null;
      if (!videoSource && Array.isArray(d.format)) {
        for (const f of d.format) { if (f?.picture) imageUrl = f.picture; }
      }
      if (d.picture) imageUrl = d.picture;
      if (!videoSource) {
        try {
          const r2 = await fetch(`${BASE}/${adAccountId}/advideos?ids=${encodeURIComponent(topAd.video_id)}&fields=source&access_token=${accessToken}`);
          const d2 = await r2.json();
          const inner = d2 && d2[topAd.video_id];
          if (inner?.source) {
            videoSource = inner.source;
            debug.videoSourceUrl = 'recovered from advideos endpoint';
          }
        } catch {}
      }
      if (!videoSource && !sourceAsset?.drive_file_id && d.embed_html) {
        const m = d.embed_html.match(/src=["']([^"']+\.mp4[^"']*)["']/i);
        if (m) {
          videoSource = m[1].replace(/&amp;/g, '&');
          debug.videoSourceUrl = 'recovered MP4 from embed_html';
        }
      }
    }
    if (!videoSource && !sourceAsset?.drive_file_id) {
      // Final fallback: we may have mirrored the video to Vercel Blob at launch time.
      // Look it up by ad_id (and other ad_ids in this group for safety).
      try {
        const [row] = await sql`
          SELECT lh.source_video_url
          FROM launch_history lh
          JOIN creative_performance cp ON cp.ad_id = lh.ad_id
          WHERE cp.group_key = ${groupKey} AND lh.source_video_url IS NOT NULL
          ORDER BY lh.launched_at DESC
          LIMIT 1
        `;
        if (row?.source_video_url) {
          videoSource = row.source_video_url;
          debug.videoSourceUrl = 'recovered from launch_history (Blob mirror)';
        }
      } catch (err) {
        debug.videoSourceUrl = `launch_history lookup failed: ${err.message}`;
      }
    }
    if (!debug.videoSourceUrl) {
      debug.videoSourceUrl = videoSource
        ? (sourceAsset?.durable_url ? 'creative_assets durable URL' : 'Meta source')
        : (sourceAsset?.drive_file_id ? 'Drive source available' : 'missing');
    }
  } else if (topAd.image_hash) {
    const hashesParam = encodeURIComponent(JSON.stringify([topAd.image_hash]));
    const r = await fetch(`${BASE}/${adAccountId}/adimages?hashes=${hashesParam}&fields=url&access_token=${accessToken}`);
    const d = await r.json();
    const img = (d.data || [])[0];
    if (!imageUrl && img?.url) imageUrl = img.url;
  }

  let transcript = manualTranscript || sourceAsset?.transcript || '';
  let visionFrames = [];
  if (manualTranscript) debug.whisper = `manual: ${manualTranscript.length} chars`;
  else if (sourceAsset?.transcript) debug.whisper = `cached: ${sourceAsset.transcript.length} chars`;
  if (isVideo && !videoSource && !sourceAsset?.drive_file_id) {
    debug.whisper = transcript ? debug.whisper : 'skipped: no durable, Meta, or Drive source';
  } else if (isVideo) {
    const shouldTranscribe = !transcript && !!process.env.OPENAI_API_KEY;
    if (!transcript && !process.env.OPENAI_API_KEY) {
      debug.whisper = 'skipped: OPENAI_API_KEY missing in this environment';
    }
    try {
      const prepared = await prepareVideoAsset({
        url: videoSource,
        driveFileId: videoSource ? null : sourceAsset?.drive_file_id,
      }, { transcribe: shouldTranscribe });
      if (prepared.transcript) transcript = prepared.transcript;
      visionFrames = prepared.frames;
      debug.visionFrames = visionFrames.length;
      if (shouldTranscribe) {
        debug.whisper = prepared.transcriptError
          ? `exception: ${prepared.transcriptError}`
          : `ok: ${transcript.length} chars`;
      }
      if (prepared.visionError) debug.image = `frame extraction exception: ${prepared.visionError}`;
      if (sourceAsset) {
        await sql`
          UPDATE creative_assets SET
            transcript = COALESCE(${transcript || null}, transcript),
            transcript_status = ${transcript ? 'complete' : (prepared.transcriptError ? 'error' : 'missing')},
            transcript_error = ${prepared.transcriptError},
            updated_at = now()
          WHERE id = ${sourceAsset.id}
        `;
      }
    } catch (err) {
      debug.whisper = shouldTranscribe ? `exception: ${err.message}` : debug.whisper;
      debug.image = `video preparation exception: ${err.message}`;
      if (sourceAsset) {
        await sql`
          UPDATE creative_assets SET
            transcript_status = ${transcript ? 'complete' : 'error'},
            transcript_error = ${transcript ? null : err.message},
            updated_at = now()
          WHERE id = ${sourceAsset.id}
        `;
      }
    }
  }

  let imageB64 = null;
  let mediaType = 'image/jpeg';
  if (imageUrl) {
    try {
      const ir = await fetch(imageUrl);
      if (!ir.ok) {
        debug.image = `image fetch failed: HTTP ${ir.status}`;
      } else {
        const buf = Buffer.from(await ir.arrayBuffer());
        imageB64 = buf.toString('base64');
        mediaType = ir.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        debug.image = `ok: ${buf.length} bytes, ${mediaType}`;
      }
    } catch (err) {
      debug.image = `exception: ${err.message}`;
    }
  } else {
    debug.image = 'no image URL';
  }

  if (isVideo && !transcript) {
    return {
      status: 422,
      body: {
        error: 'Video transcription is incomplete. The creative was not analyzed or saved.',
        step: 'transcription_quality_gate',
        debug,
      },
    };
  }
  if (isVideo && visionFrames.length === 0) {
    return {
      status: 422,
      body: {
        error: 'No chronological video frames could be extracted. The creative was not analyzed or saved.',
        step: 'vision_quality_gate',
        debug,
      },
    };
  }
  if (!isVideo && !imageB64) {
    return {
      status: 422,
      body: {
        error: 'The creative image could not be loaded. The creative was not analyzed or saved.',
        step: 'vision_quality_gate',
        debug,
      },
    };
  }

  const perf = {
    spend: Number(topAd.spend) || 0,
    purchaseValue: Number(topAd.purchase_value) || 0,
    purchases: Number(topAd.purchases) || 0,
    impressions: Number(topAd.impressions) || 0,
    clicks: Number(topAd.clicks) || 0,
  };
  perf.roas = perf.spend > 0 ? perf.purchaseValue / perf.spend : 0;
  perf.cpa = perf.purchases > 0 ? perf.spend / perf.purchases : null;

  const haveTranscript = !!transcript;
  const systemPrompt = `You analyze HOWL Campfires Meta ads. HOWL sells smokeless propane fire pits (R1, R4 MKii, etc.) — outdoor brand, masculine voice, "burn-ban-friendly" angle is recurring.

You will receive either one static image or a chronological sequence of sampled video frames, plus optionally a full transcript and performance numbers.

CRITICAL RULES:
- If a transcript is provided, the verbal hook is the FIRST sentence or two of that transcript. Quote it verbatim.
- If NO transcript is provided, you CANNOT know the spoken hook from visual frames alone. Set "hook_text_verbatim" to null and note this clearly in why_it_worked.
- For videos with no transcript, mark hook_type as "unknown" rather than fabricating one.
- Never invent dialogue, on-screen text, or claims that are not visible in the image or written in the transcript.

Return ONLY a single valid JSON object with these exact fields:

{
  "hook_text_verbatim": "the literal opening line from the transcript (<=140 chars), or null if no transcript",
  "hook_type": "one of: question | stat | problem | POV | demo | testimonial | before-after | list | contrarian | founder | unknown | other",
  "format": "one of: ugc-talking-head | ugc-product-demo | studio-product | founder | callout-graphic | review-collage | static-image | other",
  "angle": "short label (<=6 words) for the persuasive angle, e.g. 'burn ban anywhere'",
  "talent_description": "1 sentence on who is on camera (or 'no on-camera talent' for static)",
  "visual_summary": "2-3 sentences describing the visual sequence: opening frame, setting, framing, visible on-screen text, product actions, and progression",
  "why_it_worked": "3-5 sentences. Concrete reasoning that ties THIS creative's available signals (transcript if present, visual format, performance) to its results. If no transcript, acknowledge the limitation and reason from format/visual/performance only. Avoid generic ad-school platitudes."
}

No prose outside the JSON. No markdown fences.`;

  const userText = `Performance (last 30d, this creative group):
- Spend: $${perf.spend.toFixed(2)}
- Revenue: $${perf.purchaseValue.toFixed(2)}
- Purchases: ${perf.purchases}
- ROAS: ${perf.roas.toFixed(2)}x
${perf.cpa != null ? `- CPA: $${perf.cpa.toFixed(2)}` : ''}

${haveTranscript ? `Transcript (full):\n${transcript}` : (isVideo
  ? 'NO TRANSCRIPT AVAILABLE. You may inspect the sampled video frames, but cannot determine the spoken hook. hook_text_verbatim must be null.'
  : 'Static image ad, no transcript needed.')}

Analyze this creative.`;

  const claudeContent = [];
  for (const frame of visionFrames) {
    claudeContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } });
  }
  if (imageB64) claudeContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } });
  claudeContent.push({ type: 'text', text: userText });

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: claudeContent }],
    }),
  });
  const claudeData = await claudeRes.json();
  if (claudeData.error) return { status: 400, body: { error: claudeData.error.message, step: 'claude' } };

  const text = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed = null;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { status: 500, body: { error: 'Failed to parse analysis JSON', raw: text } };
  }

  await sql`
    INSERT INTO creative_analysis
      (group_key, asset_kind, transcript, hook_text_verbatim, hook_type, format, angle, talent_description, visual_summary, why_it_worked, performance_snapshot, model, source_asset_id, vision_frame_count, transcription_status, generated_at)
    VALUES
      (${groupKey}, ${assetKind}, ${transcript || null}, ${parsed.hook_text_verbatim || null}, ${parsed.hook_type || null}, ${parsed.format || null}, ${parsed.angle || null}, ${parsed.talent_description || null}, ${parsed.visual_summary || null}, ${parsed.why_it_worked || null}, ${JSON.stringify(perf)}::jsonb, ${'claude-sonnet-4-20250514'}, ${sourceAsset?.id || null}, ${visionFrames.length || (imageB64 ? 1 : 0)}, ${transcript ? 'complete' : (isVideo ? 'missing' : 'not-needed')}, NOW())
    ON CONFLICT (group_key) DO UPDATE SET
      asset_kind = EXCLUDED.asset_kind,
      transcript = EXCLUDED.transcript,
      hook_text_verbatim = EXCLUDED.hook_text_verbatim,
      hook_type = EXCLUDED.hook_type,
      format = EXCLUDED.format,
      angle = EXCLUDED.angle,
      talent_description = EXCLUDED.talent_description,
      visual_summary = EXCLUDED.visual_summary,
      why_it_worked = EXCLUDED.why_it_worked,
      performance_snapshot = EXCLUDED.performance_snapshot,
      model = EXCLUDED.model,
      source_asset_id = EXCLUDED.source_asset_id,
      vision_frame_count = EXCLUDED.vision_frame_count,
      transcription_status = EXCLUDED.transcription_status,
      generated_at = NOW()
  `;
  if (sourceAsset) {
    await sql`UPDATE creative_assets SET analyzed_at = now(), updated_at = now() WHERE id = ${sourceAsset.id}`;
  }
  await completeCreativeAnalysisJob(sql, groupKey);

  return {
    status: 200,
    body: {
      ok: true,
      analysis: {
        groupKey, assetKind,
        transcript,
        hookTextVerbatim: parsed.hook_text_verbatim,
        hookType: parsed.hook_type,
        format: parsed.format,
        angle: parsed.angle,
        talentDescription: parsed.talent_description,
        visualSummary: parsed.visual_summary,
        whyItWorked: parsed.why_it_worked,
        performance: perf,
        sourceAssetId: sourceAsset?.id || null,
        visionFrameCount: visionFrames.length || (imageB64 ? 1 : 0),
        transcriptionStatus: transcript ? 'complete' : (isVideo ? 'missing' : 'not-needed'),
        generatedAt: new Date().toISOString(),
      },
      debug,
    },
  };
}

export async function processCreativeAnalysisQueue({ ctx, batchSize: rawBatchSize = 2 }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  const batchSize = Math.max(1, Math.min(5, parseInt(rawBatchSize || 2, 10)));
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);
  await enqueueCreativeAnalyses(sql, 'worker');
  const results = [];

  for (let index = 0; index < batchSize; index++) {
    const job = await claimCreativeAnalysisJob(sql);
    if (!job) break;
    try {
      const out = await analyzeCreativeGroup({ groupKey: job.group_key, ctx });
      if (out.status >= 200 && out.status < 300 && out.body?.ok) {
        results.push({ groupKey: job.group_key, status: 'completed' });
      } else {
        const message = out.body?.error || `Analysis returned HTTP ${out.status}`;
        const status = await failCreativeAnalysisJob(sql, job, message);
        results.push({ groupKey: job.group_key, status, error: message });
      }
    } catch (err) {
      const status = await failCreativeAnalysisJob(sql, job, err.message);
      results.push({ groupKey: job.group_key, status, error: err.message });
    }
  }

  const queue = await getCreativeAnalysisQueueStatus(sql);
  return { status: 200, body: { ok: true, processed: results.length, results, queue } };
}

export async function getCreativeAnalysisQueue({ enqueue = true } = {}) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);
  const enqueued = enqueue ? await enqueueCreativeAnalyses(sql, 'dashboard') : 0;
  const queue = await getCreativeAnalysisQueueStatus(sql);
  return { status: 200, body: { queue, enqueued } };
}

export async function retryCreativeAnalysisQueue() {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);
  const retried = await retryFailedCreativeAnalysisJobs(sql);
  const queue = await getCreativeAnalysisQueueStatus(sql);
  return { status: 200, body: { ok: true, retried, queue } };
}

export async function getCreativeAnalysis({ groupKey }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  if (!groupKey) return { status: 400, body: { error: 'groupKey required' } };
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);
  const [row] = await sql`SELECT * FROM creative_analysis WHERE group_key = ${groupKey}`;
  return { status: 200, body: { analysis: row || null } };
}

export async function listAnalyzedWinners({ sinceDays: rawSince }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  const sinceDays = Math.max(1, Math.min(365, parseInt(rawSince || 30, 10)));
  const sql = neon(process.env.DATABASE_URL);
  await ensureCreativeAnalysisColumns(sql);
  await sql`
    CREATE TABLE IF NOT EXISTS creative_analysis_dismissals (
      group_key TEXT PRIMARY KEY,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const tsNow = new Date();
  const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await sql`
    SELECT
      ca.group_key, ca.hook_text_verbatim, ca.hook_type, ca.format, ca.angle,
      ca.talent_description, ca.visual_summary, ca.why_it_worked, ca.transcript,
      ca.asset_kind, ca.generated_at, ca.source_asset_id, ca.vision_frame_count,
      ca.transcription_status,
      (SELECT thumbnail_url FROM creative_performance cp WHERE cp.group_key = ca.group_key ORDER BY thumbnail_url IS NULL LIMIT 1) AS thumbnail_url,
      (SELECT ad_name FROM creative_performance cp WHERE cp.group_key = ca.group_key ORDER BY created_time ASC LIMIT 1) AS name,
      COALESCE((
        SELECT SUM(i.spend)::float
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS spend,
      COALESCE((
        SELECT SUM(i.purchase_value)::float
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS purchase_value,
      COALESCE((
        SELECT SUM(i.purchases)::int
        FROM creative_performance cp
        JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
        WHERE cp.group_key = ca.group_key
          AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
      ), 0) AS purchases
    FROM creative_analysis ca
    WHERE NOT EXISTS (
      SELECT 1 FROM creative_analysis_dismissals d WHERE d.group_key = ca.group_key
    )
    ORDER BY spend DESC NULLS LAST, ca.generated_at DESC
    LIMIT 100
  `;
  return { status: 200, body: { winners: rows, sinceDays } };
}

export async function dismissAnalyzedWinner({ groupKey }) {
  if (!process.env.DATABASE_URL) return { status: 200, body: { error: 'DATABASE_URL not configured' } };
  if (!groupKey) return { status: 400, body: { error: 'groupKey required' } };
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS creative_analysis_dismissals (
      group_key TEXT PRIMARY KEY,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO creative_analysis_dismissals (group_key)
    VALUES (${groupKey})
    ON CONFLICT (group_key) DO UPDATE SET dismissed_at = now()
  `;
  return { status: 200, body: { ok: true, groupKey } };
}
