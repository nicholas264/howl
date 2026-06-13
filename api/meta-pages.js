// Lists Facebook Pages the system-user token can manage. Used by the UGC
// inbox to show a profile-picker dropdown instead of asking the user to
// paste a numeric Page ID.
import { requirePermission } from './_lib/app-access.js';

const BASE = 'https://graph.facebook.com/v21.0';

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, 'launch.read'))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) return res.status(500).json({ error: 'META_ACCESS_TOKEN not configured' });

  try {
    const r = await fetch(
      `${BASE}/me/accounts?fields=id,name,picture{url},username&limit=200&access_token=${accessToken}`
    );
    const data = await r.json();
    if (!r.ok || data.error) {
      return res.status(r.status || 500).json({ error: data.error?.message || 'Graph API error' });
    }
    const pages = (data.data || []).map(p => ({
      id: p.id,
      name: p.name || '',
      username: p.username || '',
      picture_url: p.picture?.data?.url || '',
    }));
    return res.json({ pages });
  } catch (err) {
    console.error('meta-pages error', err);
    return res.status(500).json({ error: err.message });
  }
}
