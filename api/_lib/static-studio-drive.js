import { createHash } from 'node:crypto';
import { assert, safeText } from '../../src/lib/static-studio/model.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
export function folderId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
  const id = match?.[1] || text;
  assert(/^[\w-]{10,150}$/.test(id), 'Paste a Google Drive folder link or folder ID.');
  return id;
}
function imageType(bytes) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// Transport injection is used by integration tests, not selected from browser input.
export function createStudioDrive({ token, fetchImpl = globalThis.fetch, putImpl }) {
  const request = (path, timeoutMs=20000) => fetchImpl(`${DRIVE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
  });
  async function json(path) {
    const response = await request(path);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'Drive request failed. Share this folder with the workspace Drive connection.');
    return body;
  }
  return {
    async list(folder, pageToken) {
      const id = folderId(folder);
      const query = new URLSearchParams({
        q: `'${id}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/webp')`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,imageMediaMetadata(width,height))',
        pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', orderBy: 'folder,name',
      });
      if (pageToken) query.set('pageToken', safeText(pageToken,1000));
      return json(`/files?${query}`);
    },
    async importOriginal(fileId) {
      assert(typeof fileId === 'string' && /^[\w-]{10,150}$/.test(fileId), 'Invalid Drive file ID');
      const file = await json(`/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,md5Checksum&supportsAllDrives=true`);
      assert(['image/jpeg','image/png','image/webp'].includes(file.mimeType), 'Import a JPEG, PNG, or WebP original.');
      const expectedSize = Number(file.size);
      assert(Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize <= MAX_ORIGINAL_BYTES, 'Original must be between 1 byte and 30 MB.');
      const response = await request(`/files/${fileId}?alt=media&supportsAllDrives=true`,45000);
      if (!response.ok) throw new Error(`Drive download failed (${response.status}).`);
      assert(response.body, 'Drive returned an empty original.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        assert(size <= MAX_ORIGINAL_BYTES, 'Original exceeds 30 MB.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      assert(size === expectedSize, 'Drive original changed or was truncated during import. Retry the import.');
      assert(imageType(bytes) === file.mimeType, 'Drive original bytes do not match the declared image type.');
      if (file.md5Checksum) assert(createHash('md5').update(bytes).digest('hex') === file.md5Checksum, 'Drive original changed during import. Retry the import.');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const extension = file.mimeType === 'image/png' ? 'png' : file.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const blob = await putImpl(`static-studio/originals/${sha256}.${extension}`,bytes,{
        access:'public', contentType:file.mimeType, addRandomSuffix:true,
      });
      return { url:blob.url, name:file.name, sha256, driveId:fileId, driveModified:file.modifiedTime };
    },
  };
}
