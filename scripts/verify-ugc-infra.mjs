import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { del } from '@vercel/blob';

import uploadTokenHandler from '../api/blob/upload-token.js';
import sessionHandler from '../api/db/ugc-sessions.js';
import sourceHandler from '../api/ugc-source.js';

const execFileAsync = promisify(execFile);

process.env.AUTH_DISABLED ||= 'true';
process.env.NODE_ENV ||= 'development';

const requiredEnv = ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN'];
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}
if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve an ffmpeg binary');

const runId = Date.now();
const tempDir = await mkdtemp(path.join(tmpdir(), 'howl-ugc-infra-'));
const videoPath = path.join(tempDir, 'source.mp4');
let createdSessionId = null;
let uploadedBlobUrl = null;

try {
  await cleanupVerificationSessions();

  await execFileAsync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=#111111:s=540x960:d=1.6:r=30',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    videoPath,
  ]);

  const sourceBytes = await readFile(videoPath);
  const pathname = `ugc-verification/${runId}-source.mp4`;
  const blob = await uploadViaClientToken(pathname, sourceBytes, 'video/mp4');
  uploadedBlobUrl = blob.url;

  const created = await callJson(sessionHandler, {
    method: 'POST',
    body: {
      title: `UGC infra verification ${runId}`,
      file_name: `ugc-infra-${runId}.mp4`,
      file_size: sourceBytes.length,
      video_url: uploadedBlobUrl,
      duration: 1.6,
      words: [],
      settings: { verification: true },
      status: 'uploaded',
      source_type: 'internal_employee',
      source_label: 'Automated UGC infra check',
    },
  });
  createdSessionId = created.jsonBody.session.id;

  const fetched = await callJson(sessionHandler, {
    method: 'GET',
    query: { id: createdSessionId },
  });
  assertEqual(fetched.jsonBody.session.video_url, uploadedBlobUrl, 'session video_url persisted');
  assertEqual(fetched.jsonBody.session.status, 'uploaded', 'session status persisted');

  const sourceHead = await callRaw(sourceHandler, {
    method: 'HEAD',
    query: { id: createdSessionId },
    headers: {},
  });
  if (sourceHead.statusCode < 200 || sourceHead.statusCode > 299) {
    throw new Error(`source HEAD failed with ${sourceHead.statusCode}`);
  }
  if (!String(sourceHead.headers['content-type'] || '').startsWith('video/')) {
    throw new Error(`source HEAD returned unexpected content type: ${sourceHead.headers['content-type'] || 'missing'}`);
  }

  const sourceRange = await callRaw(sourceHandler, {
    method: 'GET',
    query: { id: createdSessionId },
    headers: { range: 'bytes=0-511' },
  });
  if (sourceRange.statusCode !== 206) {
    throw new Error(`source range GET failed with ${sourceRange.statusCode}`);
  }
  if (!sourceRange.byteLength) throw new Error('source range GET returned no bytes');

  await callJson(sessionHandler, {
    method: 'DELETE',
    query: { id: createdSessionId },
  });
  createdSessionId = null;
  uploadedBlobUrl = null;

  console.log(JSON.stringify({
    ok: true,
    blob_url: uploadedBlobUrl || blob.url,
    source_content_type: sourceHead.headers['content-type'],
    range_bytes: sourceRange.byteLength,
  }, null, 2));
} finally {
  if (createdSessionId) {
    await callJson(sessionHandler, {
      method: 'DELETE',
      query: { id: createdSessionId },
    }).catch(err => console.error(`cleanup failed for session ${createdSessionId}:`, err.message));
  }
  if (uploadedBlobUrl) {
    await del(uploadedBlobUrl).catch(err => console.error(`cleanup failed for blob ${uploadedBlobUrl}:`, err.message));
  }
  await rm(tempDir, { recursive: true, force: true });
}

async function uploadViaClientToken(pathname, bytes, contentType) {
  const tokenResponse = await callJson(uploadTokenHandler, {
    method: 'POST',
    body: {
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: 'local-dev-token',
        multipart: false,
      },
    },
  });
  const clientToken = tokenResponse.jsonBody.clientToken;
  if (!clientToken) throw new Error('upload-token did not return clientToken');

  const putRes = await fetch(`https://blob.vercel-storage.com/?pathname=${encodeURIComponent(pathname)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'x-api-version': '12',
      'x-vercel-blob-access': 'public',
      'x-content-type': contentType,
    },
    body: bytes,
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new Error(`client-token Blob PUT failed (${putRes.status}): ${text.slice(0, 300)}`);
  }
  return putRes.json();
}

async function cleanupVerificationSessions() {
  const list = await callJson(sessionHandler, {
    method: 'GET',
    query: { limit: '200' },
  });
  const stale = (list.jsonBody.sessions || []).filter(session => (
    String(session.title || '').startsWith('UGC infra verification')
  ));
  for (const session of stale) {
    await callJson(sessionHandler, {
      method: 'DELETE',
      query: { id: session.id },
    }).catch(err => console.error(`stale cleanup failed for session ${session.id}:`, err.message));
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function callJson(handler, reqInit) {
  const res = createMockRes();
  await handler(createMockReq(reqInit), res);
  if (res.statusCode < 200 || res.statusCode > 299) {
    throw new Error(`${reqInit.method} failed with ${res.statusCode}: ${JSON.stringify(res.jsonBody || res.bodyText || {})}`);
  }
  return res;
}

async function callRaw(handler, reqInit) {
  const res = createMockRes();
  await handler(createMockReq(reqInit), res);
  return res;
}

function createMockReq({ method, query = {}, body = null, headers = {} }) {
  return {
    method,
    query,
    body,
    headers,
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    jsonBody: null,
    bodyText: '',
    get body() {
      return Buffer.concat(this.chunks).toString('utf8');
    },
    get byteLength() {
      return this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    json(payload) {
      this.jsonBody = payload;
      this.bodyText = JSON.stringify(payload);
      return this.end(this.bodyText);
    },
    end(chunk = null) {
      if (chunk) this.write(chunk);
      this.ended = true;
      return this;
    },
    write(chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    destroy(err) {
      throw err || new Error('response destroyed');
    },
  };
}
