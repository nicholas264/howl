// Same-origin proxy for Drive file thumbnails. Needed because the site sets
// Cross-Origin-Embedder-Policy: require-corp, which blocks lh3.googleusercontent.com
// thumbnails (no CORP / unreliable CORS). Returns the thumbnail bytes inline.
import { requirePermission } from '../_lib/app-access.js';
import { getGoogleAccessToken } from '../_lib/gcp-auth.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';

export default async function handler(req, res) {
  const auth = await requirePermission(req, res, 'assets.read');
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const fileId = (req.query.fileId || '').trim();
  if (!fileId) return res.status(400).json({ error: 'fileId required' });

  const sizeParam = parseInt(req.query.size || '320');
  const size = Math.max(64, Math.min(800, isNaN(sizeParam) ? 320 : sizeParam));

  try {
    const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/drive']);
    const meta = await fetch(`${DRIVE}/files/${fileId}?fields=thumbnailLink,mimeType&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meta.ok) {
      const txt = await meta.text();
      return res.status(meta.status).json({ error: `Drive metadata: ${txt.slice(0, 200)}` });
    }
    const m = await meta.json();
    if (!m.thumbnailLink) return res.status(404).json({ error: 'No thumbnail available' });
    // Drive returns links sized at =sNN; replace with requested size.
    const url = m.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`);

    const t = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!t.ok) {
      const txt = await t.text();
      return res.status(t.status).json({ error: `Thumb fetch: ${txt.slice(0, 200)}` });
    }
    const buf = Buffer.from(await t.arrayBuffer());
    res.setHeader('Content-Type', t.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('drive/thumb error', err);
    return res.status(500).json({ error: err.message });
  }
}
