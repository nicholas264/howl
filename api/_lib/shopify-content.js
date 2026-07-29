import {
  cleanText,
  parseSitemapEntries,
  parseSitemapIndex,
  sourcePayload,
  stripHtml,
} from './content-studio.js';

const API_VERSION = '2026-04';
const SHOPIFY_TOKEN_TTL_SKEW_MS = 5 * 60 * 1000;

const generatedTokenCache = new Map();

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function shopifyTokenExchangeError(role, status, text, data) {
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const detail = data.error || data.error_description || stripTags(title || text).slice(0, 300) || 'empty response';
  if (role === 'dealer' && /Oauth error\s+(invalid_request|app_not_installed)|app_not_installed/i.test(detail)) {
    const error = new Error('Dealer Shopify app is not installed or has not approved this app. Reconnect dealer Shopify.');
    error.code = 'SHOPIFY_DEALER_RECONNECT_REQUIRED';
    return error;
  }
  return new Error(`Shopify token exchange failed (${status}): ${detail}`);
}

export function shopifyContentConfig(role = 'primary') {
  const isDealer = role === 'dealer';
  const store = isDealer
    ? process.env.SHOPIFY_DEALER_STORE
    : process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com';
  const token = isDealer ? process.env.SHOPIFY_DEALER_ACCESS_TOKEN : process.env.SHOPIFY_ACCESS_TOKEN;
  const clientId = isDealer
    ? process.env.SHOPIFY_DEALER_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID
    : process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = isDealer
    ? process.env.SHOPIFY_DEALER_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET
    : process.env.SHOPIFY_CLIENT_SECRET;
  return {
    role,
    store,
    token,
    clientId,
    clientSecret,
    configured: Boolean(token || (clientId && clientSecret)),
    uses_client_credentials: Boolean(clientId && clientSecret),
  };
}

export async function getShopifyAccessToken(role = 'primary') {
  const { store, token, clientId, clientSecret } = shopifyContentConfig(role);
  if (clientId && clientSecret) {
    const now = Date.now();
    const cacheKey = `${role}:${store}:${clientId}`;
    const cached = generatedTokenCache.get(cacheKey);
    if (
      cached?.token
      && cached.expiresAt > now + SHOPIFY_TOKEN_TTL_SKEW_MS
    ) {
      return cached.token;
    }
    const response = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || !data.access_token) {
      throw shopifyTokenExchangeError(role, response.status, text, data);
    }
    generatedTokenCache.set(cacheKey, {
      store,
      token: data.access_token,
      expiresAt: now + Math.max(Number(data.expires_in || 86400) * 1000, 60 * 1000),
      scope: data.scope || '',
    });
    return data.access_token;
  }
  if (token) return token;
  const prefix = role === 'dealer' ? 'SHOPIFY_DEALER' : 'SHOPIFY';
  throw new Error(`${prefix}_CLIENT_ID/${prefix}_CLIENT_SECRET or ${prefix}_ACCESS_TOKEN required`);
}

export async function shopifyGql(query, variables = {}) {
  const { store, configured } = shopifyContentConfig();
  if (!configured) throw new Error('Shopify credentials not configured');
  const token = await getShopifyAccessToken();
  const response = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (data.errors) {
    const errors = Array.isArray(data.errors) ? data.errors : [data.errors];
    const message = errors.map(err => err.message || JSON.stringify(err)).join('; ');
    if (/access denied|write_content|read_content/i.test(message)) {
      throw new Error(`Shopify token is missing the content scope (read_content/write_content). Update the app scopes, then retry. (${message})`);
    }
    throw new Error(`Shopify GraphQL error: ${message}`);
  }
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
  return data.data;
}

let primaryDomainCache = null;
let accessScopesCache = null;

export async function getAccessScopes() {
  if (accessScopesCache) return accessScopesCache;
  const { store, configured } = shopifyContentConfig();
  if (!configured) return [];
  try {
    const token = await getShopifyAccessToken();
    const response = await fetch(`https://${store}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const data = await response.json();
    const scopes = (data?.access_scopes || []).map(scope => scope.handle);
    if (scopes.length) accessScopesCache = scopes;
    return scopes;
  } catch {
    return [];
  }
}

export async function getPrimaryDomain() {
  if (primaryDomainCache) return primaryDomainCache;
  try {
    const data = await shopifyGql(`query { shop { primaryDomain { url } } }`);
    const url = data?.shop?.primaryDomain?.url;
    if (url) {
      primaryDomainCache = url.replace(/\/$/, '');
      return primaryDomainCache;
    }
  } catch {}
  return 'https://howlcampfires.com';
}

export async function listShopifyBlogs() {
  const data = await shopifyGql(`query ContentStudioBlogs {
    blogs(first: 25) { nodes { id title handle } }
  }`);
  return data?.blogs?.nodes || [];
}

export async function fetchShopifyArticles(blogId, { maxPages = 4 } = {}) {
  const articles = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const data = await shopifyGql(`query ContentStudioBlogArticles($id: ID!, $after: String) {
      blog(id: $id) {
        id title handle
        articles(first: 50, after: $after) {
          nodes { id title handle body summary tags isPublished publishedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { id: blogId, after });
    const blog = data?.blog;
    if (!blog) break;
    for (const article of blog.articles?.nodes || []) {
      articles.push({ ...article, blogHandle: blog.handle, blogTitle: blog.title });
    }
    if (!blog.articles?.pageInfo?.hasNextPage) break;
    after = blog.articles.pageInfo.endCursor;
  }
  return articles;
}

export function shopifyArticleToSource(article, domain) {
  const body = stripHtml(article.body || '');
  if (body.length < 120) return null;
  return sourcePayload({
    title: article.title || 'Shopify article',
    source_type: 'blog',
    body,
    url: `${domain}/blogs/${article.blogHandle}/${article.handle}`,
    tags: ['shopify', 'blog', ...(article.tags || [])].slice(0, 30),
  });
}

export async function createShopifyArticle({ blogId, title, html, summary, slug, tags, publishLive, authorName }) {
  const article = {
    blogId,
    title: cleanText(title, 250),
    body: html,
    isPublished: Boolean(publishLive),
    author: { name: cleanText(authorName, 100) || 'HOWL Campfires' },
  };
  if (summary) article.summary = cleanText(summary, 500);
  if (slug) article.handle = cleanText(slug, 200);
  if (Array.isArray(tags) && tags.length) article.tags = tags.slice(0, 20);
  const data = await shopifyGql(`mutation ContentStudioArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id title handle isPublished publishedAt blog { id handle } }
      userErrors { field message code }
    }
  }`, { article });
  const payload = data?.articleCreate;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(`Shopify rejected the article: ${errors.map(err => err.message).join('; ')}`);
  }
  if (!payload?.article) throw new Error('Shopify did not return the created article.');
  return payload.article;
}

// Refreshes content_site_links from the store's public sitemap so drafts can
// use real internal URLs. Safe to call often; upserts by URL.
export async function syncSiteLinks(sql, { maxChildSitemaps = 30 } = {}) {
  const domain = await getPrimaryDomain();
  const fetchXml = async (url) => {
    const response = await fetch(url, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': 'HOWL Content Studio/1.0' },
    });
    if (!response.ok) throw new Error(`Could not fetch ${url} (${response.status})`);
    return response.text();
  };
  const indexXml = await fetchXml(`${domain}/sitemap.xml`);
  let childUrls = parseSitemapIndex(indexXml);
  let entries = [];
  if (childUrls.length) {
    childUrls = childUrls
      .filter(url => /sitemap_(products?|collections?|blogs?|pages?)|products?_sitemap|collections?_sitemap|blogs?_sitemap|pages?_sitemap/i.test(url))
      .sort((a, b) => sitemapPriority(a) - sitemapPriority(b))
      .slice(0, maxChildSitemaps);
    for (const childUrl of childUrls) {
      try {
        entries.push(...parseSitemapEntries(await fetchXml(childUrl)));
      } catch {}
    }
  } else {
    entries = parseSitemapEntries(indexXml);
  }
  let upserted = 0;
  for (const entry of entries.slice(0, 800)) {
    if (!entry.title) continue;
    await sql`
      INSERT INTO content_site_links (url, title, kind, handle, last_seen_at)
      VALUES (${entry.url}, ${entry.title}, ${entry.kind}, ${entry.handle || null}, now())
      ON CONFLICT (url) DO UPDATE
      SET title = EXCLUDED.title, kind = EXCLUDED.kind, handle = EXCLUDED.handle, last_seen_at = now()
    `;
    upserted += 1;
  }
  return { domain, upserted, scanned: entries.length, sitemaps: childUrls.length || 1 };
}

function sitemapPriority(url) {
  if (/products/i.test(url)) return 0;
  if (/collections/i.test(url)) return 1;
  if (/blogs/i.test(url)) return 2;
  return 3;
}

export async function loadSiteLinks(sql, { limit = 400 } = {}) {
  return sql`
    SELECT url, title, kind, handle, last_seen_at
    FROM content_site_links
    ORDER BY last_seen_at DESC
    LIMIT ${limit}
  `;
}

export async function siteLinkStatus(sql) {
  const [row] = await sql`
    SELECT COUNT(*)::int AS count, MAX(last_seen_at) AS last_synced_at
    FROM content_site_links
  `;
  return { count: row?.count || 0, last_synced_at: row?.last_synced_at || null };
}
