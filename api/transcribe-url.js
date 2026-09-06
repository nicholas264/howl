import { checkWorkLimit } from './_lib/work-limits.js';
import { claimTranscription, saveTranscription } from './_lib/transcription-jobs.js';
import { recordProviderUsage } from './_lib/work-controls.js';
// Server-side audio extraction + Whisper transcription for multi-GB UGC source videos.
// Replaces the in-browser ffmpeg.wasm path which OOMs above ~200 MB.
//
// Flow:
//   1. POST { videoUrl, sessionId }
//   2. Fetch the source video from Vercel Blob with a streaming reader
//   3. Pipe through ffmpeg-static to extract 16 kHz mono mp3 (64 kbps) into /tmp
//   4. Upload the audio mp3 back to Vercel Blob and save audio_url on the session
//   5. Send the audio to OpenAI Whisper with word-level timestamps
//   6. Persist `words` + `duration` on the session, return them to the client
import { spawn } from 'node:child_process';
import { createReadStream, statSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { put } from '@vercel/blob';

import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

// ffmpeg-static exports the absolute path to a prebuilt static binary
import ffmpegPath from 'ffmpeg-static';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 300,
};

const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await checkWorkLimit(access, res, 'transcription'))) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const sessionId = Number(req.body?.sessionId);
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const { sql } = access;
  await ensureCreatorOpsTables(sql);
  const [session] = await sql`
    SELECT id, video_url
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

  const audioPath = join(tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  const job=await claimTranscription(sql,sessionId,sourceUrl.href);
  if (!job) return res.status(409).json({error:'This session is already processing or its source changed. Reload before retrying.'});
  const signal=AbortSignal.timeout(240000);

  try {
    // 1. Stream the source video into ffmpeg via stdin, write audio to /tmp
    const videoRes = await fetch(sourceUrl,{signal,redirect:'error'});
    if (!videoRes.ok || !videoRes.body) {
      throw new Error(`Failed to fetch source video: ${videoRes.status}`);
    }

    const ff = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      '-f', 'mp3',
      audioPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'], signal, killSignal:'SIGKILL' });

    let ffErr = '';
    ff.stderr.on('data', (chunk) => { ffErr = (ffErr+chunk.toString()).slice(-4000); });

    const ffmpegDone = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-2000)}`)));
    });

    // Pipe the fetch body into ffmpeg stdin. Node's web Readable → Node Readable.
    const nodeReadable = Readable.fromWeb(videoRes.body);
    nodeReadable.on('error', (err) => { ff.stdin.destroy(err); });
    let received=0;
    const limiter=new Transform({transform(chunk,_encoding,callback){received+=chunk.length;
      callback(received>2*1024*1024*1024 ? new Error('Video exceeds the 2 GB transcription limit') : null,chunk);}});
    try {await Promise.all([pipeline(nodeReadable,limiter,ff.stdin,{signal}),ffmpegDone]);}
    catch(error){ff.kill('SIGKILL');throw error;}

    const audioStat = statSync(audioPath);
    if (audioStat.size === 0) throw new Error('ffmpeg produced empty audio output');

    if (audioStat.size > WHISPER_MAX_BYTES) throw Object.assign(new Error('Extracted audio exceeds the 25 MB transcription limit'),{statusCode:413});
    signal.throwIfAborted();
    // 2. Upload audio to Blob (so re-transcribe is fast and the audio is shareable with future render jobs)
    const audioStream = createReadStream(audioPath);
    const audioBlob = await put(`ugc-audio/session-${sessionId || 'tmp'}-${Date.now()}.mp3`, audioStream, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: true,
      abortSignal:signal,
    });

    // 3. Hand the audio to Whisper. Whisper has a 25 MB cap; if we exceed it,
    //    surface a clear error rather than silently truncating.
    if (audioStat.size > WHISPER_MAX_BYTES) {
      const error = new Error(`Audio is ${(audioStat.size / 1024 / 1024).toFixed(1)} MB which exceeds Whisper's 25 MB cap`);
      error.statusCode = 413;
      throw error;
    }

    const audioBuf = await new Promise((resolve, reject) => {
      const chunks = [];
      const s = createReadStream(audioPath);
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });

    const form = new FormData();
    form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', 'whisper-1');
    form.append(
      'prompt',
      'HOWL Campfires. HOWL R4 Campfire. HOWL R4. HOWL fire pit. HOWL products and outdoor camping terminology.',
    );
    form.append('language', 'en');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal,
    });
    const whisperData = await whisperRes.json();
    if (!whisperRes.ok) {
      const error = new Error(whisperData.error?.message || 'Whisper failed');
      error.statusCode = whisperRes.status;
      throw error;
    }

    const words = attachPunctuation(
      (whisperData.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end, kept: true })),
      whisperData.segments || []
    );
    const duration = whisperData.duration || (words.length ? words[words.length - 1].end : 0);

    await recordProviderUsage(sql,access.workId,{provider:'openai',model:'whisper-1',mediaSeconds:duration});
    signal.throwIfAborted();
    if (!(await saveTranscription(sql,sessionId,sourceUrl.href,job,{words,duration,audioUrl:audioBlob.url})))
      throw Object.assign(new Error('Session changed during transcription. Your edits were preserved; reload before retrying.'),{statusCode:409});

    return res.json({ words, duration, audioUrl: audioBlob.url });
  } catch (err) {
    console.error('transcribe-url error', err);
    const message = (err.message || 'Transcription failed').slice(0, 2000);
    await sql`
      UPDATE ugc_sessions
      SET status = 'transcription_error', transcription_token=NULL,last_error = ${message}, updated_at = now()
      WHERE id = ${sessionId} AND transcription_token=${job.token}
    `.catch(() => {});
    return res.status(err.statusCode || 500).json({ error: message });
  } finally {
    if (existsSync(audioPath)) {
      try { unlinkSync(audioPath); } catch { /* noop */ }
    }
  }
}

/**
 * Whisper's word-level granularity strips punctuation. Segment text keeps it
 * (e.g. "vibe,"  "backyard."). Walk segment tokens and bare words in parallel,
 * matching by stripped letters, copying the punctuated form back onto the word
 * so the transcript reads like real prose.
 */
function attachPunctuation(words, segments) {
  if (!words.length || !Array.isArray(segments) || !segments.length) return words;
  const tokens = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    for (const t of seg.text.trim().split(/\s+/)) tokens.push(t);
  }
  const strip = (s) => (s || '').toLowerCase().replace(/[^a-z0-9'-]/gi, '');
  const out = words.map(w => ({ ...w }));
  let ti = 0;
  for (let wi = 0; wi < out.length && ti < tokens.length; wi++) {
    const wPlain = strip(out[wi].word);
    if (!wPlain) continue;
    while (ti < tokens.length) {
      const tPlain = strip(tokens[ti]);
      if (tPlain === wPlain || (tPlain && wPlain && (tPlain.startsWith(wPlain) || wPlain.startsWith(tPlain)))) {
        out[wi].word = tokens[ti];
        ti++;
        break;
      }
      ti++;
    }
  }
  return out;
}
