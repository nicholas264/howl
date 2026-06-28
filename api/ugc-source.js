import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { verifyUgcSourceToken } from './ugc-source-token.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

function parseRange(rangeHeader, size) {
  if (!rangeHeader || !/^bytes=\d*-\d*$/i.test(rangeHeader)) return null;
  const [startRaw, endRaw] = rangeHeader.replace(/bytes=/i, '').split('-');
  let start = startRaw === '' ? null : Number(startRaw);
  let end = endRaw === '' ? null : Number(endRaw);
  if (start === null && end !== null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    if (start === null) start = 0;
    if (end === null) end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();

  const sessionId = Number(req.query?.id);
  if (!sessionId) return res.status(400).json({ error: 'id required' });

  let access = null;
  const token = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  if (token) {
    if (!verifyUgcSourceToken(token, sessionId)) return res.status(401).json({ error: 'Playback token expired' });
  } else {
    access = await requirePermission(req, res, 'assets.read');
    if (!access) return;
  }

  const sql = access?.sql || neon(process.env.DATABASE_URL);
  await ensureCreatorOpsTables(sql);
  const [session] = await sql`
    SELECT id, video_url, file_name
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session?.video_url) return res.status(404).json({ error: 'Source not found' });

  let sourceUrl;
  try {
    sourceUrl = new URL(session.video_url);
  } catch {
    return res.status(400).json({ error: 'Session source URL is invalid' });
  }
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.blob.vercel-storage.com')) {
    return res.status(400).json({ error: 'Session source must be stored in HOWL Vercel Blob' });
  }

  const head = await fetch(sourceUrl, { method: 'HEAD' });
  if (!head.ok) return res.status(head.status).json({ error: 'Source video is not available' });

  const size = Number(head.headers.get('content-length') || 0);
  const type = head.headers.get('content-type') || 'video/mp4';
  const range = size ? parseRange(req.headers.range, size) : null;
  const upstreamHeaders = {};
  if (range) upstreamHeaders.Range = `bytes=${range.start}-${range.end}`;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Content-Disposition', `inline; filename="${(session.file_name || `ugc-${sessionId}.mp4`).replace(/"/g, '')}"`);

  if (req.method === 'HEAD') {
    if (range) {
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else if (size) {
      res.setHeader('Content-Length', String(size));
    }
    return res.end();
  }

  const upstream = await fetch(sourceUrl, { headers: upstreamHeaders });
  if (!upstream.ok && upstream.status !== 206) {
    return res.status(upstream.status).json({ error: 'Source video is not available' });
  }

  if (range && size) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else {
    res.statusCode = 200;
    const upstreamLength = upstream.headers.get('content-length');
    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
  }

  const reader = upstream.body?.getReader();
  if (!reader) return res.status(502).json({ error: 'Source stream unavailable' });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.destroy(err);
  }
}
