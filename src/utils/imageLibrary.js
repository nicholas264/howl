// Shared image library — Vercel Blob upload + Neon record. Used by
// ImageAdTool and ReviewAdTool. Replaces the old localStorage key
// 'howl_saved_images', which silently dropped uploads past the LS quota.
import { upload } from '@vercel/blob/client';

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

  const token = await getToken();
  if (!token) throw new Error('Not signed in — please reload and sign in again.');

  let blobRes;
  try {
    blobRes = await upload(`image-library/${fileName}`, resized, {
      access: 'public',
      handleUploadUrl: '/api/blob/upload-token',
      clientPayload: token,
      contentType: resized.type || 'image/jpeg',
    });
  } catch (err) {
    console.error('Blob upload failed:', err);
    throw new Error(`Blob upload failed: ${err?.message || err}`);
  }

  const r = await fetch('/api/db/image-library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: blobRes.url, file_name: file.name }),
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
