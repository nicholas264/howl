import { checkWorkLimit } from './_lib/work-limits.js';
import { assertLaunchReady } from './_lib/launch-preflight.js';
import { syncCreativeAnalytics } from './_lib/meta/sync.js';
import { createMetaOperationFetch } from './_lib/operation-journal.js';
import { canRunMetaAction } from './_lib/meta-permissions.js';
import { mirrorVideoToBlob } from './_lib/blob/mirror.js';
import { backfillCreativeAssetsFromLaunchHistory, ensureCreativeAssetTables } from './_lib/creative-assets.js';
import { enqueueCreativeAnalyses, enqueueCreativeAssetAnalysis, ensureCreativeAnalysisQueue } from './_lib/creative-analysis-queue.js';
import { normalizeCreativeAsset, normalizeCreativeAssetBatch } from './_lib/creative-asset-normalizer.js';

const DEFAULT_META_URL_TAGS = 'tw_source={{site_source_name}}&tw_adid={{ad.id}}';

const SKU_SPEND_RULES = [
  { sku: 'R1 RallyMount', productIds: ['r1-rallymount', 'rallymount-r1'], terms: ['r1 rallymount', 'r1 rally mount', 'rallymount r1', 'rally mount r1'] },
  { sku: 'R3 RallyMount', productIds: ['r3-rallymount', 'rallymount-r3'], terms: ['r3 rallymount', 'r3 rally mount', 'rallymount r3', 'rally mount r3'] },
  { sku: 'R1 HaulBag', productIds: ['r1-haulbag', 'haulbag-r1'], terms: ['r1 haulbag', 'r1 haul bag', 'haulbag r1', 'haul bag r1'] },
  { sku: 'R3 HaulBag', productIds: ['r3-haulbag', 'haulbag-r3'], terms: ['r3 haulbag', 'r3 haul bag', 'haulbag r3', 'haul bag r3'] },
  { sku: 'R4 HaulBag', productIds: ['r4-haulbag', 'haulbag-r4'], terms: ['r4 haulbag', 'r4 haul bag', 'haulbag r4', 'haul bag r4'] },
  { sku: '10 lb Tanks', productIds: ['10-lb-tank', '10lb-tank'], terms: ['10 lb tank', '10lb tank', '10-pound tank', '10 pound tank'] },
  { sku: '20 lb Tanks', productIds: ['20-lb-tank', '20lb-tank'], terms: ['20 lb tank', '20lb tank', '20-pound tank', '20 pound tank'] },
  { sku: 'Tank Mount', productIds: ['tank-mount'], terms: ['tank mount'] },
  { sku: 'Rally Straps', productIds: ['rally-straps'], terms: ['rally straps', 'rally strap'] },
  { sku: 'Ground Tarp', productIds: ['ground-tarp'], terms: ['ground tarp', 'tarp'] },
  { sku: 'RV Kit', productIds: ['rv-kit'], terms: ['rv kit'] },
  { sku: 'Heater', productIds: ['heater'], terms: ['heater'] },
  { sku: 'R4 Campfire', productIds: ['r4', 'r4mkii', 'r4-mkii'], terms: ['r4 campfire', 'r4 mkii', 'r4 mkii', 'r4 mk ii', 'r4'] },
  { sku: 'R3 Campfire', productIds: ['r3'], terms: ['r3 campfire', 'r3'] },
  { sku: 'R1 Campfire', productIds: ['r1'], terms: ['r1 campfire', 'r1'] },
];

function cleanMetaUrlTags(value) {
  return String(value || DEFAULT_META_URL_TAGS).trim().replace(/^[?&]+/, '');
}

function appendUrlTags(params, urlParams) {
  const tags = cleanMetaUrlTags(urlParams);
  if (tags) params.set('url_tags', tags);
}

function normalizeSkuText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function classifySkuSpend(row, launchProductId = null) {
  const productId = normalizeSkuText(launchProductId).replace(/\s+/g, '-');
  if (productId) {
    const byProductId = SKU_SPEND_RULES.find(rule => rule.productIds.includes(productId));
    if (byProductId) return { sku: byProductId.sku, confidence: 'launch_history' };
  }

  const haystack = normalizeSkuText([
    row.campaign_name,
    row.adset_name,
    row.ad_name,
  ].filter(Boolean).join(' '));
  if (!haystack) return { sku: null, confidence: 'unmapped' };

  for (const rule of SKU_SPEND_RULES) {
    if (rule.terms.some(term => {
      const normalizedTerm = normalizeSkuText(term);
      return new RegExp(`(^| )${normalizedTerm.replace(/\s+/g, ' ')}( |$)`).test(haystack);
    })) {
      return { sku: rule.sku, confidence: 'name_rule' };
    }
  }
  return { sku: null, confidence: 'unmapped' };
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

// Report bookkeeping failure. Provider creations are journaled and never blindly repeated.
async function logLaunch(row) {
  try {
    if (!process.env.DATABASE_URL) return;
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_type TEXT`;
    await sql`ALTER TABLE launch_history ADD COLUMN IF NOT EXISTS source_label TEXT`;
    const [launch] = await sql`
      INSERT INTO launch_history
        (ad_id, adset_id, campaign_id, drive_file_id, drive_file_name, creator, creator_id, source_type, source_label, brief_id, deliverable_id, product_id, angle_id, ad_name, headline, primary_text, dest_url, mime_type, launched_by_user_id, launched_by_email, source_video_url)
      VALUES
        (${row.ad_id}, ${row.adset_id || null}, ${row.campaign_id || null}, ${row.drive_file_id || null}, ${row.drive_file_name || null}, ${row.creator || null}, ${row.creator_id || null}, ${row.source_type || null}, ${row.source_label || null}, ${row.brief_id || null}, ${row.deliverable_id || null}, ${row.product_id || null}, ${row.angle_id || null}, ${row.ad_name || null}, ${row.headline || null}, ${row.primary_text || null}, ${row.dest_url || null}, ${row.mime_type || null}, ${row.launched_by_user_id || null}, ${row.launched_by_email || null}, ${row.source_video_url || null})
      RETURNING id
    `;
    const groupKey = row.group_key || row.meta_video_id || row.meta_image_hash || row.ad_id;
    await stampFlowLaunched(sql, {
      adId: row.ad_id,
      groupKey,
      briefId: row.brief_id,
      deliverableId: row.deliverable_id,
    });
    if (row.source_video_url) {
      await ensureCreativeAssetTables(sql);
      const [asset] = await sql`
        INSERT INTO creative_assets
          (drive_file_name, mime_type, durable_url, ad_id, creator, creator_id,
           source_type, source_label, brief_id, deliverable_id, product_id, angle_id, placement_role, group_key,
           transcript_status, playable_url, playback_status, playback_checked_at, updated_at)
        VALUES
          (${row.ad_name || null}, ${row.mime_type || 'video/mp4'}, ${row.source_video_url},
           ${row.ad_id}, ${row.creator || null}, ${row.creator_id || null},
           ${row.source_type || null}, ${row.source_label || null},
           ${row.brief_id || null}, ${row.deliverable_id || null}, ${row.product_id || null},
           ${row.angle_id || null}, 'launched', ${groupKey || null}, 'pending',
           ${row.source_video_url}, 'ready', now(), now())
        RETURNING id
      `;
      await enqueueCreativeAssetAnalysis(sql, groupKey, 'launch');
      if (row.deliverable_id) {
        await sql`
          UPDATE creator_deliverables
          SET status = 'launched',
              output_url = COALESCE(${row.source_video_url}, output_url),
              creative_asset_id = ${asset?.id || null},
              completed_asset_count = GREATEST(completed_asset_count, 1),
              shipped_asset_count = GREATEST(shipped_asset_count, 1),
              completed_at = COALESCE(completed_at, now()),
              shipped_at = COALESCE(shipped_at, now()),
              updated_at = now()
          WHERE id = ${row.deliverable_id}
            AND creator_id = ${row.creator_id || null}
        `;
      }
    }
    return launch;
  } catch (err) {
    console.error('launch_history insert failed:', err.message);
    throw Object.assign(new Error(`Meta ad ${row.ad_id} exists, but recording the launch failed. Review the ad before retrying.`), { statusCode: 503 });
  }
}

async function uploadVideoBufferResumable(videoBuffer, { name, mimeType = 'video/mp4', adAccountId, accessToken, BASE }) {
  const startForm = new URLSearchParams({
    upload_phase: 'start',
    file_size: String(videoBuffer.length),
    access_token: accessToken,
  });
  const startRes = await fetch(`${BASE}/${adAccountId}/advideos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: startForm,
  });
  const startData = await startRes.json();
  if (startData.error) throw new Error(startData.error.error_user_msg || startData.error.message);
  const uploadSessionId = startData.upload_session_id;
  const videoId = startData.video_id;
  if (!uploadSessionId || !videoId) throw new Error('Video upload did not return a session');

  let startOffset = parseInt(startData.start_offset, 10);
  let endOffset = parseInt(startData.end_offset, 10);
  while (startOffset < endOffset) {
    const transferForm = new FormData();
    transferForm.append('access_token', accessToken);
    transferForm.append('upload_phase', 'transfer');
    transferForm.append('upload_session_id', uploadSessionId);
    transferForm.append('start_offset', String(startOffset));
    transferForm.append('video_file_chunk', new Blob([videoBuffer.slice(startOffset, endOffset)], { type: mimeType }), `chunk-${startOffset}`);
    const transferRes = await fetch(`${BASE}/${adAccountId}/advideos`, { method: 'POST', body: transferForm });
    const transferData = await transferRes.json();
    if (transferData.error) throw new Error(transferData.error.error_user_msg || transferData.error.message);
    startOffset = parseInt(transferData.start_offset, 10);
    endOffset = parseInt(transferData.end_offset, 10);
  }

  const finishForm = new URLSearchParams({
    upload_phase: 'finish',
    upload_session_id: uploadSessionId,
    title: name || `howl-video-${Date.now()}`,
    access_token: accessToken,
  });
  const finishRes = await fetch(`${BASE}/${adAccountId}/advideos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: finishForm,
  });
  const finishData = await finishRes.json();
  if (finishData.error) throw new Error(finishData.error.error_user_msg || finishData.error.message);
  return videoId;
}

// Returns { videoId, blobUrl } — blobUrl is best-effort and may be null.
async function uploadVideo(base64, name, adAccountId, accessToken, BASE) {
  const clean = base64.replace(/^data:video\/\w+;base64,/, '');
  const videoBuffer = Buffer.from(clean, 'base64');
  const videoId = await uploadVideoBufferResumable(videoBuffer, {
    name,
    mimeType: 'video/mp4',
    adAccountId,
    accessToken,
    BASE,
  });
  const blobUrl = await mirrorVideoToBlob(videoBuffer, 'video/mp4', name || 'howl-video');
  return { videoId, blobUrl };
}

async function uploadVideoFromUrl(videoUrl, name, adAccountId, accessToken, BASE) {
  const sourceRes = await fetch(videoUrl);
  if (!sourceRes.ok) throw new Error(`Could not fetch Blob video (${sourceRes.status})`);
  const mimeType = sourceRes.headers.get('content-type') || 'video/mp4';
  const videoBuffer = Buffer.from(await sourceRes.arrayBuffer());
  const videoId = await uploadVideoBufferResumable(videoBuffer, {
    name,
    mimeType,
    adAccountId,
    accessToken,
    BASE,
  });
  return { videoId, blobUrl: videoUrl };
}

async function uploadImage(base64, adAccountId, accessToken, BASE) {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const params = new URLSearchParams({
    bytes: clean,
    name: `howl-${Date.now()}.jpg`,
    access_token: accessToken,
  });
  const r = await fetch(`${BASE}/${adAccountId}/adimages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const hash = Object.values(d.images || {})[0]?.hash;
  if (!hash) throw new Error('Image upload returned no hash');
  return hash;
}

const PURCHASE_ACTION_TYPES = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'web_in_store_purchase',
];

function pickPurchaseMetric(arr) {
  if (!Array.isArray(arr)) return null;
  for (const type of PURCHASE_ACTION_TYPES) {
    const hit = arr.find(a => a.action_type === type);
    if (hit) return parseFloat(hit.value || 0);
  }
  return null;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

import { hasPermission, requireWorkspaceAccess } from './_lib/app-access.js';
import { assertBrandSafe } from './_lib/brand-guardrails.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { ensureCreativeAuditTables, logCreativeOperatorEvent } from './_lib/creative-audit.js';
import { ensureCreativeEvidenceTaskTables, normalizeEvidenceTaskType, upsertCreativeEvidenceTask } from './_lib/creative-evidence-tasks.js';
import {
  analyzeCreativeGroup,
  dismissAnalyzedWinner,
  getCreativeAnalysisQueue,
  getCreativeAnalysis,
  listAnalyzedWinners,
  processCreativeAnalysisQueue,
  retryCreativeAnalysisQueue,
} from './_lib/meta/creative-analysis.js';

function normalizedWords(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function creatorMatchIndex(creators) {
  const aliases = [];
  const frequency = new Map();
  creators.forEach(creator => {
    const fullName = normalizedWords(creator.name);
    const firstName = fullName.split(' ')[0];
    const handles = Array.isArray(creator.handles) ? creator.handles : [];
    const creatorAliases = [
      fullName && { value: fullName, kind: fullName.includes(' ') ? 'full_name' : 'name' },
      firstName?.length >= 4 && fullName.includes(' ') && { value: firstName, kind: 'first_name' },
      ...handles.map(handle => ({ value: normalizedWords(handle?.replace(/^@/, '')), kind: 'handle' })),
    ].filter(alias => alias?.value?.length >= 4);
    creatorAliases.forEach(alias => frequency.set(alias.value, (frequency.get(alias.value) || 0) + 1));
    aliases.push({ creator, aliases: creatorAliases });
  });
  return aliases.map(entry => ({
    ...entry,
    aliases: entry.aliases.filter(alias => frequency.get(alias.value) === 1),
  }));
}

function suggestCreator(name, index) {
  const haystack = ` ${normalizedWords(name)} `;
  const matches = [];
  index.forEach(({ creator, aliases }) => {
    aliases.forEach(alias => {
      if (!haystack.includes(` ${alias.value} `)) return;
      const score = alias.kind === 'full_name' || alias.kind === 'name' ? 100 : alias.kind === 'handle' ? 90 : 75;
      matches.push({ creator, alias, score });
    });
  });
  matches.sort((a, b) => b.score - a.score || a.creator.name.localeCompare(b.creator.name));
  if (!matches.length || (matches[1] && matches[1].score === matches[0].score && matches[1].creator.id !== matches[0].creator.id)) return null;
  const best = matches[0];
  return {
    creatorId: Number(best.creator.id),
    creatorName: best.creator.name,
    confidence: best.score >= 90 ? 'high' : 'review',
    reason: best.alias.kind === 'handle'
      ? `Social handle appears in "${name}"`
      : `${best.alias.kind === 'first_name' ? 'First name' : 'Creator name'} appears in "${name}"`,
  };
}

function suggestSourceTag(name) {
  const words = normalizedWords(name);
  if (!words) return null;
  const toolSignals = [
    'static', 'graphic', 'product callout', 'callout', 'bfcm', 'black friday',
    'sale', 'top performer', 'carousel', 'image', 'catalog', 'giveaway launch',
  ];
  const internalSignals = ['walkaround', 'build ep', 'founder', 'alex'];
  const toolSignal = toolSignals.find(signal => words.includes(signal));
  if (toolSignal) {
    return {
      sourceType: 'tool_generated',
      sourceLabel: 'Made in HOWL',
      confidence: 'high',
      reason: `Name includes "${toolSignal}", which usually indicates an in-house static/tool-generated asset.`,
    };
  }
  const internalSignal = internalSignals.find(signal => words.includes(signal));
  if (internalSignal) {
    return {
      sourceType: internalSignal === 'founder' || internalSignal === 'alex' ? 'founder' : 'internal_employee',
      sourceLabel: internalSignal === 'founder' || internalSignal === 'alex' ? 'Founder' : 'HOWL team',
      confidence: 'review',
      reason: `Name includes "${internalSignal}", which may indicate a founder/internal source.`,
    };
  }
  return null;
}

function inferAssetKind({ name, mimeType, playableUrl, video3sViews, videoThruplays }) {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('video/') || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(playableUrl || '')) return 'video';
  const words = normalizedWords(name);
  if ((Number(video3sViews) || 0) > 0 || (Number(videoThruplays) || 0) > 0) return 'video';
  if (/^v[\s_-]/i.test(name || '') || words.includes('video') || words.includes('ugc') || words.includes('stop motion') || words.includes('stopmotion')) return 'video';
  return 'image';
}

function metaVideoEmbedUrl(videoId) {
  if (!videoId) return null;
  const href = encodeURIComponent(`https://www.facebook.com/reel/${videoId}/`);
  return `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=560`;
}

export default async function handler(req, res) {
  const appAccess = await requireWorkspaceAccess(req, res);
  if (!appAccess) return;
  const actor = { launched_by_user_id: appAccess.userId, launched_by_email: appAccess.email };
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  const rawId = (process.env.META_AD_ACCOUNT_ID || '').replace('act_', '');
  const adAccountId = `act_${rawId}`;
  const defaultPageId = process.env.META_PAGE_ID;

  if (!accessToken || !rawId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID not configured' });
  }

  const BASE = 'https://graph.facebook.com/v21.0';
  const { action } = req.body;
  const launchActions = new Set([
    'create_campaign', 'create_adset', 'create_creative', 'create_ad_from_creative',
    'create_paired_image_ad', 'push_ad', 'push_carousel', 'upload_image', 'upload_video',
    'upload_video_url',
    'create_creative_test',
  ]);
  if (!canRunMetaAction(appAccess, action)) {
    return res.status(403).json({ error: 'Forbidden - action permission required' });
  }

  if (['analyze_creative_group', 'process_creative_analysis_queue', 'normalize_creative_asset', 'normalize_creative_asset_batch'].includes(action)
      && !(await checkWorkLimit(appAccess, res, 'analysis'))) return;
  const fetch = launchActions.has(action)
    ? await createMetaOperationFetch(appAccess.sql, req, appAccess.userId) : globalThis.fetch;
  try {
    if (launchActions.has(action)) {
      await ensureCreatorOpsTables(appAccess.sql);
      if (!['upload_image', 'upload_video', 'upload_video_url', 'create_campaign', 'create_adset'].includes(action)) {
        await assertLaunchReady(appAccess.sql, req.body);
        for (const item of req.body.items || []) await assertLaunchReady(appAccess.sql, { ...req.body, ...item });
      }
      const launchCopy = [
        req.body?.adName, req.body?.headline, req.body?.primaryText,
        ...(req.body?.items || []).flatMap(item => [item.name, item.hook, item.body]),
      ].filter(Boolean).join('\n');
      if (launchCopy) await assertBrandSafe(appAccess.sql, launchCopy);
    }
    switch (action) {

      case 'get_tool_roi': {
        // Pulls all ads in launch_history within `sinceDays` (default 90), queries Meta
        // Insights once per chunk (500 ad_ids per call), aggregates spend/revenue/ROAS.
        if (!process.env.DATABASE_URL) {
          return res.json({ error: 'DATABASE_URL not configured' });
        }
        const sinceDays = parseInt(req.body.sinceDays || 90, 10);
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        const launches = await sql`
          SELECT ad_id, creator, mime_type, ad_name, launched_at
          FROM launch_history
          WHERE ad_id IS NOT NULL
            AND launched_at >= NOW() - (${sinceDays} || ' days')::interval
        `;

        if (launches.length === 0) {
          return res.json({ totals: { spend: 0, revenue: 0, purchases: 0, roas: 0, adsLaunched: 0 }, byMimeType: [], byCreator: [], sinceDays });
        }

        // Build lookup so we can attribute insights back to mime_type / creator
        const launchById = new Map();
        for (const l of launches) launchById.set(l.ad_id, l);
        const adIds = [...launchById.keys()];

        // Fetch Meta insights — single call per chunk of 500 ad IDs
        const PURCHASE_TYPES = new Set([
          'omni_purchase',
          'offsite_conversion.fb_pixel_purchase',
          'purchase',
          'web_in_store_purchase',
        ]);
        const pickPurchaseValue = (arr) => {
          if (!Array.isArray(arr)) return 0;
          // Prefer omni_purchase (deduped), fall back through preference order
          const preference = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_in_store_purchase'];
          for (const t of preference) {
            const hit = arr.find(a => a.action_type === t);
            if (hit) return parseFloat(hit.value || 0);
          }
          return 0;
        };
        const pickPurchaseCount = (arr) => {
          if (!Array.isArray(arr)) return 0;
          const preference = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_in_store_purchase'];
          for (const t of preference) {
            const hit = arr.find(a => a.action_type === t);
            if (hit) return parseFloat(hit.value || 0);
          }
          return 0;
        };

        const CHUNK = 500;
        const insightsRows = [];
        for (let i = 0; i < adIds.length; i += CHUNK) {
          const chunk = adIds.slice(i, i + CHUNK);
          const filtering = encodeURIComponent(JSON.stringify([
            { field: 'ad.id', operator: 'IN', value: chunk },
          ]));
          // Use a date_preset that matches sinceDays as closely as possible; fall back to
          // an explicit time_range for arbitrary windows.
          const tsNow = new Date();
          const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
          const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const timeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(tsSince), until: fmtYmd(tsNow) }));

          const url = `${BASE}/${adAccountId}/insights?level=ad&fields=ad_id,spend,actions,action_values&filtering=${filtering}&time_range=${timeRange}&limit=500&access_token=${accessToken}`;
          const r = await fetch(url);
          const d = await r.json();
          if (d.error) {
            return res.status(400).json({ error: d.error.message, step: 'meta_insights' });
          }
          if (Array.isArray(d.data)) insightsRows.push(...d.data);
        }

        const totals = { spend: 0, revenue: 0, purchases: 0, roas: 0, adsLaunched: launches.length };
        const mimeAgg = {};
        const creatorAgg = {};

        for (const row of insightsRows) {
          const launch = launchById.get(row.ad_id);
          if (!launch) continue;
          const spend = parseFloat(row.spend || 0);
          const revenue = pickPurchaseValue(row.action_values);
          const purchases = pickPurchaseCount(row.actions);

          totals.spend += spend;
          totals.revenue += revenue;
          totals.purchases += purchases;

          const mt = launch.mime_type || 'unknown';
          if (!mimeAgg[mt]) mimeAgg[mt] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          mimeAgg[mt].spend += spend;
          mimeAgg[mt].revenue += revenue;
          mimeAgg[mt].purchases += purchases;

          const cr = launch.creator || 'Unknown';
          if (!creatorAgg[cr]) creatorAgg[cr] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          creatorAgg[cr].spend += spend;
          creatorAgg[cr].revenue += revenue;
          creatorAgg[cr].purchases += purchases;
        }

        // Count ads per mime_type/creator from launch_history (not insights — captures
        // ads that ran but had zero spend/insights)
        for (const l of launches) {
          const mt = l.mime_type || 'unknown';
          const cr = l.creator || 'Unknown';
          if (!mimeAgg[mt]) mimeAgg[mt] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          mimeAgg[mt].ads += 1;
          if (!creatorAgg[cr]) creatorAgg[cr] = { spend: 0, revenue: 0, purchases: 0, ads: 0 };
          creatorAgg[cr].ads += 1;
        }

        totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
        const byMimeType = Object.entries(mimeAgg).map(([k, v]) => ({ mimeType: k, ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0 })).sort((a, b) => b.revenue - a.revenue);
        const byCreator = Object.entries(creatorAgg).map(([k, v]) => ({ creator: k, ...v, roas: v.spend > 0 ? v.revenue / v.spend : 0 })).sort((a, b) => b.revenue - a.revenue);

        return res.json({ totals, byMimeType, byCreator, sinceDays, _meta: { adsWithInsights: insightsRows.length, metaCalls: Math.ceil(adIds.length / CHUNK) } });
      }

      case 'get_dashboard': {
        const sinceTs = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 365; // 1 year ago
        const filtering = encodeURIComponent(JSON.stringify([{ field: 'created_time', operator: 'GREATER_THAN', value: sinceTs }]));
        const activeFilter = encodeURIComponent(JSON.stringify([
          { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
        ]));

        // Monthly insights time series — 13 months back to first of that month
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getFullYear(), tsNow.getMonth() - 12, 1);
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const monthlyTimeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(tsSince), until: fmtYmd(tsNow) }));

        const [adsRes, insightsRes, monthlyInsightsRes, adsetsRes, campaignsRes, creativesRes] = await Promise.all([
          fetch(`${BASE}/${adAccountId}/ads?fields=id,name,created_time,status,effective_status,creative{id,object_type}&limit=500&filtering=${filtering}&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,impressions,clicks,ctr,reach,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,impressions,clicks,actions,cost_per_action_type,purchase_roas&time_range=${monthlyTimeRange}&time_increment=monthly&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/adsets?fields=id,name,daily_budget,lifetime_budget,budget_remaining,campaign_id,effective_status,bid_strategy,bid_amount&filtering=${activeFilter}&limit=200&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,budget_remaining,bid_strategy&filtering=${activeFilter}&limit=100&access_token=${accessToken}`),
          // Fetch creatives directly to get actual asset identifiers
          fetch(`${BASE}/${adAccountId}/adcreatives?fields=id,image_hash,video_id,object_type&limit=500&access_token=${accessToken}`),
        ]);
        const [adsData, insightsData, monthlyInsightsData, adsetsData, campaignsData, creativesData] = await Promise.all([adsRes.json(), insightsRes.json(), monthlyInsightsRes.json(), adsetsRes.json(), campaignsRes.json(), creativesRes.json()]);

        if (adsData.error) throw new Error(adsData.error.message);

        // Build creative ID → asset key lookup
        const creativeAssets = {};
        for (const c of (creativesData.data || [])) {
          creativeAssets[c.id] = {
            image_hash: c.image_hash || null,
            video_id: c.video_id || null,
            object_type: c.object_type || null,
          };
        }

        // Build campaign ID → name + budget lookup
        const campaignNames = {};
        const campaignBudgetData = {};
        for (const c of (campaignsData.data || [])) {
          campaignNames[c.id] = c.name;
          campaignBudgetData[c.id] = {
            daily_budget: c.daily_budget || null,
            lifetime_budget: c.lifetime_budget || null,
            budget_remaining: c.budget_remaining || null,
            bid_strategy: c.bid_strategy || null,
          };
        }

        // Reduce monthly insights to {month: 'YYYY-MM', spend, purchases, roas, ...}
        const monthlyInsightsError = monthlyInsightsData?.error?.message || null;
        const monthlyInsights = (monthlyInsightsData.data || []).map(row => {
          const month = (row.date_start || '').slice(0, 7);
          const purchases = pickPurchaseMetric(row.actions) || 0;
          const cpaRaw = pickPurchaseMetric(row.cost_per_action_type);
          const roasRaw = pickPurchaseMetric(row.purchase_roas);
          return {
            month,
            spend: parseFloat(row.spend || 0),
            impressions: parseInt(row.impressions || 0),
            clicks: parseInt(row.clicks || 0),
            purchases,
            cpa: cpaRaw,
            roas: roasRaw,
          };
        });

        return res.json({
          ads: adsData.data || [],
          insights: insightsData.data?.[0] || null,
          monthlyInsights,
          monthlyInsightsError,
          activeAdsets: adsetsData.data || [],
          campaignNames,
          campaignBudgetData,
          creativeAssets,
        });
      }

      case 'list_campaigns': {
        const activeFilter = encodeURIComponent(JSON.stringify([
          { field: 'effective_status', operator: 'IN', value: ['ACTIVE'] },
        ]));
        const r = await fetch(
          `${BASE}/${adAccountId}/campaigns?fields=id,name,status,effective_status,objective&filtering=${activeFilter}&limit=200&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'list_adsets': {
        const { campaign_id } = req.body;
        // Fetch from the campaign's own adsets edge so the list is scoped to it.
        const r = await fetch(
          `${BASE}/${campaign_id}/adsets?fields=id,name,status,effective_status&limit=200&access_token=${accessToken}`
        );
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_campaign': {
        const { name, objective } = req.body;
        const r = await fetch(`${BASE}/${adAccountId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            objective,
            status: 'PAUSED',
            special_ad_categories: [],
            is_adset_budget_sharing_enabled: false,
            access_token: accessToken,
          }),
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_adset': {
        const { name, campaign_id, daily_budget_dollars, objective, pixel_id } = req.body;
        const dailyBudgetCents = Math.round(parseFloat(daily_budget_dollars || '10') * 100);

        const adsetBody = {
          name,
          campaign_id,
          daily_budget: String(dailyBudgetCents),
          billing_event: 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          status: 'PAUSED',
          targeting: {
            geo_locations: { countries: ['US'] },
            age_min: 18,
            age_max: 65,
          },
          access_token: accessToken,
        };

        if (objective === 'OUTCOME_SALES' && pixel_id) {
          adsetBody.optimization_goal = 'OFFSITE_CONVERSIONS';
          adsetBody.promoted_object = {
            pixel_id,
            custom_event_type: 'PURCHASE',
          };
        } else if (objective === 'OUTCOME_TRAFFIC') {
          adsetBody.optimization_goal = 'LINK_CLICKS';
        } else {
          adsetBody.optimization_goal = 'REACH';
        }

        const r = await fetch(`${BASE}/${adAccountId}/adsets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adsetBody),
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }

      case 'create_creative': {
        // Build + create the ad creative. Supports image, video, and carousel.
        // Returns { creativeId } so the client can call create_ad_from_creative next.
        const { imageHash, videoId: preUploadedVideoId, cards, adName, headline, primaryText, destUrl } = req.body;
        const pageId = req.body.pageId || defaultPageId;
        const instagramUserId = (req.body.instagramUserId || '').trim() || undefined;

        let creativeParams;
        if (cards && cards.length >= 2) {
          const childAttachments = cards.map(card => ({
            link: card.destUrl || destUrl,
            image_hash: card.imageHash,
            name: card.headline || headline || '',
            description: card.body || '',
            call_to_action: { type: 'SHOP_NOW' },
          }));
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
              link_data: {
                link: destUrl,
                message: primaryText || headline,
                child_attachments: childAttachments,
                multi_share_optimized: false,
              },
            }),
            access_token: accessToken,
          });
        } else if (preUploadedVideoId) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
              video_data: {
                video_id: preUploadedVideoId,
                message: primaryText || headline,
                title: headline,
                call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
              },
            }),
            access_token: accessToken,
          });
        } else if (imageHash) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}),
              link_data: {
                image_hash: imageHash,
                link: destUrl,
                message: primaryText || headline,
                name: headline,
                call_to_action: { type: 'SHOP_NOW' },
              },
            }),
            access_token: accessToken,
          });
        } else {
          return res.status(400).json({ error: 'No imageHash, videoId, or cards provided', step: 'create_creative' });
        }
        appendUrlTags(creativeParams, req.body.urlParams);

        const r = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const d = await r.json();
        if (d.error) {
          return res.status(400).json({ error: d.error.error_user_msg || d.error.message, detail: d.error, step: 'create_creative' });
        }
        return res.json({ success: true, creativeId: d.id });
      }

      case 'create_ad_from_creative': {
        const { creativeId, adName, adsetId, headline, primaryText, destUrl, mimeType } = req.body;
        if (!creativeId || !adsetId) {
          return res.status(400).json({ error: 'creativeId and adsetId required', step: 'create_ad' });
        }
        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        appendUrlTags(adParams, req.body.urlParams);
        const r = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const d = await r.json();
        if (d.error) {
          return res.status(400).json({ error: d.error.message, step: 'create_ad' });
        }
        await logLaunch({
          ad_id: d.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: mimeType || 'image',
          creator: req.body.creator || 'Static Builder',
          creator_id: req.body.creatorId || null,
          source_type: req.body.sourceType || 'tool_generated',
          source_label: req.body.sourceLabel || req.body.creator || 'In-app builder',
          brief_id: req.body.briefId || null,
          deliverable_id: req.body.deliverableId || null,
          source_video_url: req.body.sourceVideoUrl || null,
          ...actor,
        });
        return res.json({ success: true, adId: d.id });
      }

      case 'create_paired_image_ad': {
        const { feedImageHash, storyImageHash, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;
        const instagramUserId = (req.body.instagramUserId || '').trim() || undefined;
        if (!feedImageHash || !storyImageHash) return res.status(400).json({ error: 'feedImageHash and storyImageHash required', step: 'validate' });
        if (!adsetId || !pageId || !destUrl || !adName) return res.status(400).json({ error: 'Missing required fields', step: 'validate' });

        const assetFeedSpec = {
          images: [
            { hash: feedImageHash, adlabels: [{ name: 'image_feed' }] },
            { hash: storyImageHash, adlabels: [{ name: 'image_story' }] },
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
          access_token: accessToken,
        });
        appendUrlTags(creativeParams, req.body.urlParams);
        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: creativeParams,
        });
        const creativeData = await creativeRes.json();
        if (creativeData.error) {
          return res.status(400).json({ error: creativeData.error.error_user_msg || creativeData.error.message, detail: creativeData.error, step: 'create_creative' });
        }

        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        appendUrlTags(adParams, req.body.urlParams);
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: adParams,
        });
        const adData = await adRes.json();
        if (adData.error) return res.status(400).json({ error: adData.error.message, step: 'create_ad' });

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: 'image (paired)',
          creator: req.body.creator || 'Static Builder',
          creator_id: req.body.creatorId || null,
          source_type: req.body.sourceType || 'tool_generated',
          source_label: req.body.sourceLabel || req.body.creator || 'In-app builder',
          brief_id: req.body.briefId || null,
          deliverable_id: req.body.deliverableId || null,
          source_video_url: req.body.sourceVideoUrl || null,
          ...actor,
        });

        return res.json({ success: true, adId: adData.id, creativeId: creativeData.id });
      }

      case 'push_ad': {
        const { imageHash, videoId: preUploadedVideoId, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        let creativeParams;

        if (preUploadedVideoId) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              video_data: {
                video_id: preUploadedVideoId,
                message: primaryText || headline,
                title: headline,
                call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
              },
            }),
            access_token: accessToken,
          });
        } else if (imageHash) {
          creativeParams = new URLSearchParams({
            name: `${adName} Creative`,
            object_story_spec: JSON.stringify({
              page_id: pageId,
              link_data: {
                image_hash: imageHash,
                link: destUrl,
                message: primaryText || headline,
                name: headline,
                call_to_action: { type: 'SHOP_NOW' },
              },
            }),
            access_token: accessToken,
          });
        } else {
          return res.status(400).json({ error: 'No imageHash or videoId provided. Upload asset first.', step: 'validate' });
        }

        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const creativeData = await creativeRes.json();

        if (creativeData.error) {
          // Return full error detail for debugging
          return res.status(400).json({
            error: creativeData.error.error_user_msg || creativeData.error.message,
            detail: creativeData.error,
            step: 'create_creative',
          });
        }

        // 3. Create ad (PAUSED — review before going live)
        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const adData = await adRes.json();

        if (adData.error) {
          return res.status(400).json({ error: adData.error.message, step: 'create_ad' });
        }

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: preUploadedVideoId ? 'video/mp4' : 'image',
          creator: req.body.creator || 'Static Builder',
          creator_id: req.body.creatorId || null,
          source_type: req.body.sourceType || 'tool_generated',
          source_label: req.body.sourceLabel || req.body.creator || 'In-app builder',
          brief_id: req.body.briefId || null,
          deliverable_id: req.body.deliverableId || null,
          source_video_url: req.body.sourceVideoUrl || null,
          ...actor,
        });

        return res.json({ success: true, adId: adData.id });
      }

      case 'push_carousel': {
        const { cards, adName, headline, primaryText, destUrl, adsetId } = req.body;
        const pageId = req.body.pageId || defaultPageId;

        if (!cards || cards.length < 2) {
          return res.status(400).json({ error: 'Carousel requires at least 2 cards', step: 'validate' });
        }

        // Cards come with pre-uploaded imageHash (no base64)
        const childAttachments = cards.map(card => ({
          link: card.destUrl || destUrl,
          image_hash: card.imageHash,
          name: card.headline || headline || '',
          description: card.body || '',
          call_to_action: { type: 'SHOP_NOW' },
        }));

        const creativeParams = new URLSearchParams({
          name: `${adName} Creative`,
          object_story_spec: JSON.stringify({
            page_id: pageId,
            link_data: {
              link: destUrl,
              message: primaryText || headline,
              child_attachments: childAttachments,
              multi_share_optimized: false,
            },
          }),
          access_token: accessToken,
        });

        const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: creativeParams,
        });
        const creativeData = await creativeRes.json();

        if (creativeData.error) {
          return res.status(400).json({
            error: creativeData.error.error_user_msg || creativeData.error.message,
            detail: creativeData.error,
            step: 'create_creative',
          });
        }

        const adParams = new URLSearchParams({
          name: adName,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeData.id }),
          status: 'PAUSED',
          access_token: accessToken,
        });
        const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: adParams,
        });
        const adData = await adRes.json();

        if (adData.error) {
          return res.status(400).json({ error: adData.error.message, step: 'create_ad' });
        }

        await logLaunch({
          ad_id: adData.id,
          adset_id: adsetId,
          ad_name: adName,
          headline,
          primary_text: primaryText,
          dest_url: destUrl,
          mime_type: 'carousel',
          creator: req.body.creator || 'Static Builder',
          creator_id: req.body.creatorId || null,
          source_type: req.body.sourceType || 'tool_generated',
          source_label: req.body.sourceLabel || req.body.creator || 'In-app builder',
          brief_id: req.body.briefId || null,
          deliverable_id: req.body.deliverableId || null,
          ...actor,
        });

        return res.json({ success: true, adId: adData.id });
      }

      case 'upload_image': {
        const { imageBase64 } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
        try {
          const hash = await uploadImage(imageBase64, adAccountId, accessToken, BASE);
          return res.json({ success: true, hash });
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_image' });
        }
      }

      case 'upload_video': {
        const { videoBase64, name } = req.body;
        if (!videoBase64) return res.status(400).json({ error: 'No video data provided' });
        try {
          const { videoId, blobUrl } = await uploadVideo(videoBase64, name, adAccountId, accessToken, BASE);
          return res.json({ success: true, videoId, sourceVideoUrl: blobUrl });
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_video' });
        }
      }

      case 'upload_video_url': {
        const { videoUrl, name } = req.body;
        if (!videoUrl) return res.status(400).json({ error: 'No video URL provided' });
        try {
          const parsed = new URL(videoUrl);
          if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.blob.vercel-storage.com')) {
            throw new Error('Only HOWL Vercel Blob video URLs are accepted');
          }
          const { videoId, blobUrl } = await uploadVideoFromUrl(
            parsed.toString(),
            name,
            adAccountId,
            accessToken,
            BASE,
          );
          return res.json({ success: true, videoId, sourceVideoUrl: blobUrl || videoUrl });
        } catch (err) {
          return res.status(400).json({ error: err.message, step: 'upload_video_url' });
        }
      }

      case 'create_creative_test': {
        const { testName, dailyBudgetDollars, costCapCents, pixelId, items } = req.body;
        const pageId = req.body.pageId || defaultPageId;
        const destUrl = req.body.destUrl;

        if (!items || items.length === 0) {
          return res.status(400).json({ error: 'No creatives provided', step: 'validate' });
        }

        // 1. Create ABO campaign (PAUSED)
        const campaignBody = {
          name: testName || `[CT] HOWL — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          objective: 'OUTCOME_SALES',
          status: 'PAUSED',
          special_ad_categories: [],
          is_adset_budget_sharing_enabled: false,
          access_token: accessToken,
        };
        const campaignRes = await fetch(`${BASE}/${adAccountId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignBody),
        });
        const campaignData = await campaignRes.json();
        if (campaignData.error) {
          return res.status(400).json({ error: campaignData.error.error_user_msg || campaignData.error.message, detail: campaignData.error, step: 'create_campaign' });
        }
        const campaignId = campaignData.id;

        // 2. Create one ad set per creative, each with equal budget
        const dailyBudgetCents = String(Math.round(parseFloat(dailyBudgetDollars || '20') * 100));
        const results = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];

          // Create ad set
          const adsetBody = {
            name: `${item.name || `Creative ${i + 1}`}`,
            campaign_id: campaignId,
            daily_budget: dailyBudgetCents,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'OFFSITE_CONVERSIONS',
            bid_strategy: costCapCents ? 'COST_CAP' : 'LOWEST_COST_WITHOUT_CAP',
            ...(costCapCents ? { bid_amount: String(costCapCents) } : {}),
            status: 'PAUSED',
            targeting: {
              geo_locations: { countries: ['US'] },
              age_min: 18,
              age_max: 65,
              ...(req.body.excludeAudienceId
                ? { exclusions: { custom_audiences: [{ id: req.body.excludeAudienceId }] } }
                : {}),
            },
            access_token: accessToken,
          };

          if (pixelId) {
            adsetBody.promoted_object = {
              pixel_id: pixelId,
              custom_event_type: 'PURCHASE',
            };
          }

          const adsetRes = await fetch(`${BASE}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adsetBody),
          });
          const adsetData = await adsetRes.json();
          if (adsetData.error) {
            results.push({ item: item.name, error: adsetData.error.error_user_msg || adsetData.error.message, step: 'create_adset' });
            continue;
          }

          // Build creative using pre-uploaded asset hashes/videoIds (no base64 here)
          let creativeParams;
          try {
            if (item.type === 'carousel' && item.cardHashes) {
              const childAttachments = item.cardHashes.map((hash, ci) => ({
                link: destUrl,
                image_hash: hash,
                name: (item.cards && item.cards[ci]?.headline) || item.hook || '',
                description: (item.cards && item.cards[ci]?.body) || '',
                call_to_action: { type: 'SHOP_NOW' },
              }));
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  link_data: {
                    link: destUrl,
                    message: item.body || item.hook || '',
                    child_attachments: childAttachments,
                    multi_share_optimized: false,
                  },
                }),
                access_token: accessToken,
              });
            } else if (item.type === 'video' && item.videoId) {
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  video_data: {
                    video_id: item.videoId,
                    message: item.body || item.hook || '',
                    title: item.hook || '',
                    call_to_action: { type: 'SHOP_NOW', value: { link: destUrl } },
                  },
                }),
                access_token: accessToken,
              });
            } else if (item.imageHash) {
              creativeParams = new URLSearchParams({
                name: `${item.name} Creative`,
                object_story_spec: JSON.stringify({
                  page_id: pageId,
                  link_data: {
                    image_hash: item.imageHash,
                    link: destUrl,
                    message: item.body || item.hook || '',
                    name: item.hook || '',
                    call_to_action: { type: 'SHOP_NOW' },
                  },
                }),
                access_token: accessToken,
              });
            }
          } catch (err) {
            results.push({ item: item.name, error: err.message, step: 'build_creative' });
            continue;
          }

          const creativeRes = await fetch(`${BASE}/${adAccountId}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: creativeParams,
          });
          const creativeData = await creativeRes.json();
          if (creativeData.error) {
            results.push({ item: item.name, error: creativeData.error.error_user_msg || creativeData.error.message, step: 'create_creative' });
            continue;
          }

          // Create ad (PAUSED)
          const adParams = new URLSearchParams({
            name: item.name || `Creative ${i + 1}`,
            adset_id: adsetData.id,
            creative: JSON.stringify({ creative_id: creativeData.id }),
            status: 'PAUSED',
            access_token: accessToken,
          });
          const adRes = await fetch(`${BASE}/${adAccountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: adParams,
          });
          const adData = await adRes.json();
          if (adData.error) {
            results.push({ item: item.name, error: adData.error.message, step: 'create_ad' });
            continue;
          }

          await logLaunch({
            ad_id: adData.id,
            adset_id: adsetData.id,
            campaign_id: campaignId,
            ad_name: item.name || `Creative ${i + 1}`,
            headline: item.hook || '',
            primary_text: item.body || '',
            dest_url: destUrl,
            angle_id: item.angle || null,
            product_id: item.product || null,
            mime_type: item.type || 'static',
            creator: item.creator || req.body.creator || 'Static Builder',
            creator_id: item.creatorId || req.body.creatorId || null,
            source_type: item.sourceType || req.body.sourceType || 'tool_generated',
            source_label: item.sourceLabel || req.body.sourceLabel || item.creator || req.body.creator || 'In-app builder',
            brief_id: item.briefId || req.body.briefId || null,
            deliverable_id: item.deliverableId || req.body.deliverableId || null,
            source_video_url: item.sourceVideoUrl || null,
            ...actor,
          });

          results.push({ item: item.name, adsetId: adsetData.id, adId: adData.id, success: true });
        }

        const succeeded = results.filter(item => item.success).length;
        return res.json({ success: succeeded === items.length, status: succeeded === items.length ? 'complete' : succeeded ? 'partial' : 'failed', campaignId, results });
      }

      case 'get_cpa_analysis': {
        // Pull conversion data across multiple time windows for cost cap recommendation
        const [insights7d, insights14d, insights30d, campaignInsights, adInsights] = await Promise.all([
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_7d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_14d&access_token=${accessToken}`),
          fetch(`${BASE}/${adAccountId}/insights?fields=spend,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&access_token=${accessToken}`),
          // Per-campaign breakdown (last 30d, only campaigns that spent)
          fetch(`${BASE}/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,actions,cost_per_action_type,purchase_roas&date_preset=last_30d&level=campaign&limit=50&access_token=${accessToken}`),
          // Top ads by spend (last 30d)
          fetch(`${BASE}/${adAccountId}/insights?fields=ad_id,ad_name,spend,actions,cost_per_action_type&date_preset=last_30d&level=ad&sort=spend_descending&limit=30&access_token=${accessToken}`),
        ]);
        const [d7, d14, d30, dCamp, dAds] = await Promise.all([
          insights7d.json(), insights14d.json(), insights30d.json(), campaignInsights.json(), adInsights.json(),
        ]);

        if (d7.error) throw new Error(d7.error.message);

        const extractCPA = (data) => {
          const row = data?.data?.[0];
          if (!row) return null;
          const spend = parseFloat(row.spend || 0);
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          const roas = (row.purchase_roas || []).find(a => a.action_type === 'omni_purchase')?.value || null;
          return { spend, purchases: parseInt(purchases), cpa: cpa ? parseFloat(cpa) : null, roas: roas ? parseFloat(roas) : null };
        };

        const campaignBreakdown = (dCamp.data || []).map(row => {
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          const roas = (row.purchase_roas || []).find(a => a.action_type === 'omni_purchase')?.value || null;
          return {
            campaign_id: row.campaign_id,
            campaign_name: row.campaign_name,
            spend: parseFloat(row.spend || 0),
            purchases: parseInt(purchases),
            cpa: cpa ? parseFloat(cpa) : null,
            roas: roas ? parseFloat(roas) : null,
          };
        }).filter(c => c.spend > 0);

        const topAds = (dAds.data || []).map(row => {
          const purchases = (row.actions || []).find(a => a.action_type === 'purchase')?.value || 0;
          const cpa = (row.cost_per_action_type || []).find(a => a.action_type === 'purchase')?.value || null;
          return {
            ad_id: row.ad_id,
            ad_name: row.ad_name,
            spend: parseFloat(row.spend || 0),
            purchases: parseInt(purchases),
            cpa: cpa ? parseFloat(cpa) : null,
          };
        }).filter(a => a.spend > 0);

        return res.json({
          last7d: extractCPA(d7),
          last14d: extractCPA(d14),
          last30d: extractCPA(d30),
          campaigns: campaignBreakdown,
          topAds,
        });
      }

      case 'sync_creative_analytics': {
        const result = await syncCreativeAnalytics({ sql: appAccess.sql, accessToken, adAccountId, sinceDays: req.body.sinceDays, force: req.body.force === true });
        return res.json(result);
      }

      case 'get_sku_spend_pacing': {
        const monthKey = String(req.body.monthKey || '').trim();
        if (!/^\d{4}-\d{2}$/.test(monthKey)) return res.status(400).json({ error: 'monthKey must be YYYY-MM' });
        const [year, month] = monthKey.split('-').map(Number);
        const start = new Date(Date.UTC(year, month - 1, 1));
        const end = new Date(Date.UTC(year, month, 0));
        const today = new Date();
        const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
        const untilDate = start > todayUtc ? end : (end < todayUtc ? end : todayUtc);
        const fmtYmd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        const timeRange = encodeURIComponent(JSON.stringify({ since: fmtYmd(start), until: fmtYmd(untilDate) }));
        const fields = [
          'ad_id',
          'ad_name',
          'adset_id',
          'adset_name',
          'campaign_id',
          'campaign_name',
          'spend',
        ].join(',');
        let insightsPage = `${BASE}/${adAccountId}/insights?level=ad&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${accessToken}`;
        const insightRows = [];
        for (let pageGuard = 0; pageGuard < 100 && insightsPage; pageGuard++) {
          const r = await fetch(insightsPage);
          const d = await r.json();
          if (d.error) return res.status(400).json({ error: d.error.message, step: 'sku_spend_insights' });
          insightRows.push(...(d.data || []));
          insightsPage = d.paging?.next || null;
        }

        const adIds = insightRows.map(row => row.ad_id).filter(Boolean);
        const launchProductByAd = new Map();
        if (adIds.length && process.env.DATABASE_URL) {
          const { neon } = await import('@neondatabase/serverless');
          const sql = neon(process.env.DATABASE_URL);
          try {
            const launchRows = await sql`
              SELECT DISTINCT ON (ad_id) ad_id, product_id
              FROM launch_history
              WHERE ad_id = ANY(${adIds})
                AND product_id IS NOT NULL
              ORDER BY ad_id, launched_at DESC
            `;
            launchRows.forEach(row => launchProductByAd.set(row.ad_id, row.product_id));
          } catch (err) {
            console.error('sku spend launch history lookup failed:', err.message);
          }
        }

        const bySku = {};
        const byConfidence = {};
        const unmapped = [];
        const rows = insightRows.map(row => {
          const spend = Number(row.spend || 0);
          const productId = launchProductByAd.get(row.ad_id) || null;
          const mapped = classifySkuSpend(row, productId);
          if (mapped.sku) bySku[mapped.sku] = (bySku[mapped.sku] || 0) + spend;
          else if (spend > 0) unmapped.push({
            ad_id: row.ad_id,
            ad_name: row.ad_name || null,
            adset_name: row.adset_name || null,
            campaign_name: row.campaign_name || null,
            spend,
          });
          byConfidence[mapped.confidence] = (byConfidence[mapped.confidence] || 0) + spend;
          return {
            ad_id: row.ad_id,
            ad_name: row.ad_name || null,
            adset_id: row.adset_id || null,
            adset_name: row.adset_name || null,
            campaign_id: row.campaign_id || null,
            campaign_name: row.campaign_name || null,
            spend,
            sku: mapped.sku,
            confidence: mapped.confidence,
            launch_product_id: productId,
          };
        }).filter(row => row.spend > 0);

        return res.json({
          ok: true,
          monthKey,
          since: fmtYmd(start),
          until: fmtYmd(untilDate),
          bySku,
          byConfidence,
          unmapped,
          rows,
          totalSpend: rows.reduce((sum, row) => sum + row.spend, 0),
          mappedSpend: Object.values(bySku).reduce((sum, spend) => sum + spend, 0),
        });
      }

      case 'get_creative_table': {
        if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not configured' });
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);
        await ensureCreativeAssetTables(sql);
        await ensureCreativeAnalysisQueue(sql);
        await ensureCreatorOpsTables(sql);
        await ensureCreativeEvidenceTaskTables(sql);

        const sinceDays = Math.max(1, Math.min(365, parseInt(req.body.sinceDays || 14, 10)));
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const [latestInsight] = await sql`
          SELECT max(date)::text AS latest_date
          FROM creative_insights_daily
        `;
        const tsNow = latestInsight?.latest_date ? new Date(`${latestInsight.latest_date}T00:00:00Z`) : new Date();
        const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);
        const since = fmtYmd(tsSince);
        const until = fmtYmd(tsNow);

        const rows = await sql`
          WITH agg AS (
            SELECT
              cp.group_key,
              SUM(i.spend)::float           AS spend,
              SUM(i.impressions)::bigint    AS impressions,
              SUM(i.clicks)::bigint         AS clicks,
              SUM(i.unique_link_clicks)::bigint AS unique_link_clicks,
              SUM(i.purchases)::bigint      AS purchases,
              SUM(i.purchase_value)::float  AS purchase_value,
              SUM(i.video_3s_views)::bigint AS video_3s_views,
              SUM(i.video_thruplays)::bigint AS video_thruplays
            FROM creative_performance cp
            JOIN creative_insights_daily i ON i.ad_id = cp.ad_id
            WHERE i.date BETWEEN ${since} AND ${until}
            GROUP BY cp.group_key
          ),
          meta AS (
            SELECT DISTINCT ON (cp.group_key)
              cp.group_key,
              cp.video_id,
              cp.ad_name        AS name,
              cp.thumbnail_url,
              MIN(cp.created_time) OVER (PARTITION BY cp.group_key) AS first_launch_date,
              COUNT(*)          OVER (PARTITION BY cp.group_key) AS ad_count
            FROM creative_performance cp
            ORDER BY cp.group_key, cp.created_time ASC
          )
          SELECT
            m.group_key, m.video_id, m.name, m.thumbnail_url, m.first_launch_date, m.ad_count,
            COALESCE(a.spend, 0)              AS spend,
            COALESCE(a.purchase_value, 0)     AS purchase_value,
            COALESCE(a.purchases, 0)          AS purchases,
            COALESCE(a.impressions, 0)        AS impressions,
            COALESCE(a.clicks, 0)             AS clicks,
            COALESCE(a.unique_link_clicks, 0) AS unique_link_clicks,
            COALESCE(a.video_3s_views, 0)     AS video_3s_views,
            COALESCE(a.video_thruplays, 0)    AS video_thruplays,
            attribution.creator_id,
            attribution.creator_name,
            attribution.source_type,
            attribution.source_label,
            asset_media.asset_id,
            COALESCE(asset_media.meta_video_id, m.video_id) AS meta_video_id,
            asset_media.mime_type,
            asset_media.playable_url,
            asset_media.preview_url,
            asset_media.playback_status,
            asset_media.playback_error,
            asset_media.transcript_status,
            asset_media.transcript_error,
            asset_media.analyzed_at,
            analysis.angle AS analysis_angle,
            analysis.format AS analysis_format,
            analysis.hook_type AS analysis_hook_type,
            analysis.confidence AS analysis_confidence,
            analysis.operator_summary AS analysis_operator_summary,
            analysis.recommended_next_step AS analysis_recommended_next_step,
            analysis.structured_analysis AS analysis_structured,
            analysis.generated_at AS analysis_generated_at,
            transcript_task.status AS transcript_task_status,
            transcript_task.owner AS transcript_task_owner,
            transcript_task.note AS transcript_task_note,
            transcript_task.due_date::text AS transcript_task_due_date,
            transcript_task.updated_at AS transcript_task_updated_at,
            source_task.status AS source_task_status,
            source_task.owner AS source_task_owner,
            source_task.note AS source_task_note,
            source_task.due_date::text AS source_task_due_date,
            source_task.updated_at AS source_task_updated_at,
            COALESCE(attribution.creator_count, 0)::int AS creator_count,
            EXISTS (SELECT 1 FROM creative_analysis ca WHERE ca.group_key = m.group_key) AS is_analyzed,
            (SELECT q.status FROM creative_analysis_queue q WHERE q.group_key = m.group_key) AS analysis_queue_status
          FROM meta m
          LEFT JOIN agg a USING (group_key)
          LEFT JOIN LATERAL (
            SELECT
              min(linked.creator_id) AS creator_id,
              min(c.name) AS creator_name,
              min(linked.source_type) FILTER (WHERE linked.source_type IS NOT NULL) AS source_type,
              min(linked.source_label) FILTER (WHERE linked.source_label IS NOT NULL) AS source_label,
              count(DISTINCT linked.creator_id) FILTER (WHERE linked.creator_id IS NOT NULL) AS creator_count
            FROM (
              SELECT
                assignment.creator_id,
                COALESCE(assignment.source_type, CASE WHEN assignment.creator_id IS NOT NULL THEN 'external_creator' END) AS source_type,
                COALESCE(assignment.source_label, c.name) AS source_label
              FROM creative_creator_assignments assignment
              LEFT JOIN creators c ON c.id = assignment.creator_id
              WHERE assignment.group_key = m.group_key
              UNION ALL
              SELECT asset.creator_id, asset.source_type, asset.source_label
              FROM creative_assets asset
              WHERE asset.group_key = m.group_key
              UNION ALL
              SELECT launch.creator_id, launch.source_type, launch.source_label
              FROM launch_history launch
              JOIN creative_performance linked_cp ON linked_cp.ad_id = launch.ad_id
              WHERE linked_cp.group_key = m.group_key
            ) linked
            LEFT JOIN creators c ON c.id = linked.creator_id
          ) attribution ON true
          LEFT JOIN LATERAL (
            SELECT
              asset.id AS asset_id,
              asset.meta_video_id,
              asset.mime_type,
              COALESCE(asset.playable_url, asset.durable_url) AS playable_url,
              COALESCE(asset.preview_url, asset.drive_thumbnail_url, m.thumbnail_url) AS preview_url,
              asset.playback_status,
              asset.playback_error,
              asset.transcript_status,
              asset.transcript_error,
              asset.analyzed_at
            FROM creative_assets asset
            WHERE asset.group_key = m.group_key
               OR asset.ad_id IN (SELECT cp2.ad_id FROM creative_performance cp2 WHERE cp2.group_key = m.group_key)
            ORDER BY
              (COALESCE(asset.playable_url, asset.durable_url) IS NOT NULL) DESC,
              (asset.placement_role = 'feed') DESC,
              asset.updated_at DESC
            LIMIT 1
          ) asset_media ON true
          LEFT JOIN LATERAL (
            SELECT
              ca.angle,
              ca.format,
              ca.hook_type,
              ca.confidence,
              ca.operator_summary,
              ca.recommended_next_step,
              ca.structured_analysis,
              ca.generated_at
            FROM creative_analysis ca
            WHERE ca.group_key = m.group_key
            LIMIT 1
          ) analysis ON true
          LEFT JOIN creative_evidence_tasks transcript_task
            ON transcript_task.group_key = m.group_key
           AND transcript_task.task_type = 'transcript'
          LEFT JOIN creative_evidence_tasks source_task
            ON source_task.group_key = m.group_key
           AND source_task.task_type = 'source_review'
          WHERE COALESCE(a.spend, 0) > 0 OR COALESCE(a.impressions, 0) > 0
          ORDER BY spend DESC NULLS LAST
          LIMIT 500
        `;

        const creatorRows = await sql`
          SELECT c.id, c.name,
            COALESCE(array_agg(s.handle) FILTER (WHERE s.handle IS NOT NULL), '{}') AS handles
          FROM creators c
          LEFT JOIN creator_social_accounts s ON s.creator_id = c.id
          GROUP BY c.id, c.name
        `;
        const matchIndex = creatorMatchIndex(creatorRows);
        const groups = rows.map(r => {
          const spend = Number(r.spend) || 0;
          const purchaseValue = Number(r.purchase_value) || 0;
          const purchases = Number(r.purchases) || 0;
          const clicks = Number(r.clicks) || 0;
          const impressions = Number(r.impressions) || 0;
          const v3s = Number(r.video_3s_views) || 0;
          const vThru = Number(r.video_thruplays) || 0;
          const suggestion = !r.creator_id && !r.source_type ? suggestCreator(r.name, matchIndex) : null;
          const sourceSuggestion = !r.creator_id && !r.source_type && !suggestion ? suggestSourceTag(r.name) : null;
          const assetKind = inferAssetKind({
            name: r.name,
            mimeType: r.mime_type,
            playableUrl: r.playable_url,
            video3sViews: v3s,
            videoThruplays: vThru,
          });
          return {
            groupKey: r.group_key,
            name: r.name,
            thumbnailUrl: r.thumbnail_url,
            assetId: r.asset_id ? Number(r.asset_id) : null,
            assetKind,
            mimeType: r.mime_type || null,
            playableUrl: r.playable_url || null,
            playbackEmbedUrl: assetKind === 'video' ? metaVideoEmbedUrl(r.meta_video_id || r.group_key) : null,
            previewUrl: r.preview_url || r.thumbnail_url || null,
            playbackStatus: r.playback_status || (r.playable_url ? 'ready' : 'missing'),
            playbackError: r.playback_error || null,
            transcriptStatus: r.transcript_status || null,
            transcriptError: r.transcript_error || null,
            analyzedAt: r.analyzed_at || null,
            firstLaunchDate: r.first_launch_date,
            adCount: Number(r.ad_count) || 0,
            spend,
            purchaseValue,
            purchases,
            roas: spend > 0 ? purchaseValue / spend : 0,
            cpa: purchases > 0 ? spend / purchases : null,
            cpc: clicks > 0 ? spend / clicks : null,
            ctr: impressions > 0 ? clicks / impressions : 0,
            hookRate: impressions > 0 ? v3s / impressions : 0,
            holdRate: v3s > 0 ? vThru / v3s : 0,
            impressions,
            clicks,
            creatorId: r.creator_id ? Number(r.creator_id) : null,
            creatorName: r.creator_name || null,
            sourceType: r.source_type || null,
            sourceLabel: r.source_label || null,
            creatorConflict: Number(r.creator_count || 0) > 1,
            suggestedCreatorId: suggestion?.creatorId || null,
            suggestedCreatorName: suggestion?.creatorName || null,
            suggestionConfidence: suggestion?.confidence || null,
            suggestionReason: suggestion?.reason || null,
            suggestedSourceType: sourceSuggestion?.sourceType || null,
            suggestedSourceLabel: sourceSuggestion?.sourceLabel || null,
            suggestedSourceConfidence: sourceSuggestion?.confidence || null,
            suggestedSourceReason: sourceSuggestion?.reason || null,
            isAnalyzed: !!r.is_analyzed,
            analysisAngle: r.analysis_angle || null,
            analysisFormat: r.analysis_format || null,
            analysisHookType: r.analysis_hook_type || null,
            analysisConfidence: r.analysis_confidence == null ? null : Number(r.analysis_confidence),
            analysisOperatorSummary: r.analysis_operator_summary || null,
            analysisRecommendedNextStep: r.analysis_recommended_next_step || null,
            analysisStructured: r.analysis_structured || null,
            analysisGeneratedAt: r.analysis_generated_at || null,
            transcriptTaskStatus: r.transcript_task_status || null,
            transcriptTaskOwner: r.transcript_task_owner || null,
            transcriptTaskNote: r.transcript_task_note || null,
            transcriptTaskDueDate: r.transcript_task_due_date || null,
            transcriptTaskUpdatedAt: r.transcript_task_updated_at || null,
            sourceTaskStatus: r.source_task_status || null,
            sourceTaskOwner: r.source_task_owner || null,
            sourceTaskNote: r.source_task_note || null,
            sourceTaskDueDate: r.source_task_due_date || null,
            sourceTaskUpdatedAt: r.source_task_updated_at || null,
            analysisQueueStatus: r.analysis_queue_status || null,
          };
        });

        return res.json({ groups, sinceDays, since, until });
      }

      case 'assign_creative_creator': {
        const groupKey = (req.body.groupKey || '').toString().trim();
        const creatorId = req.body.creatorId ? Number(req.body.creatorId) : null;
        const allowedSourceTypes = new Set(['internal_employee', 'founder', 'tool_generated']);
        const requestedSourceType = (req.body.sourceType || '').toString().trim();
        const sourceType = creatorId ? 'external_creator' : (allowedSourceTypes.has(requestedSourceType) ? requestedSourceType : null);
        const sourceLabel = (req.body.sourceLabel || '').toString().trim() || null;
        if (!groupKey) return res.status(400).json({ error: 'groupKey required' });
        if (sourceType && sourceType !== 'external_creator' && ['internal_employee', 'founder'].includes(sourceType) && !sourceLabel) {
          return res.status(400).json({ error: 'sourceLabel required for founder or internal source tags' });
        }
        const sql = appAccess.sql;
        await ensureCreatorOpsTables(sql);
        await ensureCreativeAuditTables(sql);
        let creator = null;
        const [previousAssignment] = await sql`
          SELECT creator_id, source_type, source_label
          FROM creative_creator_assignments
          WHERE group_key = ${groupKey}
        `;
        const resolvedSourceLabel = creatorId ? null : (sourceLabel || (sourceType === 'tool_generated' ? 'Made in HOWL' : null));
        if (creatorId) {
          [creator] = await sql`SELECT id, name FROM creators WHERE id = ${creatorId}`;
          if (!creator) return res.status(404).json({ error: 'Creator not found' });
          await sql`
            INSERT INTO creative_creator_assignments (group_key, creator_id, source_type, source_label, assigned_by)
            VALUES (${groupKey}, ${creatorId}, 'external_creator', ${creator.name}, ${appAccess.userId})
            ON CONFLICT (group_key) DO UPDATE SET
              creator_id = EXCLUDED.creator_id,
              source_type = EXCLUDED.source_type,
              source_label = EXCLUDED.source_label,
              assigned_by = EXCLUDED.assigned_by,
              updated_at = now()
          `;
        } else if (sourceType) {
          await sql`
            INSERT INTO creative_creator_assignments (group_key, creator_id, source_type, source_label, assigned_by)
            VALUES (${groupKey}, null, ${sourceType}, ${resolvedSourceLabel}, ${appAccess.userId})
            ON CONFLICT (group_key) DO UPDATE SET
              creator_id = null,
              source_type = EXCLUDED.source_type,
              source_label = EXCLUDED.source_label,
              assigned_by = EXCLUDED.assigned_by,
              updated_at = now()
          `;
        } else {
          await sql`DELETE FROM creative_creator_assignments WHERE group_key = ${groupKey}`;
        }
        const assets = await sql`
          UPDATE creative_assets
          SET creator_id = ${creatorId},
              creator = ${creator?.name || null},
              source_type = ${creatorId ? 'external_creator' : sourceType},
              source_label = ${creator?.name || resolvedSourceLabel},
              updated_at = now()
          WHERE group_key = ${groupKey}
          RETURNING id
        `;
        const launches = await sql`
          UPDATE launch_history launch
          SET creator_id = ${creatorId},
              creator = ${creator?.name || null},
              source_type = ${creatorId ? 'external_creator' : sourceType},
              source_label = ${creator?.name || resolvedSourceLabel}
          WHERE launch.ad_id IN (
            SELECT ad_id FROM creative_performance WHERE group_key = ${groupKey}
          )
          RETURNING id
        `;
        if (creatorId) {
          await sql`
            INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
            VALUES (
              ${creatorId}, 'creative_performance_linked',
              ${`Linked creative analytics group "${groupKey}"`},
              ${JSON.stringify({ group_key: groupKey, assets: assets.length, launches: launches.length })}::jsonb,
              ${appAccess.userId}
            )
          `;
        }
        await logCreativeOperatorEvent(sql, {
          eventType: creatorId ? 'creator_assigned' : (sourceType ? 'source_tagged' : 'assignment_removed'),
          groupKey,
          creatorId,
          creatorName: creator?.name || null,
          sourceType: creatorId ? 'external_creator' : sourceType,
          sourceLabel: creator?.name || resolvedSourceLabel,
          userId: appAccess.userId,
          userEmail: appAccess.email,
          metadata: {
            assets_updated: assets.length,
            launches_updated: launches.length,
            previous_assignment: previousAssignment || null,
          },
        });
        return res.json({
          creator: creator || null,
          sourceType: creatorId ? 'external_creator' : sourceType,
          sourceLabel: creator?.name || resolvedSourceLabel,
          groupKey,
          assetsUpdated: assets.length,
          launchesUpdated: launches.length,
        });
      }

      case 'assign_creative_creators': {
        const assignments = Array.isArray(req.body.assignments)
          ? req.body.assignments.slice(0, 100).map(item => ({
              groupKey: (item.groupKey || '').toString().trim(),
              creatorId: Number(item.creatorId),
            })).filter(item => item.groupKey && item.creatorId)
          : [];
        if (!assignments.length) return res.status(400).json({ error: 'assignments required' });
        const sql = appAccess.sql;
        await ensureCreatorOpsTables(sql);
        await ensureCreativeAuditTables(sql);
        const creatorIds = [...new Set(assignments.map(item => item.creatorId))];
        const creatorRows = await sql`
          SELECT id, name FROM creators WHERE id = ANY(${creatorIds}::bigint[])
        `;
        const creatorsById = new Map(creatorRows.map(creator => [Number(creator.id), creator]));
        if (creatorsById.size !== creatorIds.length) return res.status(404).json({ error: 'One or more creators were not found' });

        const completed = [];
        for (const assignment of assignments) {
          const creator = creatorsById.get(assignment.creatorId);
          const [previousAssignment] = await sql`
            SELECT creator_id, source_type, source_label
            FROM creative_creator_assignments
            WHERE group_key = ${assignment.groupKey}
          `;
          await sql`
            INSERT INTO creative_creator_assignments (group_key, creator_id, assigned_by)
            VALUES (${assignment.groupKey}, ${assignment.creatorId}, ${appAccess.userId})
            ON CONFLICT (group_key) DO UPDATE SET
              creator_id = EXCLUDED.creator_id,
              assigned_by = EXCLUDED.assigned_by,
              updated_at = now()
          `;
          await sql`
            UPDATE creative_assets
            SET creator_id = ${assignment.creatorId},
                creator = ${creator.name},
                source_type = 'external_creator',
                source_label = ${creator.name},
                updated_at = now()
            WHERE group_key = ${assignment.groupKey}
          `;
          await sql`
            UPDATE launch_history launch
            SET creator_id = ${assignment.creatorId},
                creator = ${creator.name},
                source_type = 'external_creator',
                source_label = ${creator.name}
            WHERE launch.ad_id IN (
              SELECT ad_id FROM creative_performance WHERE group_key = ${assignment.groupKey}
            )
          `;
          completed.push({
            groupKey: assignment.groupKey,
            creatorId: assignment.creatorId,
            creatorName: creator.name,
          });
          await logCreativeOperatorEvent(sql, {
            eventType: 'creator_assigned_batch',
            groupKey: assignment.groupKey,
            creatorId: assignment.creatorId,
            creatorName: creator.name,
            sourceType: 'external_creator',
            sourceLabel: creator.name,
            userId: appAccess.userId,
            userEmail: appAccess.email,
            metadata: {
              batch_size: assignments.length,
              previous_assignment: previousAssignment || null,
            },
          });
        }
        for (const creatorId of creatorIds) {
          const count = completed.filter(item => item.creatorId === creatorId).length;
          await sql`
            INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
            VALUES (
              ${creatorId}, 'creative_performance_linked',
              ${`${count} creative analytics group${count === 1 ? '' : 's'} attributed`},
              ${JSON.stringify({ group_keys: completed.filter(item => item.creatorId === creatorId).map(item => item.groupKey) })}::jsonb,
              ${appAccess.userId}
            )
          `;
        }
        return res.json({ assignments: completed });
      }

      case 'get_creative_operator_audit': {
        const sql = appAccess.sql;
        await ensureCreativeAuditTables(sql);
        const limit = Math.max(1, Math.min(50, parseInt(req.body.limit || 12, 10)));
        const events = await sql`
          SELECT id, event_type, group_key, group_name, creator_id, creator_name,
                 source_type, source_label, metadata, user_id, user_email, created_at
          FROM creative_operator_events
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
        return res.json({ events });
      }

      case 'update_creative_evidence_task': {
        const groupKey = (req.body.groupKey || '').toString().trim();
        const taskType = normalizeEvidenceTaskType(req.body.taskType);
        if (!groupKey || !taskType) return res.status(400).json({ error: 'groupKey and valid taskType required' });
        const row = await upsertCreativeEvidenceTask(appAccess.sql, {
          groupKey,
          taskType,
          status: req.body.status,
          owner: (req.body.owner || '').toString().trim() || null,
          note: (req.body.note || '').toString().trim() || null,
          dueDate: (req.body.dueDate || '').toString().trim() || null,
          groupName: (req.body.groupName || '').toString().trim() || null,
          spend: req.body.spend == null ? null : Number(req.body.spend),
          userId: appAccess.userId,
          userEmail: appAccess.email,
        });
        await logCreativeOperatorEvent(appAccess.sql, {
          eventType: 'evidence_task_updated',
          groupKey,
          groupName: row.group_name,
          sourceType: taskType,
          sourceLabel: row.status,
          userId: appAccess.userId,
          userEmail: appAccess.email,
          metadata: {
            task_type: taskType,
            status: row.status,
            owner: row.owner || null,
            due_date: row.due_date || null,
          },
        });
        return res.json({ task: row });
      }

      case 'get_creative_group_ads': {
        if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not configured' });
        const groupKey = req.body.groupKey;
        if (!groupKey) return res.status(400).json({ error: 'groupKey required' });
        const { neon } = await import('@neondatabase/serverless');
        const sql = neon(process.env.DATABASE_URL);

        const sinceDays = Math.max(1, Math.min(365, parseInt(req.body.sinceDays || 14, 10)));
        const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const tsNow = new Date();
        const tsSince = new Date(tsNow.getTime() - sinceDays * 24 * 60 * 60 * 1000);

        const ads = await sql`
          SELECT
            cp.ad_id, cp.ad_name, cp.thumbnail_url, cp.created_time, cp.status,
            COALESCE(SUM(i.spend), 0)::float          AS spend,
            COALESCE(SUM(i.purchase_value), 0)::float AS purchase_value,
            COALESCE(SUM(i.purchases), 0)::bigint     AS purchases,
            COALESCE(SUM(i.impressions), 0)::bigint   AS impressions,
            COALESCE(SUM(i.clicks), 0)::bigint        AS clicks
          FROM creative_performance cp
          LEFT JOIN creative_insights_daily i
            ON i.ad_id = cp.ad_id AND i.date BETWEEN ${fmtYmd(tsSince)} AND ${fmtYmd(tsNow)}
          WHERE cp.group_key = ${groupKey}
          GROUP BY cp.ad_id, cp.ad_name, cp.thumbnail_url, cp.created_time, cp.status
          ORDER BY spend DESC
        `;

        return res.json({ ads });
      }

      case 'analyze_creative_group': {
        const manualTranscript = (req.body.manualTranscript || '').trim();
        const out = await analyzeCreativeGroup({
          groupKey: req.body.groupKey,
          assetId: req.body.assetId || null,
          manualTranscript,
          ctx: { BASE, accessToken, adAccountId },
        });
        if (manualTranscript && out.status >= 200 && out.status < 300 && !out.body?.error) {
          await logCreativeOperatorEvent(appAccess.sql, {
            eventType: 'manual_transcript_analyzed',
            groupKey: req.body.groupKey,
            sourceType: 'transcript',
            sourceLabel: 'Manual script',
            userId: appAccess.userId,
            userEmail: appAccess.email,
            metadata: {
              transcript_chars: manualTranscript.length,
              asset_id: req.body.assetId || null,
              confidence: out.body?.analysis?.confidence ?? null,
            },
          });
        }
        return res.status(out.status).json(out.body);
      }

      case 'get_creative_analysis': {
        const out = await getCreativeAnalysis({ groupKey: req.body.groupKey });
        return res.status(out.status).json(out.body);
      }

      case 'list_analyzed_winners': {
        const out = await listAnalyzedWinners({ sinceDays: req.body.sinceDays });
        return res.status(out.status).json(out.body);
      }

      case 'dismiss_analyzed_winner': {
        const out = await dismissAnalyzedWinner({ groupKey: req.body.groupKey });
        return res.status(out.status).json(out.body);
      }

      case 'get_creative_analysis_queue': {
        const out = await getCreativeAnalysisQueue();
        return res.status(out.status).json(out.body);
      }

      case 'process_creative_analysis_queue': {
        const out = await processCreativeAnalysisQueue({
          ctx: { BASE, accessToken, adAccountId },
          batchSize: req.body.batchSize,
        });
        return res.status(out.status).json(out.body);
      }

      case 'retry_creative_analysis_queue': {
        const out = await retryCreativeAnalysisQueue();
        return res.status(out.status).json(out.body);
      }

      case 'normalize_creative_asset': {
        const out = await normalizeCreativeAsset({
          groupKey: req.body.groupKey,
          assetId: req.body.assetId || null,
          ctx: { BASE, accessToken, adAccountId },
        });
        return res.status(out.status).json(out.body);
      }

      case 'normalize_creative_asset_batch': {
        const out = await normalizeCreativeAssetBatch({
          ctx: { BASE, accessToken, adAccountId },
          limit: req.body.limit,
        });
        return res.status(out.status).json(out.body);
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Meta API error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}
