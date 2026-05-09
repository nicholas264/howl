// Lists Instagram business accounts available to the configured Meta ad
// account, plus any IG accounts linked to Pages the system user manages.
// Used by the UGC inbox to show a profile-picker dropdown instead of asking
// the user to paste a numeric IG ID.
import { requireAuth } from './_lib/auth.js';

const BASE = 'https://graph.facebook.com/v21.0';

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  if (!accessToken || !rawId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN / META_AD_ACCOUNT_ID not configured' });
  }
  const adAccount = `act_${rawId}`;

  const accounts = new Map(); // id -> { id, username, profile_pic_url, source }

  const tryFetch = async (url, mapper) => {
    try {
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${accessToken}`);
      const data = await r.json();
      if (!r.ok || data.error) return;
      mapper(data);
    } catch {}
  };

  // 1. IG accounts directly linked to the ad account.
  await tryFetch(
    `${BASE}/${adAccount}/instagram_accounts?fields=id,username,profile_pic`,
    (d) => {
      for (const a of (d.data || [])) {
        accounts.set(a.id, {
          id: a.id,
          username: a.username || '',
          profile_pic_url: a.profile_pic || '',
          source: 'ad_account',
        });
      }
    }
  );

  // 2. IG business accounts linked to Pages the token can manage.
  await tryFetch(
    `${BASE}/me/accounts?fields=name,instagram_business_account{id,username,profile_picture_url}&limit=100`,
    (d) => {
      for (const page of (d.data || [])) {
        const ig = page.instagram_business_account;
        if (!ig?.id) continue;
        if (!accounts.has(ig.id)) {
          accounts.set(ig.id, {
            id: ig.id,
            username: ig.username || '',
            profile_pic_url: ig.profile_picture_url || '',
            source: `page:${page.name}`,
          });
        }
      }
    }
  );

  return res.json({ accounts: Array.from(accounts.values()) });
}
