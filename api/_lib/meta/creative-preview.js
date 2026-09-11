function imageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      /(^|\.)(fbcdn\.net|fbsbx\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

// Resolve only media belonging to an already-ingested creative. The browser
// never supplies a provider URL or receives a Meta access token.
export async function loadCreativePreview(sql, ctx, groupKey, fetchImpl = globalThis.fetch) {
  if (typeof groupKey !== 'string' || !groupKey || groupKey.length > 200) throw Object.assign(new Error('A creative group is required'), { statusCode: 400 });
  const [creative] = await sql`SELECT creative_id, video_id FROM creative_performance
    WHERE group_key = ${groupKey} ORDER BY synced_at DESC NULLS LAST LIMIT 1`;
  if (!creative) throw Object.assign(new Error('Creative not found'), { statusCode: 404 });
  const read = async (path, params) => {
    const url = new URL(`${ctx.BASE}/${encodeURIComponent(path)}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${ctx.accessToken}` }, signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok || data.error) return null;
    return data;
  };
  let previewUrl = null;
  if (creative.video_id) {
    // Native video posters retain the video's aspect ratio and actual pixels.
    const url = new URL(`${ctx.BASE}/${encodeURIComponent(creative.video_id)}/thumbnails`);
    url.searchParams.set('fields', 'uri,width,height,is_preferred');
    url.searchParams.set('limit', '20');
    try {
      const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${ctx.accessToken}` }, signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (response.ok && !data.error) {
        const posters = (data.data || []).filter(p => imageUrl(p.uri) && Number(p.width) >= 480);
        posters.sort((a, b) => Number(b.width) * Number(b.height) - Number(a.width) * Number(a.height));
        previewUrl = imageUrl(posters[0]?.uri);
      }
    } catch { /* Try the account-owned ad creative below. */ }
  }
  if (!previewUrl && creative.creative_id) {
    const data = await read(creative.creative_id, { fields: 'account_id,thumbnail_url', thumbnail_width: '1080', thumbnail_height: '1080' });
    if (data && String(data.account_id) === String(ctx.adAccountId).replace(/^act_/, '')) previewUrl = imageUrl(data.thumbnail_url);
  }
  if (!previewUrl) throw Object.assign(new Error('Meta did not return a larger preview for this creative.'), { statusCode: 422 });
  await sql`UPDATE creative_performance SET thumbnail_url = ${previewUrl} WHERE group_key = ${groupKey}`;
  // Preserve original/media-store posters; replace only missing or Meta-derived ones.
  await sql`UPDATE creative_assets SET preview_url = ${previewUrl}
    WHERE group_key = ${groupKey} AND (preview_url IS NULL OR preview_url ~ '^https://[^/]+\\.(fbcdn\\.net|fbsbx\\.com)/')`;
  return { groupKey, previewUrl };
}
