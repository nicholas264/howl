// Mirrors a launched video buffer to Vercel Blob so the DNA analyzer can still
// pull the source even after Meta restricts video.source on its end.
//
// Best-effort: any failure returns null and the caller continues. We never want
// a Blob hiccup to break a Meta launch.
import { put } from '@vercel/blob';
import { fetchPublicResource } from '../safe-fetch.js';

const sanitize = (name) =>
  (name || 'video').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'video';

export async function mirrorAssetToBlob(buffer, mimeType, fileName) {
  try {
    if (!buffer || !buffer.length) return null;
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const d = new Date();
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `creative-assets/${ym}/${Date.now()}-${sanitize(fileName)}`;
    const { url } = await put(key, buffer, {
      access: 'public',
      contentType: mimeType || 'video/mp4',
      addRandomSuffix: true,
    });
    return url;
  } catch (err) {
    console.error('mirrorAssetToBlob failed:', err.message);
    return null;
  }
}

export const mirrorVideoToBlob = mirrorAssetToBlob;

export async function mirrorImageUrlToBlob(url, fileName = 'avatar') {
  try {
    if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return url || null;
    const {bytes:buffer,contentType:mimeType} = await fetchPublicResource(url,
      {maxBytes:10*1024*1024,timeoutMs:15000,contentTypes:/^image\/(jpeg|png|webp)(;|$)/i});
    const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    return await mirrorAssetToBlob(buffer, mimeType, `${fileName}.${extension}`) || url;
  } catch (err) {
    console.error('mirrorImageUrlToBlob failed:', err.message);
    return url || null;
  }
}
