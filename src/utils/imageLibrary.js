import { apiFetch as fetch } from '../lib/apiFetch.js';
// Shared image library — Vercel Blob upload + Neon record. Used by
// ImageAdTool and ReviewAdTool. Replaces the old localStorage key
// 'howl_saved_images', which silently dropped uploads past the LS quota.
//
// Note: we hand-roll the upload PUT instead of using @vercel/blob/client's
// upload(). In this app's runtime the SDK throws "Vercel Blob: Access denied"
// even when the same flow (handleUpload + clientToken + PUT) succeeds when
// invoked manually — both server-side and via plain fetch in the browser.
// Until that's understood, the manual flow is what actually works.

export async function fetchImageLibrary() {
  try {
    const r = await fetch('/api/db/image-library');
    const data = await r.json();
    return r.ok ? (data.images || []) : [];
  } catch { return []; }
}

export async function deleteImageRecord(id) {
  try {
    const r = await fetch(`/api/db/image-library?id=${id}`, { method: 'DELETE' });
    return r.ok;
  } catch { return false; }
}

// Resizes the file in the browser, uploads to Blob, and inserts a row.
// Returns the new record { id, url, file_name, created_at } or null.
export async function uploadImageToLibrary(file, getToken) {
  const resized = await resizeImage(file, 2160);
  const slug = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/\W+/g, '-').slice(0, 40).toLowerCase() || 'image';
  const fileName = `${slug}-${Date.now()}.jpg`;
  const pathname = `image-library/${fileName}`;

  const token = await getToken();
  if (!token) throw new Error('Not signed in — please reload and sign in again.');

  // Step 1: get a clientToken from our handleUpload endpoint.
  const tokenRes = await fetch('/api/blob/upload-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: { pathname, clientPayload: token, multipart: false },
    }),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text().catch(() => '');
    throw new Error(`upload-token failed (${tokenRes.status}): ${txt.slice(0, 200)}`);
  }
  const tokenData = await tokenRes.json();
  const clientToken = tokenData.clientToken;
  if (!clientToken) throw new Error(`upload-token returned no clientToken: ${JSON.stringify(tokenData).slice(0, 200)}`);

  // Step 2: PUT the blob directly. If Blob rejects, surface the exact body.
  const blobUrl = `https://blob.vercel-storage.com/?pathname=${encodeURIComponent(pathname)}`;
  const putRes = await fetch(blobUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'x-api-version': '12',
      'x-vercel-blob-access': 'public',
      'x-content-type': resized.type || 'image/jpeg',
    },
    body: resized,
  });
  if (!putRes.ok) {
    const txt = await putRes.text().catch(() => '');
    console.error('Blob PUT failed:', putRes.status, txt);
    throw new Error(`Blob PUT failed (${putRes.status}): ${txt.slice(0, 300)}`);
  }
  const blob = await putRes.json();

  // Step 3: record the URL in our DB.
  const r = await fetch('/api/db/image-library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: blob.url, file_name: file.name }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`DB record failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.image;
}

function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxDim || h > maxDim) {
          const s = maxDim / Math.max(w, h);
          w = Math.round(w * s); h = Math.round(h * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
