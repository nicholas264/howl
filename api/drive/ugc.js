// UGC inbox: Workload-Identity-Federation-backed Drive operations.
// Vercel OIDC → GCP STS → service account impersonation → Drive API.
// Actions: list, download, mark_launched, ensure_subfolders, launch_meta_ad
import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../_lib/auth.js';
import { getGoogleAccessToken } from '../_lib/gcp-auth.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';

async function getAccessToken() {
  return getGoogleAccessToken(['https://www.googleapis.com/auth/drive']);
}

async function driveFetch(token, path, init = {}) {
  const r = await fetch(`${DRIVE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `Drive API ${r.status}`);
  return d;
}

async function findChildFolder(token, parentId, name) {
  const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`);
  const d = await driveFetch(token, `/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return d.files?.[0] || null;
}

async function ensureFolder(token, parentId, name) {
  const existing = await findChildFolder(token, parentId, name);
  if (existing) return existing.id;
  const d = await driveFetch(token, '/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  return d.id;
}

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rootId = process.env.UGC_INBOX_FOLDER_ID;
  if (!rootId) return res.status(500).json({ error: 'UGC_INBOX_FOLDER_ID not configured' });

  try {
    const token = await getAccessToken();
    const { action } = req.body;

    if (action === 'ensure_subfolders') {
      const inboxId = await ensureFolder(token, rootId, 'Inbox');
      const launchedId = await ensureFolder(token, rootId, 'Launched');
      return res.json({ inboxId, launchedId });
    }

    if (action === 'list') {
      const inboxId = await ensureFolder(token, rootId, 'Inbox');
      const fields = encodeURIComponent('files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,parents)');
      // BFS walk: collect all files under Inbox (any depth). Folders we care about excluded from files list.
      const folderNames = { [inboxId]: 'Inbox' };
      const folderParents = { [inboxId]: null };
      const files = [];
      const queue = [inboxId];
      while (queue.length) {
        const batch = queue.splice(0, Math.min(10, queue.length));
        const qParts = batch.map(id => `'${id}' in parents`).join(' or ');
        const q = encodeURIComponent(`(${qParts}) and trashed=false`);
        const d = await driveFetch(token, `/files?q=${q}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`);
        for (const item of (d.files || [])) {
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            folderNames[item.id] = item.name;
            folderParents[item.id] = item.parents?.[0] || null;
            queue.push(item.id);
          } else {
            files.push(item);
          }
        }
      }
      // Build folder path (relative to Inbox) for each file
      const pathFor = (parentId) => {
        const parts = [];
        let cur = parentId;
        while (cur && cur !== inboxId) {
          parts.unshift(folderNames[cur] || '?');
          cur = folderParents[cur];
        }
        return parts.join(' / ');
      };
      const enriched = files.map(f => ({ ...f, folderPath: pathFor(f.parents?.[0]) }));
      enriched.sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''));
      return res.json({ files: enriched, inboxId });
    }

    if (action === 'download') {
      // Return file bytes as base64 (for push to Meta)
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: 'fileId required' });
      const r = await fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: `Download failed: ${txt.slice(0, 200)}` });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const mimeType = r.headers.get('content-type') || 'application/octet-stream';
      return res.json({ base64: buf.toString('base64'), mimeType, size: buf.length });
    }

    if (action === 'launch_meta_ad') {
      // End-to-end launch: streams NDJSON progress events so the client can render a live timeline.
      // Events: { step, status: "start"|"done"|"error", detail? }. Final: { done: true, adId, ... } or { done: true, error }.
      const { fileId, adsetId, pageId, destUrl, adName, headline, primaryText, creator, productId, angleId, campaignId } = req.body;

      // Stream headers
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      const emit = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };
      const fail = (step, error, detail) => { emit({ step, status: 'error', error, detail }); emit({ done: true, error: `${step}: ${error}` }); res.end(); };

      if (!fileId || !adsetId || !pageId || !destUrl || !adName) {
        return fail('validate', 'Missing required fields');
      }

      const metaToken = process.env.META_ACCESS_TOKEN;
      const rawAdId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
      const metaAdAccount = `act_${rawAdId}`;
      if (!metaToken || !rawAdId) {
        return fail('validate', 'Meta credentials not configured');
      }
      const GRAPH = 'https://graph.facebook.com/v21.0';

      // 1. Fetch bytes from Drive
      emit({ step: 'drive_download', status: 'start' });
      const fileMeta = await driveFetch(token, `/files/${fileId}?fields=name,mimeType,parents&supportsAllDrives=true`);
      const dlRes = await fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!dlRes.ok) {
        const txt = await dlRes.text();
        return fail('drive_download', txt.slice(0, 200));
      }
      const fileBuffer = Buffer.from(await dlRes.arrayBuffer());
      const mimeType = fileMeta.mimeType || dlRes.headers.get('content-type') || 'application/octet-stream';
      const isVideo = mimeType.startsWith('video/');
      emit({ step: 'drive_download', status: 'done', detail: `${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB` });

      // 2. Upload to Meta
      emit({ step: 'meta_upload', status: 'start', detail: isVideo ? 'video (resumable)' : 'image' });
      let videoId = null, imageHash = null;
      const parseMeta = async (r, step) => {
        const txt = await r.text();
        if (!txt) throw new Error(`${step}: HTTP ${r.status} (empty body — likely request too large or timeout)`);
        try { return JSON.parse(txt); }
        catch { throw new Error(`${step}: HTTP ${r.status} — non-JSON response: ${txt.slice(0, 300)}`); }
      };

      if (isVideo) {
        // Use Meta's Resumable Upload API for videos: start → transfer (chunks) → finish.
        // Avoids sync-upload timeouts and body-size limits that hit around 100MB+.
        const fileSize = fileBuffer.length;

        // Phase 1: start
        const startForm = new URLSearchParams({
          upload_phase: 'start',
          file_size: String(fileSize),
          access_token: metaToken,
        });
        const startRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: startForm,
        });
        const startData = await parseMeta(startRes, 'meta_upload_video_start');
        if (startData.error) return fail('meta_upload', startData.error.message, startData.error);
        const uploadSessionId = startData.upload_session_id;
        videoId = startData.video_id;
        let startOffset = parseInt(startData.start_offset);
        let endOffset = parseInt(startData.end_offset);
        const total = fileBuffer.length;

        // Phase 2: transfer chunks until start_offset === end_offset
        while (startOffset < endOffset) {
          const chunk = fileBuffer.slice(startOffset, endOffset);
          const transferForm = new FormData();
          transferForm.append('access_token', metaToken);
          transferForm.append('upload_phase', 'transfer');
          transferForm.append('upload_session_id', uploadSessionId);
          transferForm.append('start_offset', String(startOffset));
          transferForm.append('video_file_chunk', new Blob([chunk], { type: mimeType }), `chunk-${startOffset}`);
          const transferRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, {
            method: 'POST',
            body: transferForm,
          });
          const transferData = await parseMeta(transferRes, 'meta_upload_video_transfer');
          if (transferData.error) return fail('meta_upload', transferData.error.message, transferData.error);
          startOffset = parseInt(transferData.start_offset);
          endOffset = parseInt(transferData.end_offset);
          emit({ step: 'meta_upload', status: 'progress', detail: `${Math.round(startOffset / total * 100)}%` });
        }

        // Phase 3: finish
        const finishForm = new URLSearchParams({
          upload_phase: 'finish',
          upload_session_id: uploadSessionId,
          title: adName,
          access_token: metaToken,
        });
        const finishRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: finishForm,
        });
        const finishData = await parseMeta(finishRes, 'meta_upload_video_finish');
        if (finishData.error) return fail('meta_upload', finishData.error.message, finishData.error);
        emit({ step: 'meta_upload', status: 'done', detail: `video ${videoId}` });
      }

      // Ads with video_data need a thumbnail. Poll Meta for the auto-generated one
      // with exponential-ish backoff to stay gentle on the rate limit.
      let videoThumbnailUrl = null;
      if (videoId) {
        emit({ step: 'meta_thumbnail', status: 'start' });
        const delaysMs = [5000, 5000, 7000, 10000, 15000, 20000, 20000, 30000]; // ~112s total
        for (let i = 0; i < delaysMs.length; i++) {
          await new Promise(r => setTimeout(r, delaysMs[i]));
          const thumbRes = await fetch(`${GRAPH}/${videoId}/thumbnails?fields=uri,is_preferred&access_token=${metaToken}`);
          const thumbData = await parseMeta(thumbRes, 'meta_thumbnail');
          if (thumbData.error) {
            if (thumbData.error.code === 17 || /request limit/i.test(thumbData.error.message || '')) {
              return fail('meta_thumbnail', 'Meta rate limit — wait a few minutes and retry.', thumbData.error);
            }
            if (i >= delaysMs.length - 1) return fail('meta_thumbnail', `Thumbnail not ready: ${thumbData.error.message}`, thumbData.error);
            emit({ step: 'meta_thumbnail', status: 'progress', detail: `attempt ${i + 1}` });
            continue;
          }
          const thumbs = thumbData.data || [];
          const preferred = thumbs.find(t => t.is_preferred) || thumbs[0];
          if (preferred?.uri) { videoThumbnailUrl = preferred.uri; break; }
          emit({ step: 'meta_thumbnail', status: 'progress', detail: `waiting for processing` });
        }
        if (!videoThumbnailUrl) return fail('meta_thumbnail', 'No thumbnail generated in time (video still processing)');
        emit({ step: 'meta_thumbnail', status: 'done' });
      }

      if (!videoId) {
        const form = new FormData();
        form.append('access_token', metaToken);
        form.append('source', new Blob([fileBuffer], { type: mimeType }), fileMeta.name);
        const r = await fetch(`${GRAPH}/${metaAdAccount}/adimages`, { method: 'POST', body: form });
        const d = await parseMeta(r, 'meta_upload_image');
        if (d.error) return fail('meta_upload', d.error.message, d.error);
        imageHash = Object.values(d.images || {})[0]?.hash;
        if (!imageHash) return fail('meta_upload', 'No image hash returned');
        emit({ step: 'meta_upload', status: 'done', detail: `image ${imageHash.slice(0, 8)}…` });
      }

      // 3. Create creative
      emit({ step: 'meta_creative', status: 'start' });
      const objectStorySpec = videoId
        ? { page_id: pageId, video_data: { video_id: videoId, image_url: videoThumbnailUrl, message: primaryText || headline || '', title: headline || '', call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } } } }
        : { page_id: pageId, link_data: { image_hash: imageHash, link: destUrl, message: primaryText || headline || '', name: headline || '', call_to_action: { type: 'SHOP_NOW' } } };
      const creativeParams = new URLSearchParams({
        name: `${adName} Creative`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: metaToken,
      });
      const creativeRes = await fetch(`${GRAPH}/${metaAdAccount}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: creativeParams,
      });
      const creativeData = await creativeRes.json();
      if (creativeData.error) {
        return fail('meta_creative', creativeData.error.error_user_msg || creativeData.error.message, creativeData.error);
      }
      emit({ step: 'meta_creative', status: 'done' });

      // 4. Create ad (PAUSED)
      emit({ step: 'meta_ad', status: 'start' });
      const adParams = new URLSearchParams({
        name: adName,
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: creativeData.id }),
        status: 'PAUSED',
        access_token: metaToken,
      });
      const adRes = await fetch(`${GRAPH}/${metaAdAccount}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: adParams,
      });
      const adData = await adRes.json();
      if (adData.error) {
        return fail('meta_ad', adData.error.message, adData.error);
      }
      emit({ step: 'meta_ad', status: 'done', detail: adData.id });

      // 5. Mark launched on Drive (rename + move to Launched/)
      emit({ step: 'drive_move', status: 'start' });
      const launchedId = await ensureFolder(token, rootId, 'Launched');
      const ext = fileMeta.name.includes('.') ? fileMeta.name.substring(fileMeta.name.lastIndexOf('.')) : '';
      const base = fileMeta.name.replace(ext, '');
      const finalName = `${base}__LAUNCHED__${adData.id}${ext}`;
      const removeParents = (fileMeta.parents || []).join(',');
      await driveFetch(
        token,
        `/files/${fileId}?addParents=${launchedId}&removeParents=${encodeURIComponent(removeParents)}&fields=id,name&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalName }),
        }
      );
      emit({ step: 'drive_move', status: 'done', detail: finalName });

      // 6. Log to launch_history (best-effort — don't fail the launch on DB error)
      emit({ step: 'db_log', status: 'start' });
      try {
        if (process.env.DATABASE_URL) {
          const sql = neon(process.env.DATABASE_URL);
          await sql`
            INSERT INTO launch_history
              (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type)
            VALUES
              (${adData.id}, ${adsetId}, ${campaignId || null}, ${fileId}, ${fileMeta.name}, ${creator || null}, ${productId || null}, ${angleId || null}, ${adName}, ${headline || null}, ${primaryText || null}, ${destUrl}, ${mimeType})
          `;
          emit({ step: 'db_log', status: 'done' });
        } else {
          emit({ step: 'db_log', status: 'done', detail: 'no DB configured' });
        }
      } catch (dbErr) {
        emit({ step: 'db_log', status: 'error', error: dbErr.message });
      }

      emit({ done: true, adId: adData.id, videoId, imageHash });
      return res.end();
    }

    if (action === 'mark_launched') {
      const { fileId, adId, newName } = req.body;
      if (!fileId || !adId) return res.status(400).json({ error: 'fileId and adId required' });

      const launchedId = await ensureFolder(token, rootId, 'Launched');

      // Fetch current name + parents so we can rename + move in one call
      const current = await driveFetch(token, `/files/${fileId}?fields=name,parents&supportsAllDrives=true`);
      const ext = current.name.includes('.') ? current.name.substring(current.name.lastIndexOf('.')) : '';
      const base = current.name.replace(ext, '');
      const finalName = newName || `${base}__LAUNCHED__${adId}${ext}`;
      const removeParents = (current.parents || []).join(',');

      const updated = await driveFetch(
        token,
        `/files/${fileId}?addParents=${launchedId}&removeParents=${encodeURIComponent(removeParents)}&fields=id,name,parents&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalName }),
        }
      );
      return res.json({ success: true, file: updated });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('UGC Drive error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 300,
};
