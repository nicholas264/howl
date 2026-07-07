const SOURCE_TYPES = new Set(['email', 'blog', 'landing_page', 'other']);
const PROJECT_STATUSES = new Set(['draft', 'outlining', 'drafting', 'ready', 'archived']);
const MAX_SOURCE_BODY = 120000;
const MAX_CHUNK_CHARS = 2800;
const MAX_SCRAPE_BYTES = 2_000_000;

let contentTablesReady = null;

export function cleanText(value, max = 20000) {
  return (value ?? '').toString().replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function normalizeSourceType(value) {
  const type = cleanText(value, 40).toLowerCase();
  return SOURCE_TYPES.has(type) ? type : 'other';
}

export function normalizeStatus(value) {
  const status = cleanText(value, 40).toLowerCase();
  return PROJECT_STATUSES.has(status) ? status : 'draft';
}

export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : cleanText(value, 2000).split(',');
  return [...new Set(raw.map(tag => cleanText(tag, 80).toLowerCase()).filter(Boolean))].slice(0, 30);
}

export function projectPayload(body = {}) {
  return {
    title: cleanText(body.title || body.topic, 240),
    topic: cleanText(body.topic, 500),
    target_query: cleanText(body.target_query || body.targetQuery, 300),
    audience: cleanText(body.audience, 500),
    product: cleanText(body.product, 240),
    search_intent: cleanText(body.search_intent || body.searchIntent, 240),
    desired_cta: cleanText(body.desired_cta || body.desiredCta, 500),
    must_include: cleanText(body.must_include || body.mustInclude, 3000),
    avoid: cleanText(body.avoid, 3000),
    status: normalizeStatus(body.status),
  };
}

export function sourcePayload(body = {}) {
  return {
    title: cleanText(body.title, 300),
    source_type: normalizeSourceType(body.source_type || body.sourceType),
    body: cleanText(body.body, MAX_SOURCE_BODY),
    url: cleanText(body.url, 1000),
    tags: normalizeTags(body.tags),
  };
}

export async function ensureContentStudioTables(sql) {
  if (!contentTablesReady) contentTablesReady = createContentStudioTables(sql);
  try {
    await contentTablesReady;
  } catch (err) {
    contentTablesReady = null;
    throw err;
  }
}

async function createContentStudioTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS content_sources (
      id           BIGSERIAL PRIMARY KEY,
      title        TEXT NOT NULL,
      source_type  TEXT NOT NULL DEFAULT 'other',
      body         TEXT NOT NULL,
      url          TEXT,
      tags         TEXT[] NOT NULL DEFAULT '{}',
      created_by   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_sources_created ON content_sources(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_sources_type ON content_sources(source_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_sources_tags ON content_sources USING GIN(tags)`;

  await sql`
    CREATE TABLE IF NOT EXISTS content_source_chunks (
      id          BIGSERIAL PRIMARY KEY,
      source_id   BIGINT NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      body        TEXT NOT NULL,
      summary     TEXT,
      keywords    TEXT[] NOT NULL DEFAULT '{}',
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_id, chunk_index)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_source_chunks_source ON content_source_chunks(source_id, chunk_index)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_source_chunks_keywords ON content_source_chunks USING GIN(keywords)`;

  await sql`
    CREATE TABLE IF NOT EXISTS content_projects (
      id             BIGSERIAL PRIMARY KEY,
      title          TEXT NOT NULL,
      topic          TEXT,
      target_query   TEXT,
      audience       TEXT,
      product        TEXT,
      search_intent  TEXT,
      desired_cta    TEXT,
      must_include   TEXT,
      avoid          TEXT,
      status         TEXT NOT NULL DEFAULT 'draft',
      selected_source_ids BIGINT[] NOT NULL DEFAULT '{}',
      created_by     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_projects_updated ON content_projects(updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_projects_status ON content_projects(status)`;

  await sql`
    CREATE TABLE IF NOT EXISTS content_drafts (
      id              BIGSERIAL PRIMARY KEY,
      project_id      BIGINT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL DEFAULT 'draft',
      version         INTEGER NOT NULL,
      title           TEXT,
      body_markdown   TEXT NOT NULL,
      body_html       TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_influence JSONB NOT NULL DEFAULT '[]'::jsonb,
      guardrail_violations TEXT[] NOT NULL DEFAULT '{}',
      model           TEXT,
      user_id         TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, kind, version)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_drafts_project ON content_drafts(project_id, created_at DESC)`;
}

export function chunkSourceBody(body) {
  const text = cleanText(body, MAX_SOURCE_BODY);
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if ((current + '\n\n' + paragraph).length > MAX_CHUNK_CHARS && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks.slice(0, 80) : [text];
}

export function summarizeChunk(text) {
  const body = cleanText(text, MAX_CHUNK_CHARS);
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] || body.slice(0, 220);
  return firstSentence.slice(0, 500);
}

export function extractKeywords(text, tags = []) {
  const stop = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'could', 'every', 'from', 'have', 'into', 'just', 'like', 'more', 'that', 'their', 'there', 'they', 'this', 'with', 'would', 'your']);
  const counts = new Map();
  for (const word of cleanText(text, MAX_CHUNK_CHARS).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...new Set([
    ...normalizeTags(tags),
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word]) => word),
  ])].slice(0, 20);
}

export async function rebuildSourceChunks(sql, source) {
  await sql`DELETE FROM content_source_chunks WHERE source_id = ${source.id}`;
  const chunks = chunkSourceBody(source.body);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await sql`
      INSERT INTO content_source_chunks (source_id, chunk_index, body, summary, keywords, metadata)
      VALUES (
        ${source.id},
        ${index},
        ${chunk},
        ${summarizeChunk(chunk)},
        ${extractKeywords(chunk, source.tags)},
        ${JSON.stringify({ chars: chunk.length })}::jsonb
      )
    `;
  }
  return chunks.length;
}

export function selectedSourceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(Number.isFinite))].slice(0, 30);
}

export function markdownToHtml(markdown) {
  const escape = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = cleanText(markdown, 200000).split('\n');
  const html = [];
  let listOpen = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^[-*]\s+/.test(line)) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${escape(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${escape(heading[2])}</h${level}>`);
    } else {
      html.push(`<p>${escape(line)}</p>`);
    }
  }
  if (listOpen) html.push('</ul>');
  return html.join('\n');
}

export function parseModelJson(text) {
  const cleaned = cleanText(text, 300000).replace(/```json|```/gi, '').trim();
  const startObject = cleaned.indexOf('{');
  const endObject = cleaned.lastIndexOf('}');
  if (startObject < 0 || endObject < startObject) {
    throw new Error('The model did not return a JSON object.');
  }
  return JSON.parse(cleaned.slice(startObject, endObject + 1));
}

export function parseImportItems(body = {}) {
  if (Array.isArray(body.items)) return body.items;
  const text = cleanText(body.importText || body.text, 200000);
  if (!text) return [];
  if (text.trim().startsWith('[')) return JSON.parse(text);
  return parseCsv(text);
}

export function stripHtml(html) {
  return cleanText(html, 300000)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extractHtmlTitle(html, fallback = '') {
  const title = cleanText((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || [])[1], 300);
  return stripHtml(title || fallback).slice(0, 300);
}

export function extractArticleHtml(html) {
  const source = cleanText(html, MAX_SCRAPE_BYTES);
  const candidates = [
    source.match(/<article[\s\S]*?<\/article>/i)?.[0],
    source.match(/<main[\s\S]*?<\/main>/i)?.[0],
    source.match(/<body[\s\S]*?<\/body>/i)?.[0],
    source,
  ].filter(Boolean);
  return candidates.sort((a, b) => stripHtml(b).length - stripHtml(a).length)[0] || source;
}

export async function scrapeUrlToSource(url, { sourceType = 'blog', tags = [] } = {}) {
  const parsed = new URL(cleanText(url, 1200));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https URLs can be imported');
  const response = await fetch(parsed.toString(), {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'HOWL Content Studio/1.0',
    },
  });
  if (!response.ok) throw new Error(`Could not fetch ${parsed.toString()} (${response.status})`);
  const html = (await response.text()).slice(0, MAX_SCRAPE_BYTES);
  const body = stripHtml(extractArticleHtml(html));
  if (body.length < 120) throw new Error(`No substantial article text found at ${parsed.toString()}`);
  return sourcePayload({
    title: extractHtmlTitle(html, parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname),
    source_type: sourceType,
    body,
    url: parsed.toString(),
    tags,
  });
}

export function extractSitemapUrls(xml, limit = 25) {
  return [...cleanText(xml, MAX_SCRAPE_BYTES).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean)
    .filter(url => /\/(blog|blogs|journal|learn|pages)\//i.test(url))
    .slice(0, limit);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header = [], ...data] = rows.filter(r => r.some(c => cleanText(c, 100)));
  const keys = header.map(h => cleanText(h, 80).toLowerCase().replace(/\s+/g, '_'));
  return data.map(cells => Object.fromEntries(keys.map((key, index) => [key, cells[index] || ''])));
}
