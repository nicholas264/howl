import { requirePermission } from './_lib/app-access.js';

const ALLOWED_HOSTS = [
  'vercel-storage.com',
  'blob.vercel-storage.com',
  'public.blob.vercel-storage.com',
  'fbcdn.net',
  'cdninstagram.com',
];

function allowedAvatarUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) ? url : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = allowedAvatarUrl(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'Valid avatar URL required' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(response.status).json({ error: text.slice(0, 200) || 'Avatar fetch failed' });
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: 'Avatar URL did not return an image' });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('creator-avatar error', err);
    return res.status(500).json({ error: err.message });
  }
}
