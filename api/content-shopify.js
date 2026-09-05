import { hasPermission, requirePermission } from './_lib/app-access.js';
import {
  cleanText,
  classifySiteUrl,
  ensureContentStudioTables,
  markdownToHtml,
  parseSitemapEntries,
  parseSitemapIndex,
  rebuildSourceChunks,
  resolveInternalLinks,
  scrapeUrlToSource,
  stripEmDashes,
} from './_lib/content-studio.js';
import {
  createShopifyArticle,
  fetchShopifyArticles,
  getAccessScopes,
  getPrimaryDomain,
  listShopifyBlogs,
  loadSiteLinks,
  shopifyArticleToSource,
  shopifyContentConfig,
  siteLinkStatus,
  syncSiteLinks,
} from './_lib/shopify-content.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'briefs.read' : 'briefs.write');
  if (!access) return;
  const { sql } = access;
  await ensureContentStudioTables(sql);

  try {
    if (req.method === 'GET') {
      const { configured, store } = shopifyContentConfig();
      const links = await siteLinkStatus(sql);
      if (!configured) return res.json({ configured: false, store, blogs: [], links });
      let blogs = [];
      let blogError = null;
      try {
        blogs = await listShopifyBlogs();
      } catch (err) {
        blogError = err.message;
      }
      const scopes = await getAccessScopes();
      const canPublish = scopes.some(scope => ['write_content', 'write_online_store_pages'].includes(scope));
      // Named blog_error, not error: the client treats a top-level `error`
      // field as a failed request and would discard the rest of the status.
      return res.json({ configured: true, store, blogs, links, blog_error: blogError, can_publish: canPublish });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const action = cleanText(req.body?.action, 40);

    if (action === 'sync_links') {
      const result = await syncSiteLinks(sql);
      const links = await siteLinkStatus(sql);
      return res.json({ ...result, links });
    }

    if (action === 'import_articles') {
      const { configured } = shopifyContentConfig();
      const domain = await getPrimaryDomain();
      const requestedBlogId = cleanText(req.body?.blogId || req.body?.blog_id, 120);
      if (configured) {
        try {
          const blogs = requestedBlogId
            ? [{ id: requestedBlogId }]
            : await listShopifyBlogs();
          let inserted = 0;
          let updated = 0;
          let scanned = 0;
          const errors = [];
          for (const blog of blogs) {
            try {
              const articles = await fetchShopifyArticles(blog.id);
              scanned += articles.length;
              for (const article of articles) {
                const payload = shopifyArticleToSource(article, domain);
                if (!payload) continue;
                const row = await upsertSourceByUrl(sql, payload, access.userId);
                if (row.updated_existing) updated += 1;
                else inserted += 1;
              }
            } catch (err) {
              errors.push(`${blog.title || blog.id}: ${err.message}`);
            }
          }
          return res.json({ inserted, updated, scanned, errors, source: 'shopify_admin' });
        } catch (err) {
          const fallback = await importPublishedBlogsFromSitemap(sql, access.userId, domain);
          return res.json({
            ...fallback,
            source: 'public_sitemap',
            warning: `Shopify Admin blog import failed, so Blog Studio used the public sitemap instead. ${err.message}`,
          });
        }
      }
      const fallback = await importPublishedBlogsFromSitemap(sql, access.userId, domain);
      return res.json({
        ...fallback,
        source: 'public_sitemap',
        warning: 'SHOPIFY_ACCESS_TOKEN not configured, so Blog Studio used the public sitemap instead.',
      });
    }

    if (action === 'publish') {
      const { configured } = shopifyContentConfig();
      if (!configured) return res.status(400).json({ error: 'SHOPIFY_ACCESS_TOKEN not configured' });
      const projectId = Number(req.body?.projectId || req.body?.project_id);
      const blogId = cleanText(req.body?.blogId || req.body?.blog_id, 120);
      const markdown = cleanText(req.body?.bodyMarkdown || req.body?.body_markdown, 200000);
      if (!blogId) return res.status(400).json({ error: 'blogId required' });
      if (!markdown) return res.status(400).json({ error: 'bodyMarkdown required' });
      const publishLive = req.body?.publishLive === true || req.body?.publish_live === true;
      if (publishLive && !hasPermission(access, 'content.publish')) {
        return res.status(403).json({ error: 'Forbidden - content.publish required' });
      }

      const siteLinks = await loadSiteLinks(sql);
      const linked = resolveInternalLinks(stripEmDashes(markdown), siteLinks);
      const html = markdownToHtml(linked.markdown);
      const article = await createShopifyArticle({
        blogId,
        title: cleanText(req.body?.title, 250) || 'HOWL blog draft',
        html,
        summary: cleanText(req.body?.summary || req.body?.meta_description, 500),
        slug: cleanText(req.body?.slug, 200),
        tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
        publishLive,
      });
      const domain = await getPrimaryDomain();
      const articleUrl = `${domain}/blogs/${article.blog?.handle || 'news'}/${article.handle}`;
      if (Number.isFinite(projectId)) {
        await sql`
          UPDATE content_projects
          SET shopify_blog_id = ${blogId},
              shopify_article_id = ${article.id},
              shopify_article_url = ${articleUrl},
              shopify_state = ${publishLive ? 'published' : 'draft'},
              shopify_synced_at = now(),
              updated_at = now()
          WHERE id = ${projectId}
        `;
      }
      return res.json({
        article: { ...article, url: articleUrl },
        published: publishLive,
        internal_links_resolved: linked.resolved,
        internal_links_unresolved: linked.unresolved,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function upsertSourceByUrl(sql, payload, userId) {
  const [existing] = await sql`SELECT id FROM content_sources WHERE url = ${payload.url} LIMIT 1`;
  if (existing) {
    const [row] = await sql`
      UPDATE content_sources
      SET title = ${payload.title}, source_type = ${payload.source_type},
          body = ${payload.body}, tags = ${payload.tags}, updated_at = now()
      WHERE id = ${existing.id}
      RETURNING *
    `;
    await rebuildSourceChunks(sql, row);
    await upsertSiteLink(sql, row.url, row.title);
    return { ...row, updated_existing: true };
  }
  const [row] = await sql`
    INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
    VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url}, ${payload.tags}, ${userId})
    RETURNING *
  `;
  await rebuildSourceChunks(sql, row);
  await upsertSiteLink(sql, row.url, row.title);
  return row;
}

async function importPublishedBlogsFromSitemap(sql, userId, domain) {
  const urls = await publishedBlogUrlsFromSitemap(domain);
  let inserted = 0;
  let updated = 0;
  let scanned = 0;
  const errors = [];
  for (const url of urls.slice(0, 100)) {
    try {
      scanned += 1;
      const payload = await scrapeUrlToSource(url, {
        sourceType: 'blog',
        tags: ['shopify', 'blog', 'website'],
      });
      const row = await upsertSourceByUrl(sql, payload, userId);
      if (row.updated_existing) updated += 1;
      else inserted += 1;
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  return { inserted, updated, scanned, errors };
}

async function publishedBlogUrlsFromSitemap(domain) {
  const fetchXml = async (url) => {
    const response = await fetch(url, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': 'HOWL Blog Studio/1.0' },
    });
    if (!response.ok) throw new Error(`Could not fetch ${url} (${response.status})`);
    return response.text();
  };
  const root = await fetchXml(`${domain}/sitemap.xml`);
  const childSitemaps = parseSitemapIndex(root).filter(url => /sitemap_blogs?|blogs?_sitemap/i.test(url));
  const entries = [];
  if (childSitemaps.length) {
    for (const childUrl of childSitemaps.slice(0, 10)) {
      try {
        entries.push(...parseSitemapEntries(await fetchXml(childUrl)));
      } catch {}
    }
  } else {
    entries.push(...parseSitemapEntries(root));
  }
  return [...new Set(entries
    .filter(entry => entry.kind === 'blog' && /\/blogs?\//i.test(entry.url))
    .map(entry => entry.url))];
}

async function upsertSiteLink(sql, url, title) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  let handle = null;
  try { handle = new URL(url).pathname.split('/').filter(Boolean).pop() || null; } catch {}
  await sql`
    INSERT INTO content_site_links (url, title, kind, handle, last_seen_at)
    VALUES (${url}, ${title || handle || url}, ${classifySiteUrl(url)}, ${handle}, now())
    ON CONFLICT (url) DO UPDATE
    SET title = EXCLUDED.title,
        kind = EXCLUDED.kind,
        handle = EXCLUDED.handle,
        last_seen_at = now()
  `;
}
