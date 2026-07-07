import { requirePermission } from './_lib/app-access.js';
import {
  cleanText,
  ensureContentStudioTables,
  markdownToHtml,
  rebuildSourceChunks,
  resolveInternalLinks,
} from './_lib/content-studio.js';
import {
  createShopifyArticle,
  fetchShopifyArticles,
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
      return res.json({ configured: true, store, blogs, links, error: blogError });
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
      if (!configured) return res.status(400).json({ error: 'SHOPIFY_ACCESS_TOKEN not configured' });
      const domain = await getPrimaryDomain();
      const requestedBlogId = cleanText(req.body?.blogId || req.body?.blog_id, 120);
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
      return res.json({ inserted, updated, scanned, errors });
    }

    if (action === 'publish') {
      const { configured } = shopifyContentConfig();
      if (!configured) return res.status(400).json({ error: 'SHOPIFY_ACCESS_TOKEN not configured' });
      const projectId = Number(req.body?.projectId || req.body?.project_id);
      const blogId = cleanText(req.body?.blogId || req.body?.blog_id, 120);
      const markdown = cleanText(req.body?.bodyMarkdown || req.body?.body_markdown, 200000);
      if (!blogId) return res.status(400).json({ error: 'blogId required' });
      if (!markdown) return res.status(400).json({ error: 'bodyMarkdown required' });
      const publishLive = Boolean(req.body?.publishLive || req.body?.publish_live);

      const siteLinks = await loadSiteLinks(sql);
      const linked = resolveInternalLinks(markdown, siteLinks);
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
    return { ...row, updated_existing: true };
  }
  const [row] = await sql`
    INSERT INTO content_sources (title, source_type, body, url, tags, created_by)
    VALUES (${payload.title}, ${payload.source_type}, ${payload.body}, ${payload.url}, ${payload.tags}, ${userId})
    RETURNING *
  `;
  await rebuildSourceChunks(sql, row);
  return row;
}
