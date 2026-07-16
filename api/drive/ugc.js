// UGC inbox: Workload-Identity-Federation-backed Drive operations.
// Vercel OIDC → GCP STS → service account impersonation → Drive API.
// Actions: list, download, mark_launched, ensure_subfolders, launch_meta_ad
import { neon } from '@neondatabase/serverless';
import { hasPermission, requireWorkspaceAccess } from '../_lib/app-access.js';
import { assertBrandSafe } from '../_lib/brand-guardrails.js';
import { getGoogleAccessToken } from '../_lib/gcp-auth.js';
import { mirrorAssetToBlob } from '../_lib/blob/mirror.js';
import { enqueueCreativeAssetAnalysis } from '../_lib/creative-analysis-queue.js';
import { ensureCreativeAssetTables, markCreativeAssetLaunched, upsertDriveAsset } from '../_lib/creative-assets.js';
import { ensureCreatorOpsTables } from '../_lib/creator-ops.js';

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

async function stampFlowLaunched(sql, { adId, groupKey, briefId, deliverableId }) {
  if (!briefId && !deliverableId) return;
  try {
    await ensureCreatorOpsTables(sql);
    await sql`
      UPDATE flow_cards
      SET stage = 'analyze',
          ad_id = ${adId},
          group_key = COALESCE(group_key, ${groupKey || adId || null}),
          deliverable_id = COALESCE(deliverable_id, ${deliverableId || null}),
          updated_at = now()
      WHERE NOT archived
        AND (
          (${deliverableId || null}::bigint IS NOT NULL AND deliverable_id = ${deliverableId || null})
          OR (${briefId || null}::bigint IS NOT NULL AND brief_id = ${briefId || null})
        )
    `;
  } catch (err) {
    console.error('flow launch stamp failed:', err.message);
  }
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

async function loadHiddenUgcIds() {
  if (!process.env.DATABASE_URL) return new Set();
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS ugc_hidden (file_id TEXT PRIMARY KEY, hidden_at TIMESTAMPTZ DEFAULT NOW())`;
    const rows = await sql`SELECT file_id FROM ugc_hidden`;
    return new Set(rows.map(r => r.file_id));
  } catch {
    return new Set();
  }
}

async function collectInboxFiles(token, inboxId, hiddenIds = new Set()) {
  const fields = encodeURIComponent('files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,parents,videoMediaMetadata(width,height),imageMediaMetadata(width,height))');
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
      } else if (!hiddenIds.has(item.id)) {
        files.push(item);
      }
    }
  }

  const pathFor = (parentId) => {
    const parts = [];
    let cur = parentId;
    while (cur && cur !== inboxId) {
      parts.unshift(folderNames[cur] || '?');
      cur = folderParents[cur];
    }
    return parts.join(' / ');
  };

  return {
    folderNames,
    files: files.map(f => ({ ...f, folderPath: pathFor(f.parents?.[0]) })),
  };
}

function buildLauncherItems(enriched, folderNames, inboxId) {
  // Group same-creative aspect variants under a shared parent. Feed assets
  // include 1:1, 4:5, and landscape; story assets are the taller 9:16 family.
  const dimsFor = (f) => {
    const v = f.videoMediaMetadata, i = f.imageMediaMetadata;
    const width = parseInt(v?.width || i?.width || 0);
    const height = parseInt(v?.height || i?.height || 0);
    return { width, height };
  };

  const aspectLabelFor = (f) => {
    const n = (f.name || '').toLowerCase();
    if (/(9\s*[x:]\s*16|916|story|stories|reel|vertical)/.test(n)) return '9:16';
    if (/(4\s*[x:]\s*5|45|portrait|feed)/.test(n)) return '4:5';
    if (/(1\s*[x:]\s*1|11|square)/.test(n)) return '1:1';
    if (/(16\s*[x:]\s*9|169|landscape)/.test(n)) return '16:9';

    const { width, height } = dimsFor(f);
    if (!(width > 0 && height > 0)) return null;
    const ratio = width / height;
    if (ratio < 0.68) return '9:16';
    if (ratio < 0.92) return '4:5';
    if (ratio < 1.12) return '1:1';
    return '16:9';
  };

  const aspectFor = (f) => {
    const label = aspectLabelFor(f);
    if (!label) return null;
    return label === '9:16' ? 'story' : 'feed';
  };

  const variantKeyFor = (f) => {
    const parent = f.parents?.[0] || inboxId;
    const type = f.mimeType?.startsWith('video/') ? 'video' : f.mimeType?.startsWith('image/') ? 'image' : 'file';
    const stem = (f.name || '')
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/\b(9\s*[x:]\s*16|4\s*[x:]\s*5|1\s*[x:]\s*1|16\s*[x:]\s*9|916|45|11|169)\b/g, ' ')
      .replace(/\b(story|stories|reels?|vertical|portrait|feed|square|landscape)\b/g, ' ')
      .replace(/\b(copy|final|export|asset|creative|video|image)\b/g, ' ')
      .replace(/[_\-.()[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${parent}:${type}:${stem || folderNames[parent] || parent}`;
  };

  const byParent = {};
  for (const f of enriched) {
    const p = f.parents?.[0] || inboxId;
    if (!byParent[p]) byParent[p] = [];
    byParent[p].push(f);
  }

  const pairedFileIds = new Set();
  const pairItems = [];
  const byCreated = (a, b) => (a.createdTime || '').localeCompare(b.createdTime || '');
  const feedScore = (f) => {
    const label = aspectLabelFor(f);
    if (label === '4:5') return 0;
    if (label === '1:1') return 1;
    if (label === '16:9') return 2;
    return 9;
  };
  const storyScore = (f) => aspectLabelFor(f) === '9:16' ? 0 : 9;
  const makePair = (parentId, feed, story) => {
    pairedFileIds.add(feed.id);
    pairedFileIds.add(story.id);
    const feedAspect = aspectLabelFor(feed) || 'Feed';
    const storyAspect = aspectLabelFor(story) || 'Story';
    pairItems.push({
      kind: 'pair',
      id: `pair:${parentId}:${feed.id}:${story.id}`,
      folderId: parentId,
      folderName: folderNames[parentId] || '',
      folderPath: feed.folderPath,
      feed,
      story,
      feedAspect,
      storyAspect,
      aspectLabel: `${feedAspect} + ${storyAspect}`,
      mimeType: feed.mimeType,
      createdTime: feed.createdTime > story.createdTime ? feed.createdTime : story.createdTime,
      name: folderNames[parentId] || feed.name,
    });
  };

  for (const [parentId, list] of Object.entries(byParent)) {
    if (list.length < 2) continue;
    const buckets = { video: [], image: [] };
    for (const f of list) {
      if (f.mimeType?.startsWith('video/')) buckets.video.push(f);
      else if (f.mimeType?.startsWith('image/')) buckets.image.push(f);
    }
    for (const sameTypeList of [buckets.video, buckets.image]) {
      if (sameTypeList.length < 2) continue;
      const feeds = [];
      const stories = [];
      const unknown = [];
      let groupedPairCount = 0;
      for (const f of sameTypeList) {
        const a = aspectFor(f);
        if (a === 'feed') feeds.push(f);
        else if (a === 'story') stories.push(f);
        else unknown.push(f);
      }
      if (sameTypeList.length === 2) {
        const [a, b] = sameTypeList;
        let feed, story;
        const aa = aspectFor(a), ab = aspectFor(b);
        if (aa === 'feed' || ab === 'story') { feed = a; story = b; }
        else if (ab === 'feed' || aa === 'story') { feed = b; story = a; }
        else {
          const sa = parseInt(a.size || 0), sb = parseInt(b.size || 0);
          if (sa >= sb) { feed = a; story = b; } else { feed = b; story = a; }
        }
        feeds.length = 0; stories.length = 0; unknown.length = 0;
        feeds.push(feed); stories.push(story);
      } else {
        const grouped = {};
        for (const f of sameTypeList) {
          const k = variantKeyFor(f);
          if (!grouped[k]) grouped[k] = [];
          grouped[k].push(f);
        }
        for (const group of Object.values(grouped)) {
          if (group.length < 2) continue;
          const groupFeeds = group.filter(f => aspectFor(f) === 'feed').sort((a, b) => feedScore(a) - feedScore(b) || byCreated(a, b));
          const groupStories = group.filter(f => aspectFor(f) === 'story').sort((a, b) => storyScore(a) - storyScore(b) || byCreated(a, b));
          const pairCount = Math.min(groupFeeds.length, groupStories.length);
          for (let i = 0; i < pairCount; i++) {
            makePair(parentId, groupFeeds[i], groupStories[i]);
            groupedPairCount += 1;
            feeds.splice(feeds.findIndex(f => f.id === groupFeeds[i].id), 1);
            stories.splice(stories.findIndex(f => f.id === groupStories[i].id), 1);
          }
        }
      }
      if (sameTypeList.length > 2 && unknown.length) {
        while (unknown.length && (feeds.length === 0 || stories.length === 0)) {
          const u = unknown.shift();
          if (feeds.length === 0) feeds.push(u);
          else stories.push(u);
        }
      }
      feeds.sort((a, b) => feedScore(a) - feedScore(b) || byCreated(a, b));
      stories.sort((a, b) => storyScore(a) - storyScore(b) || byCreated(a, b));
      const allowLoosePairing = sameTypeList.length === 2 || (groupedPairCount === 0 && feeds.length === 1 && stories.length === 1);
      const pairCount = allowLoosePairing ? Math.min(feeds.length, stories.length) : 0;
      for (let i = 0; i < pairCount; i++) {
        if (pairedFileIds.has(feeds[i].id) || pairedFileIds.has(stories[i].id)) continue;
        makePair(parentId, feeds[i], stories[i]);
      }
    }
  }

  const items = [
    ...pairItems,
    ...enriched.filter(f => !pairedFileIds.has(f.id)).map(f => ({ kind: 'single', ...f })),
  ];
  items.sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''));
  return items;
}

export default async function handler(req, res) {
  const appAccess = await requireWorkspaceAccess(req, res);
  if (!appAccess) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rootId = process.env.UGC_INBOX_FOLDER_ID;
  if (!rootId) return res.status(500).json({ error: 'UGC_INBOX_FOLDER_ID not configured' });

  try {
    const token = await getAccessToken();
    const { action } = req.body;
    if (action === 'launch_meta_ad' && !hasPermission(appAccess, 'launch.write')) {
      return res.status(403).json({ error: 'Forbidden - launch.write required' });
    }
    if (['delete', 'mark_launched', 'ensure_subfolders'].includes(action) && !hasPermission(appAccess, 'assets.write')) {
      return res.status(403).json({ error: 'Forbidden - assets.write required' });
    }
    if (['list', 'count', 'download'].includes(action) && !hasPermission(appAccess, 'assets.read')) {
      return res.status(403).json({ error: 'Forbidden - assets.read required' });
    }

    if (action === 'delete') {
      // Tool-local hide: file stays in Drive, just gets filtered out of `list`.
      // Service account often lacks Drive write perms, so trashing isn't reliable.
      const { fileId } = req.body;
      if (!fileId) return res.status(400).json({ error: 'fileId required' });
      if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL not configured' });
      const sql = neon(process.env.DATABASE_URL);
      await sql`CREATE TABLE IF NOT EXISTS ugc_hidden (file_id TEXT PRIMARY KEY, hidden_at TIMESTAMPTZ DEFAULT NOW())`;
      await sql`INSERT INTO ugc_hidden (file_id) VALUES (${fileId}) ON CONFLICT (file_id) DO NOTHING`;
      return res.json({ ok: true });
    }

    if (action === 'count') {
      // Count launcher-visible cards, not raw Drive files. This keeps the
      // sidebar badge aligned with hidden filtering and feed/story grouping.
      const inboxId = await ensureFolder(token, rootId, 'Inbox');
      const hiddenIds = await loadHiddenUgcIds();
      const { files, folderNames } = await collectInboxFiles(token, inboxId, hiddenIds);
      const items = buildLauncherItems(files, folderNames, inboxId);
      return res.json({ count: items.length });
    }

    if (action === 'ensure_subfolders') {
      const inboxId = await ensureFolder(token, rootId, 'Inbox');
      const launchedId = await ensureFolder(token, rootId, 'Launched');
      return res.json({ inboxId, launchedId });
    }

    if (action === 'list') {
      const inboxId = await ensureFolder(token, rootId, 'Inbox');
      const hiddenIds = await loadHiddenUgcIds();
      const { files: enriched, folderNames } = await collectInboxFiles(token, inboxId, hiddenIds);
      if (process.env.DATABASE_URL) {
        try {
          const sql = neon(process.env.DATABASE_URL);
          await ensureCreatorOpsTables(sql);
          await ensureCreativeAssetTables(sql);
          for (let i = 0; i < enriched.length; i += 20) {
            await Promise.all(
              enriched.slice(i, i + 20).map(file => upsertDriveAsset(sql, file, file.folderPath, false)),
            );
          }
        } catch (err) {
          console.error('creative asset indexing failed:', err.message);
        }
      }

      const items = buildLauncherItems(enriched, folderNames, inboxId);

      // Backwards-compat: also return `files` for older clients (just the singles).
      return res.json({ items, files: items.filter(i => i.kind === 'single'), inboxId });
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
      // Accepts EITHER a single fileId OR a pair { feedFileId, storyFileId } for placement-asset customization.
      const {
        fileId, pair, adsetId, pageId, destUrl, adName, headline, primaryText,
        creator, creatorId, sourceType, sourceLabel, briefId, deliverableId, productId, angleId, campaignId,
      } = req.body;
      const attributionSourceType = sourceType || (creatorId ? 'external_creator' : null);
      const attributionSourceLabel = sourceLabel || creator || null;
      const isPair = !!pair && pair.feedFileId && pair.storyFileId;
      await ensureCreatorOpsTables(appAccess.sql);
      await assertBrandSafe(appAccess.sql, [adName, headline, primaryText].filter(Boolean).join('\n'));
      // Instagram User ID is required by Meta when the ad targets Instagram
      // placements (Reels, Stories). Allow per-launch override but fall back
      // to the META_INSTAGRAM_USER_ID env var.
      const instagramUserId = (req.body.instagramUserId || process.env.META_INSTAGRAM_USER_ID || '').trim() || null;

      // Stream headers
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      const emit = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };
      const fail = (step, error, detail) => {
        const detailStr = detail == null ? undefined : (typeof detail === 'string' ? detail : JSON.stringify(detail));
        emit({ step, status: 'error', error, detail: detailStr });
        emit({ done: true, error: `${step}: ${error}` });
        res.end();
      };

      if ((!fileId && !isPair) || !adsetId || !pageId || !destUrl || !adName) {
        return fail('validate', 'Missing required fields');
      }

      const metaToken = process.env.META_ACCESS_TOKEN;
      const rawAdId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
      const metaAdAccount = `act_${rawAdId}`;
      if (!metaToken || !rawAdId) {
        return fail('validate', 'Meta credentials not configured');
      }
      const GRAPH = 'https://graph.facebook.com/v21.0';

      const parseMeta = async (r, step) => {
        const txt = await r.text();
        if (!txt) throw new Error(`${step}: HTTP ${r.status} (empty body — likely request too large or timeout)`);
        try { return JSON.parse(txt); }
        catch { throw new Error(`${step}: HTTP ${r.status} — non-JSON response: ${txt.slice(0, 300)}`); }
      };

      // Helper: download a Drive file, upload to Meta (video resumable or image),
      // poll for video thumbnail. Returns { videoId, imageHash, thumbnailUrl, fileMeta, mimeType }.
      // Emits: drive_download, meta_upload, meta_thumbnail steps with role suffix when paired.
      const processAsset = async (fid, role) => {
        const stepLabel = (s) => role ? `${s}_${role}` : s;
        emit({ step: stepLabel('drive_download'), status: 'start' });
        const fmeta = await driveFetch(token, `/files/${fid}?fields=name,mimeType,parents&supportsAllDrives=true`);
        if ((fmeta.name || '').includes('__LAUNCHED__')) {
          const e = new Error(`Already launched (file renamed by another user). Refresh the inbox.`);
          e.alreadyLaunched = true;
          throw e;
        }
        const dl = await fetch(`${DRIVE}/files/${fid}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!dl.ok) throw new Error(`drive_download${role ? ` (${role})` : ''}: ${(await dl.text()).slice(0, 200)}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const mt = fmeta.mimeType || dl.headers.get('content-type') || 'application/octet-stream';
        const isVid = mt.startsWith('video/');
        emit({ step: stepLabel('drive_download'), status: 'done', detail: `${(buf.length / 1024 / 1024).toFixed(1)}MB` });

        emit({ step: stepLabel('meta_upload'), status: 'start', detail: isVid ? 'video (resumable)' : 'image' });
        let vId = null, iHash = null;
        if (isVid) {
          const fileSize = buf.length;
          const startForm = new URLSearchParams({ upload_phase: 'start', file_size: String(fileSize), access_token: metaToken });
          const startRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: startForm });
          const startData = await parseMeta(startRes, 'meta_upload_video_start');
          if (startData.error) throw new Error(`meta_upload${role ? ` (${role})` : ''}: ${startData.error.message}`);
          const sessionId = startData.upload_session_id;
          vId = startData.video_id;
          let so = parseInt(startData.start_offset);
          let eo = parseInt(startData.end_offset);
          const total = buf.length;
          while (so < eo) {
            const chunk = buf.slice(so, eo);
            const tForm = new FormData();
            tForm.append('access_token', metaToken);
            tForm.append('upload_phase', 'transfer');
            tForm.append('upload_session_id', sessionId);
            tForm.append('start_offset', String(so));
            tForm.append('video_file_chunk', new Blob([chunk], { type: mt }), `chunk-${so}`);
            const tRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, { method: 'POST', body: tForm });
            const tData = await parseMeta(tRes, 'meta_upload_video_transfer');
            if (tData.error) throw new Error(`meta_upload${role ? ` (${role})` : ''}: ${tData.error.message}`);
            so = parseInt(tData.start_offset);
            eo = parseInt(tData.end_offset);
            emit({ step: stepLabel('meta_upload'), status: 'progress', detail: `${Math.round(so / total * 100)}%` });
          }
          const fForm = new URLSearchParams({ upload_phase: 'finish', upload_session_id: sessionId, title: adName, access_token: metaToken });
          const fRes = await fetch(`${GRAPH}/${metaAdAccount}/advideos`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fForm });
          const fData = await parseMeta(fRes, 'meta_upload_video_finish');
          if (fData.error) throw new Error(`meta_upload${role ? ` (${role})` : ''}: ${fData.error.message}`);
          emit({ step: stepLabel('meta_upload'), status: 'done', detail: `video ${vId}` });
        } else {
          const form = new FormData();
          form.append('access_token', metaToken);
          form.append('source', new Blob([buf], { type: mt }), fmeta.name);
          const r = await fetch(`${GRAPH}/${metaAdAccount}/adimages`, { method: 'POST', body: form });
          const d = await parseMeta(r, 'meta_upload_image');
          if (d.error) throw new Error(`meta_upload${role ? ` (${role})` : ''}: ${d.error.message}`);
          iHash = Object.values(d.images || {})[0]?.hash;
          if (!iHash) throw new Error(`meta_upload${role ? ` (${role})` : ''}: no image hash returned`);
          emit({ step: stepLabel('meta_upload'), status: 'done', detail: `image ${iHash.slice(0, 8)}…` });
        }

        let thumb = null;
        if (vId) {
          emit({ step: stepLabel('meta_thumbnail'), status: 'start' });
          const delays = [5000, 5000, 7000, 10000, 15000, 20000, 20000, 30000, 30000, 30000];
          let videoReady = false;
          for (let i = 0; i < delays.length; i++) {
            await new Promise(r => setTimeout(r, delays[i]));
            // Check video processing status — required before creative creation.
            const sRes = await fetch(`${GRAPH}/${vId}?fields=status&access_token=${metaToken}`);
            const sData = await parseMeta(sRes, 'meta_thumbnail');
            if (sData.error) {
              if (sData.error.code === 17 || /request limit/i.test(sData.error.message || '')) throw new Error('Meta rate limit — wait a few minutes and retry.');
              emit({ step: stepLabel('meta_thumbnail'), status: 'progress', detail: `status check failed (attempt ${i + 1})` });
              continue;
            }
            const vStatus = sData.status?.video_status;
            if (vStatus === 'error') throw new Error(`Video processing failed: ${sData.status?.processing_progress || 'unknown'}`);
            if (vStatus === 'ready') {
              videoReady = true;
              // Try thumbnail (best-effort once video is ready).
              const tRes = await fetch(`${GRAPH}/${vId}/thumbnails?fields=uri,is_preferred&access_token=${metaToken}`);
              const tData = await parseMeta(tRes, 'meta_thumbnail');
              if (!tData.error) {
                const arr = tData.data || [];
                const preferred = arr.find(t => t.is_preferred) || arr[0];
                if (preferred?.uri) thumb = preferred.uri;
              }
              break;
            }
            emit({ step: stepLabel('meta_thumbnail'), status: 'progress', detail: `${vStatus || 'processing'} (${i + 1})` });
          }
          if (!videoReady) throw new Error('Video still processing after timeout — try again in a minute.');
          emit({ step: stepLabel('meta_thumbnail'), status: 'done', detail: thumb ? 'ready' : 'ready (no thumb — auto)' });
        }

        // Mirror the original asset so analysis is independent of expiring Drive
        // and Meta URLs. Best-effort — never breaks launch.
        let blobUrl = null;
        emit({ step: stepLabel('blob_mirror'), status: 'start' });
        blobUrl = await mirrorAssetToBlob(buf, mt, fmeta.name);
        emit({ step: stepLabel('blob_mirror'), status: 'done', detail: blobUrl ? 'mirrored' : 'skipped' });

        return { videoId: vId, imageHash: iHash, thumbnailUrl: thumb, fileMeta: fmeta, mimeType: mt, blobUrl };
      };

      // ── PAIR PATH ───────────────────────────────────────────────────────────
      if (isPair) {
        try {
          const [feed, story] = await Promise.all([
            processAsset(pair.feedFileId, 'feed'),
            processAsset(pair.storyFileId, 'story'),
          ]);

          // Build asset_feed_spec for placement-asset customization
          emit({ step: 'meta_creative', status: 'start' });
          const isVid = !!feed.videoId;
          const assetFeedSpec = isVid ? {
            videos: [
              { video_id: feed.videoId, ...(feed.thumbnailUrl ? { thumbnail_url: feed.thumbnailUrl } : {}), adlabels: [{ name: 'video_feed' }] },
              { video_id: story.videoId, ...(story.thumbnailUrl ? { thumbnail_url: story.thumbnailUrl } : {}), adlabels: [{ name: 'video_story' }] },
            ],
            bodies: [{ text: primaryText || headline || '' }],
            titles: [{ text: headline || '' }],
            link_urls: [{ website_url: destUrl }],
            call_to_action_types: ['SHOP_NOW'],
            ad_formats: ['SINGLE_VIDEO'],
            asset_customization_rules: [
              {
                customization_spec: {
                  publisher_platforms: ['facebook', 'instagram'],
                  facebook_positions: ['feed', 'video_feeds', 'marketplace', 'instream_video'],
                  instagram_positions: ['stream', 'explore'],
                },
                video_label: { name: 'video_feed' },
              },
              {
                customization_spec: {
                  publisher_platforms: ['facebook', 'instagram'],
                  facebook_positions: ['story', 'facebook_reels'],
                  instagram_positions: ['story', 'reels'],
                },
                video_label: { name: 'video_story' },
              },
            ],
          } : {
            images: [
              { hash: feed.imageHash, adlabels: [{ name: 'image_feed' }] },
              { hash: story.imageHash, adlabels: [{ name: 'image_story' }] },
            ],
            bodies: [{ text: primaryText || headline || '' }],
            titles: [{ text: headline || '' }],
            link_urls: [{ website_url: destUrl }],
            call_to_action_types: ['SHOP_NOW'],
            ad_formats: ['SINGLE_IMAGE'],
            asset_customization_rules: [
              {
                customization_spec: {
                  publisher_platforms: ['facebook', 'instagram'],
                  facebook_positions: ['feed', 'marketplace'],
                  instagram_positions: ['stream', 'explore'],
                },
                image_label: { name: 'image_feed' },
              },
              {
                customization_spec: {
                  publisher_platforms: ['facebook', 'instagram'],
                  facebook_positions: ['story', 'facebook_reels'],
                  instagram_positions: ['story', 'reels'],
                },
                image_label: { name: 'image_story' },
              },
            ],
          };

          const creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
            }),
            asset_feed_spec: JSON.stringify(assetFeedSpec),
            access_token: metaToken,
          });
          const creativeRes = await fetch(`${GRAPH}/${metaAdAccount}/adcreatives`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: creativeParams,
          });
          const creativeData = await parseMeta(creativeRes, 'meta_creative');
          if (creativeData.error) return fail('meta_creative', creativeData.error.error_user_msg || creativeData.error.message, creativeData.error);
          emit({ step: 'meta_creative', status: 'done' });

          // Create ad
          emit({ step: 'meta_ad', status: 'start' });
          const adParams = new URLSearchParams({
            name: adName, adset_id: adsetId,
            creative: JSON.stringify({ creative_id: creativeData.id }),
            status: 'PAUSED', access_token: metaToken,
          });
          const adRes = await fetch(`${GRAPH}/${metaAdAccount}/ads`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: adParams,
          });
          const adData = await parseMeta(adRes, 'meta_ad');
          if (adData.error) return fail('meta_ad', adData.error.message, adData.error);
          emit({ step: 'meta_ad', status: 'done', detail: adData.id });

          // Move both files to Launched
          emit({ step: 'drive_move', status: 'start' });
          const launchedId = await ensureFolder(token, rootId, 'Launched');
          for (const [fmeta, fid] of [[feed.fileMeta, pair.feedFileId], [story.fileMeta, pair.storyFileId]]) {
            const ext = fmeta.name.includes('.') ? fmeta.name.substring(fmeta.name.lastIndexOf('.')) : '';
            const base = fmeta.name.replace(ext, '');
            const finalName = `${base}__LAUNCHED__${adData.id}${ext}`;
            const removeParents = (fmeta.parents || []).join(',');
            await driveFetch(token, `/files/${fid}?addParents=${launchedId}&removeParents=${encodeURIComponent(removeParents)}&fields=id,name&supportsAllDrives=true`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: finalName }),
            });
          }
          emit({ step: 'drive_move', status: 'done', detail: 'both files moved' });

          // Log
          emit({ step: 'db_log', status: 'start' });
          try {
            if (process.env.DATABASE_URL) {
              const sql = neon(process.env.DATABASE_URL);
              await sql`
                INSERT INTO launch_history
                  (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, creator_id, source_type, source_label, brief_id, deliverable_id, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type, launched_by_user_id, launched_by_email, source_video_url)
                VALUES
                  (${adData.id}, ${adsetId}, ${campaignId || null}, ${pair.feedFileId}, ${feed.fileMeta.name + ' + ' + story.fileMeta.name}, ${creator || null}, ${creatorId || null}, ${attributionSourceType}, ${attributionSourceLabel}, ${briefId || null}, ${deliverableId || null}, ${productId || null}, ${angleId || null}, ${adName}, ${headline || null}, ${primaryText || null}, ${destUrl}, ${feed.mimeType + ' (paired)'}, ${appAccess.userId}, ${appAccess.email || null}, ${feed.blobUrl || null})
              `;
              await Promise.all([
                markCreativeAssetLaunched(sql, {
                  driveFileId: pair.feedFileId, durableUrl: feed.blobUrl,
                  metaVideoId: feed.videoId, metaImageHash: feed.imageHash,
                  adId: adData.id, placementRole: 'feed',
                  groupKey: feed.videoId || feed.imageHash,
                  creator, creatorId, sourceType: attributionSourceType, sourceLabel: attributionSourceLabel, briefId, deliverableId, productId, angleId,
                }),
                markCreativeAssetLaunched(sql, {
                  driveFileId: pair.storyFileId, durableUrl: story.blobUrl,
                  metaVideoId: story.videoId, metaImageHash: story.imageHash,
                  adId: adData.id, placementRole: 'story',
                  groupKey: story.videoId || story.imageHash,
                  creator, creatorId, sourceType: attributionSourceType, sourceLabel: attributionSourceLabel, briefId, deliverableId, productId, angleId,
                }),
              ]);
              await stampFlowLaunched(sql, {
                adId: adData.id,
                groupKey: feed.videoId || feed.imageHash || story.videoId || story.imageHash || adData.id,
                briefId,
                deliverableId,
              });
              await Promise.all([
                enqueueCreativeAssetAnalysis(sql, feed.videoId || feed.imageHash || adData.id, 'drive_launch'),
                enqueueCreativeAssetAnalysis(sql, story.videoId || story.imageHash || adData.id, 'drive_launch'),
              ]);
              emit({ step: 'db_log', status: 'done' });
            } else {
              emit({ step: 'db_log', status: 'done', detail: 'no DB configured' });
            }
          } catch (dbErr) {
            emit({ step: 'db_log', status: 'error', error: dbErr.message });
          }

          emit({ done: true, adId: adData.id, paired: true, feedVideoId: feed.videoId, storyVideoId: story.videoId, feedImageHash: feed.imageHash, storyImageHash: story.imageHash });
          return res.end();
        } catch (err) {
          return fail('pair_launch', err.message);
        }
      }

      // ── SINGLE PATH (existing flow) ────────────────────────────────────────
      // 1. Fetch bytes from Drive
      emit({ step: 'drive_download', status: 'start' });
      const fileMeta = await driveFetch(token, `/files/${fileId}?fields=name,mimeType,parents&supportsAllDrives=true`);
      if ((fileMeta.name || '').includes('__LAUNCHED__')) {
        return fail('drive_download', 'Already launched (file renamed by another user). Refresh the inbox.');
      }
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

      // Mirror video to Blob in parallel with Meta thumbnail polling.
      // Best-effort: failure does not break the launch.
      let sourceVideoUrl = null;
      const blobMirrorPromise =
        (emit({ step: 'blob_mirror', status: 'start' }),
           mirrorAssetToBlob(fileBuffer, mimeType, fileMeta.name).then(url => {
             sourceVideoUrl = url;
             emit({ step: 'blob_mirror', status: 'done', detail: url ? 'mirrored' : 'skipped' });
           }));

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
        ? { page_id: pageId, ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}), video_data: { video_id: videoId, image_url: videoThumbnailUrl, message: primaryText || headline || '', title: headline || '', call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } } } }
        : { page_id: pageId, ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}), link_data: { image_hash: imageHash, link: destUrl, message: primaryText || headline || '', name: headline || '', call_to_action: { type: 'SHOP_NOW' } } };
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
      await blobMirrorPromise;
      emit({ step: 'db_log', status: 'start' });
      try {
        if (process.env.DATABASE_URL) {
          const sql = neon(process.env.DATABASE_URL);
          await sql`
            INSERT INTO launch_history
              (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, creator_id, source_type, source_label, brief_id, deliverable_id, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type, launched_by_user_id, launched_by_email, source_video_url)
            VALUES
              (${adData.id}, ${adsetId}, ${campaignId || null}, ${fileId}, ${fileMeta.name}, ${creator || null}, ${creatorId || null}, ${attributionSourceType}, ${attributionSourceLabel}, ${briefId || null}, ${deliverableId || null}, ${productId || null}, ${angleId || null}, ${adName}, ${headline || null}, ${primaryText || null}, ${destUrl}, ${mimeType}, ${appAccess.userId}, ${appAccess.email || null}, ${sourceVideoUrl})
          `;
          await markCreativeAssetLaunched(sql, {
            driveFileId: fileId,
            durableUrl: sourceVideoUrl,
            metaVideoId: videoId,
            metaImageHash: imageHash,
            adId: adData.id,
            placementRole: 'single',
            groupKey: videoId || imageHash,
            creator,
            creatorId,
            sourceType: attributionSourceType,
            sourceLabel: attributionSourceLabel,
            briefId,
            deliverableId,
            productId,
            angleId,
          });
          await stampFlowLaunched(sql, {
            adId: adData.id,
            groupKey: videoId || imageHash || adData.id,
            briefId,
            deliverableId,
          });
          await enqueueCreativeAssetAnalysis(sql, videoId || imageHash || adData.id, 'drive_launch');
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
      const {
        fileId, adId, newName, logLaunch = true, placementRole = 'manual',
        adName, adsetId, campaignId, driveFileName, creator, creatorId,
        sourceType, sourceLabel, briefId, deliverableId, productId, angleId,
        headline, primaryText, destUrl,
      } = req.body;
      if (!fileId || !adId) return res.status(400).json({ error: 'fileId and adId required' });

      const launchedId = await ensureFolder(token, rootId, 'Launched');

      // Fetch current name + parents so we can rename + move in one call
      const current = await driveFetch(token, `/files/${fileId}?fields=id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,parents,videoMediaMetadata(width,height),imageMediaMetadata(width,height)&supportsAllDrives=true`);
      const ext = current.name.includes('.') ? current.name.substring(current.name.lastIndexOf('.')) : '';
      const base = current.name.replace(ext, '');
      const finalName = newName || `${base}__LAUNCHED__${adId}${ext}`;
      const removeParents = (current.parents || []).join(',');

      let durableUrl = null;
      try {
        const dlRes = await fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (dlRes.ok) {
          const buf = Buffer.from(await dlRes.arrayBuffer());
          durableUrl = await mirrorAssetToBlob(buf, current.mimeType || dlRes.headers.get('content-type') || 'application/octet-stream', current.name);
        } else {
          console.error('mark_launched mirror download failed:', (await dlRes.text()).slice(0, 200));
        }
      } catch (err) {
        console.error('mark_launched mirror failed:', err.message);
      }

      const updated = await driveFetch(
        token,
        `/files/${fileId}?addParents=${launchedId}&removeParents=${encodeURIComponent(removeParents)}&fields=id,name,parents&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: finalName }),
        }
      );
      if (process.env.DATABASE_URL) {
        try {
          const sql = neon(process.env.DATABASE_URL);
          await ensureCreatorOpsTables(sql);
          await ensureCreativeAssetTables(sql);
          await upsertDriveAsset(sql, current, current.drive_folder_path || '', false);
          const asset = await markCreativeAssetLaunched(sql, {
            driveFileId: fileId,
            durableUrl,
            adId,
            placementRole,
            groupKey: adId,
            creator,
            creatorId,
            sourceType,
            sourceLabel,
            briefId,
            deliverableId,
            productId,
            angleId,
          });
          if (logLaunch) {
            await sql`
              INSERT INTO launch_history
                (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, creator_id, source_type, source_label, brief_id, deliverable_id, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type, launched_by_user_id, launched_by_email, source_video_url)
              SELECT
                ${adId}, ${adsetId || null}, ${campaignId || null}, ${fileId}, ${driveFileName || current.name}, ${creator || null}, ${creatorId || null}, ${sourceType || null}, ${sourceLabel || creator || null}, ${briefId || null}, ${deliverableId || null}, ${productId || null}, ${angleId || null}, ${adName || null}, ${headline || null}, ${primaryText || null}, ${destUrl || null}, ${current.mimeType || null}, ${appAccess.userId}, ${appAccess.email || null}, ${durableUrl || null}
              WHERE NOT EXISTS (
                SELECT 1 FROM launch_history
                WHERE ad_id = ${adId}
                  AND drive_file_id = ${fileId}
              )
            `;
          }
          await stampFlowLaunched(sql, {
            adId,
            groupKey: asset?.group_key || adId,
            briefId,
            deliverableId,
          });
          await enqueueCreativeAssetAnalysis(sql, asset?.group_key || adId, 'manual_mark_launched');
        } catch (err) {
          console.error('creative asset launch linkage failed:', err.message);
        }
      }
      return res.json({ success: true, file: updated, analysisQueued: Boolean(process.env.DATABASE_URL), durableUrl });
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
