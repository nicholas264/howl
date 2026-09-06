import { fetchPublicText } from './_lib/safe-fetch.js';
import { requirePermission } from './_lib/app-access.js';
import {
  ensureContentStudioTables,
  extractSitemapUrls,
  parseImportItems,
  rebuildSourceChunks,
  scrapeUrlToSource,
  classifySiteUrl,
  sourceTypeForUrl,
  sourcePayload,
  stripHtml,
} from './_lib/content-studio.js';

const KLAVIYO_API_ROOT = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2026-04-15';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  await ensureContentStudioTables(sql);

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          s.id, s.title, s.source_type, s.body, s.url, s.tags, s.created_at, s.updated_at,
          COUNT(c.id)::int AS chunk_count
        FROM content_sources s
        LEFT JOIN content_source_chunks c ON c.source_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC, s.created_at DESC
        LIMIT 500
      `;
      return res.json({ rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const action = req.body?.action || 'add';
    if (action === 'add') {
      const payload = sourcePayload(req.body);
      if (!payload.title || !payload.body) return res.status(400).json({ error: 'title and body required' });
      const [row] = await sql`
        INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
        VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url || null}, ${payload.tags}, ${access.userId})
        RETURNING *
      `;
      const chunkCount = await rebuildSourceChunks(sql, row);
      return res.json({ row: { ...row, chunk_count: chunkCount } });
    }

    if (action === 'bulk_import') {
      const items = parseImportItems(req.body);
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
      const rows = [];
      for (const item of items.slice(0, 100)) {
        const payload = sourcePayload(item);
        if (!payload.title || !payload.body) continue;
        const [row] = await sql`
          INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
          VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url || null}, ${payload.tags}, ${access.userId})
          RETURNING *
        `;
        const chunkCount = await rebuildSourceChunks(sql, row);
        rows.push({ ...row, chunk_count: chunkCount });
      }
      return res.json({ inserted: rows.length, rows });
    }

    if (action === 'scrape_url') {
      const url = req.body?.url;
      const requestedType = req.body?.source_type || req.body?.sourceType;
      const payload = await scrapeUrlToSource(req.body?.url, {
        sourceType: requestedType && requestedType !== 'auto' ? requestedType : sourceTypeForUrl(url),
        tags: req.body?.tags,
      });
      const row = await insertSource(sql, payload, access.userId);
      return res.json({ row });
    }

    if (action === 'scrape_sitemap') {
      const sitemapUrl = req.body?.url || req.body?.sitemapUrl;
      const limit = Math.min(Math.max(Number(req.body?.limit) || 10, 1), 75);
      const urls = await collectSitemapPageUrls(sitemapUrl, limit);
      const rows = [];
      const errors = [];
      for (const url of urls) {
        try {
          const payload = await scrapeUrlToSource(url, {
            sourceType: sourceTypeForUrl(url),
            tags: req.body?.tags || ['website'],
          });
          rows.push(await insertSource(sql, payload, access.userId));
        } catch (err) {
          errors.push({ url, error: err.message });
        }
      }
      return res.json({ inserted: rows.length, rows, errors, scanned: urls.length });
    }

    if (action === 'klaviyo_import') {
      const out = await importKlaviyoSources(sql, access.userId, {
        limit: Math.min(Math.max(Number(req.body?.limit) || 12, 1), 50),
      });
      return res.json(out);
    }

    if (action === 'delete') {
      const id = Number(req.body?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM content_sources WHERE id = ${id}`;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchSitemapXml(url) {
  return (await fetchPublicText(url)).text;
}

async function collectSitemapPageUrls(sitemapUrl, limit) {
  const rootXml = await fetchSitemapXml(sitemapUrl);
  const directUrls = extractSitemapUrls(rootXml, limit, { includeSitemaps: false, includePages: true });
  if (directUrls.length) return uniqueUrls(directUrls).slice(0, limit);

  const childSitemaps = extractSitemapUrls(rootXml, 12, { includeSitemaps: true, includePages: false })
    .filter(url => /sitemap_(blogs?|pages?|products?|collections?)|blogs?_sitemap|pages?_sitemap|products?_sitemap|collections?_sitemap/i.test(url));
  const urls = [];
  for (const childUrl of childSitemaps) {
    if (urls.length >= limit) break;
    try {
      const childXml = await fetchSitemapXml(childUrl);
      urls.push(...extractSitemapUrls(childXml, limit - urls.length, { includeSitemaps: false, includePages: true }));
    } catch {}
  }
  return uniqueUrls(urls).slice(0, limit);
}

function uniqueUrls(urls) {
  return [...new Set((urls || []).map(url => url.trim()).filter(Boolean))];
}

async function insertSource(sql, payload, userId) {
  if (!payload.title || !payload.body) throw new Error('title and body required');
  if (payload.url) {
    const [existing] = await sql`SELECT id FROM content_sources WHERE url = ${payload.url} LIMIT 1`;
    if (existing) {
      const [row] = await sql`
        UPDATE content_sources
        SET title = ${payload.title},
            source_type = ${payload.source_type},
            body = ${payload.body},
            tags = ${payload.tags},
            updated_at = now()
        WHERE id = ${existing.id}
        RETURNING *
      `;
      const chunkCount = await rebuildSourceChunks(sql, row);
      await upsertInternalLink(sql, row);
      return { ...row, chunk_count: chunkCount, updated_existing: true };
    }
  }
  const [row] = await sql`
    INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
    VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url || null}, ${payload.tags}, ${userId})
    RETURNING *
  `;
  const chunkCount = await rebuildSourceChunks(sql, row);
  await upsertInternalLink(sql, row);
  return { ...row, chunk_count: chunkCount };
}

async function upsertInternalLink(sql, source) {
  if (!source?.url || !/^https?:\/\//i.test(source.url)) return;
  if (!['blog', 'landing_page'].includes(source.source_type)) return;
  await sql`
    INSERT INTO content_site_links (url, title, kind, handle, last_seen_at)
    VALUES (
      ${source.url},
      ${source.title},
      ${classifySiteUrl(source.url)},
      ${siteHandle(source.url)},
      now()
    )
    ON CONFLICT (url) DO UPDATE
    SET title = EXCLUDED.title,
        kind = EXCLUDED.kind,
        handle = EXCLUDED.handle,
        last_seen_at = now()
  `;
}

function siteHandle(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || null; }
  catch { return null; }
}

class KlaviyoSourceClient {
  constructor(apiKey, revision) {
    this.apiKey = apiKey;
    this.revision = revision || KLAVIYO_REVISION;
  }

  async request(path) {
    const response = await fetch(`${KLAVIYO_API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision: this.revision,
      },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || text.slice(0, 300);
      throw new Error(`Klaviyo API ${response.status}: ${detail}`);
    }
    return data;
  }
}

async function importKlaviyoSources(sql, userId, { limit }) {
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) return { configured: false, inserted: 0, rows: [], errors: ['KLAVIYO_API_KEY not configured'] };
  const client = new KlaviyoSourceClient(apiKey, process.env.KLAVIYO_REVISION || KLAVIYO_REVISION);
  const campaigns = await listRecentKlaviyoCampaigns(client, limit);
  const rows = [];
  const errors = [];
  let scannedMessages = 0;
  for (const campaign of campaigns) {
    try {
      const messages = await loadKlaviyoCampaignMessages(client, campaign.id);
      scannedMessages += messages.length;
      for (const message of messages) {
        const payload = klaviyoMessageToSource(campaign, message);
        if (!payload) {
          const name = campaign.attributes?.name || campaign.id;
          errors.push(`${name}: no usable email body content found`);
          continue;
        }
        rows.push(await insertSource(sql, payload, userId));
      }
    } catch (err) {
      errors.push(`${campaign.attributes?.name || campaign.id}: ${err.message}`);
    }
  }
  return { configured: true, inserted: rows.length, rows, errors, scanned: campaigns.length, scanned_messages: scannedMessages };
}

async function listRecentKlaviyoCampaigns(client, limit) {
  const campaigns = [];
  const emailCampaignFilter = encodeURIComponent("equals(messages.channel,'email')");
  let path = `/campaigns?filter=${emailCampaignFilter}&sort=-created_at&page[size]=20`;
  for (let i = 0; i < 5 && path && campaigns.length < limit; i += 1) {
    const data = await client.request(path);
    campaigns.push(...(data?.data || []));
    const next = data?.links?.next;
    path = next ? next.replace(KLAVIYO_API_ROOT, '') : '';
  }
  return campaigns.slice(0, limit);
}

async function loadKlaviyoCampaignMessages(client, campaignId) {
  const candidates = [
    `/campaigns/${campaignId}/campaign-messages`,
    `/campaigns/${campaignId}/relationships/campaign-messages`,
  ];
  for (const path of candidates) {
    try {
      const data = await client.request(path);
      const messages = data?.data || [];
      if (!messages.length) return [];
      return Promise.all(messages.map(message => hydrateKlaviyoMessage(client, message)));
    } catch {}
  }
  return [];
}

async function hydrateKlaviyoMessage(client, message) {
  const messageId = [
    message.id,
    message?.relationships?.campaign_message?.data?.id,
    message?.relationships?.message?.data?.id,
  ].find(Boolean);
  let detail = message;
  let template = null;

  if (messageId) {
    try {
      const data = await client.request(`/campaign-messages/${messageId}`);
      detail = data?.data || message;
    } catch {}
  }

  const templateId = detail?.relationships?.template?.data?.id || message?.relationships?.template?.data?.id;

  if (messageId) {
    try {
      const data = await client.request(`/campaign-messages/${messageId}/template`);
      template = data?.data || null;
    } catch {}
  }

  if (!template && templateId) {
    try {
      const data = await client.request(`/templates/${templateId}`);
      template = data?.data || null;
    } catch {}
  }

  return { ...message, detail, template };
}

function klaviyoMessageToSource(campaign, message) {
  const campaignAttrs = campaign.attributes || {};
  const detailAttrs = message.detail?.attributes || message.attributes || {};
  const templateAttrs = message.template?.attributes || {};
  const content = detailAttrs.definition?.content || {};
  const subject = content.subject || detailAttrs.subject || detailAttrs.label || campaignAttrs.name || 'Klaviyo email';
  const preview = content.preview_text || content.previewText || detailAttrs.preview_text || detailAttrs.previewText || '';
  const templateDefinitionText = collectStrings(templateAttrs.definition).join('\n\n');
  const templateBody = templateAttrs.text || templateAttrs.html || templateDefinitionText;
  const fallbackStrings = collectStrings({ detailAttrs, templateAttrs }).filter(Boolean).sort((a, b) => b.length - a.length);
  const body = stripHtml([subject, preview, templateBody || fallbackStrings[0]].filter(Boolean).join('\n\n'));
  if (body.length < 120) return null;
  return sourcePayload({
    title: `${campaignAttrs.name || subject}`,
    source_type: 'email',
    body,
    url: campaign.id ? `klaviyo://campaign/${campaign.id}/message/${message.id || 'primary'}` : '',
    tags: ['klaviyo', 'email', campaignAttrs.status || '', campaignAttrs.channel || ''].filter(Boolean),
  });
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, out));
  }
  return out;
}
