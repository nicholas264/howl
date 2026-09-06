import { createHash } from 'node:crypto';
import { fetchPublicResource } from './safe-fetch.js';
import { getGoogleAccessToken } from './gcp-auth.js';

export const mediaDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function driveContentDigest(fileId) {
  const token = await getGoogleAccessToken(['https://www.googleapis.com/auth/drive.readonly']);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,md5Checksum,mimeType&supportsAllDrives=true`,
    {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const data = await response.json();
  if (!response.ok || !data.md5Checksum) throw new Error('Drive media must expose a content checksum before it can be approved.');
  return data.md5Checksum;
}

export async function captureApprovalEvidence(deliverable) {
  if (deliverable.output_url || (!deliverable.drive_file_id && deliverable.source_url)) {
    const media = await fetchPublicResource(deliverable.output_url || deliverable.source_url,
      {maxBytes:256*1024*1024,timeoutMs:45000,contentTypes:/^(video|image)\//i});
    return {sha256:mediaDigest(media.bytes),bytes:media.bytes.length};
  }
  if (deliverable.drive_file_id) return {drive_md5:await driveContentDigest(deliverable.drive_file_id)};
  throw new Error('Attach an output file before approving.');
}
