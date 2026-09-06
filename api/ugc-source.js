import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseMediaRange } from './_lib/media-range.js';
import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { verifyUgcSourceToken } from './ugc-source-token.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

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

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 55_000);
  const disconnect = () => controller.abort();
  res.once('close', disconnect);
  try {
    const head = await fetch(sourceUrl, { method: 'HEAD', redirect: 'error', signal: controller.signal });
    if (!head.ok) return res.status(head.status).json({ error: 'Source video is not available' });

    const size = Number(head.headers.get('content-length') || 0);
    const type = head.headers.get('content-type') || 'video/mp4';
    const range = parseMediaRange(req.headers.range, size);
    if (range === false) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    const upstreamHeaders = {};
    if (range) upstreamHeaders.Range = `bytes=${range.start}-${range.end}`;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `inline; filename="${(session.file_name || `ugc-${sessionId}.mp4`).replace(/["\r\n\x00-\x1f\x7f]/g, '')}"`);

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

    const upstream = await fetch(sourceUrl, { headers: upstreamHeaders, redirect: 'error', signal: controller.signal });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: 'Source video is not available' });
    }

    if (range && (upstream.status !== 206 || upstream.headers.get('content-range') !== `bytes ${range.start}-${range.end}/${size}`)) {
      await upstream.body?.cancel();
      return res.status(502).json({ error: 'Source returned an inconsistent byte range' });
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

    if (!upstream.body) return res.status(502).json({ error: 'Source stream unavailable' });
    await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
  } catch (err) {
    if (res.headersSent) res.destroy(err);
    else if (!res.destroyed) {
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.status(502).json({ error: 'Source stream unavailable' });
    }
  } finally {
    clearTimeout(deadline);
    res.off('close', disconnect);
  }
}
