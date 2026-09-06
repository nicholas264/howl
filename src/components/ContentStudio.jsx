import { apiFetch as fetch } from '../lib/apiFetch.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const EMPTY_BRIEF = {
  id: null,
  title: '',
  topic: '',
  target_query: '',
  audience: 'Prospective HOWL customers researching propane fire pits and outdoor fire options',
  product: '',
  search_intent: 'Informational with commercial evaluation',
  desired_cta: 'Shop HOWL Campfires or compare models',
  must_include: '',
  avoid: 'Unsupported specs, fake testimonials, generic lifestyle filler',
  selected_source_ids: [],
  status: 'draft',
};

const SOURCE_TYPES = [
  ['email', 'Email'],
  ['blog', 'Blog'],
  ['landing_page', 'Landing page'],
  ['other', 'Other'],
];

function normalizeProject(row) {
  return {
    ...EMPTY_BRIEF,
    ...(row || {}),
    selected_source_ids: Array.isArray(row?.selected_source_ids) ? row.selected_source_ids.map(Number) : [],
  };
}

async function apiJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(errorMessage(data.error) || `Request failed (${response.status})`);
  return data;
}

function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  if (typeof error.detail === 'string') return error.detail;
  if (typeof error.title === 'string') return error.title;
  try { return JSON.stringify(error); }
  catch { return String(error); }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sourceLabel(source) {
  return `${source.title || 'Untitled'} · ${source.source_type || 'other'}`;
}

export default function ContentStudio({ canPublish = false }) {
  const [projects, setProjects] = useState([]);
  const [sources, setSources] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [sourceForm, setSourceForm] = useState({ title: '', source_type: 'blog', url: '', tags: '', body: '' });
  const [importText, setImportText] = useState('');
  const [webImport, setWebImport] = useState({ url: '', sitemapUrl: 'https://howlcampfires.com/sitemap.xml', tags: 'website,shopify', limit: 50 });
  const [klaviyoLimit, setKlaviyoLimit] = useState(12);
  const [outline, setOutline] = useState('');
  const [draft, setDraft] = useState('');
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackForm, setFeedbackForm] = useState({ applies_to: 'voice', rating: 'approved', note: '' });
  const [metadata, setMetadata] = useState({});
  const [sourceInfluence, setSourceInfluence] = useState([]);
  const [guardrailViolations, setGuardrailViolations] = useState([]);
  const [seoAeo, setSeoAeo] = useState(null);
  const [shopify, setShopify] = useState({ configured: false, blogs: [], links: { count: 0, last_synced_at: null } });
  const [publishBlogId, setPublishBlogId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activePanel, setActivePanel] = useState('brief');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedIds = useMemo(
    () => new Set((brief.selected_source_ids || []).map(Number)),
    [brief.selected_source_ids],
  );
  const selectedSources = useMemo(
    () => sources.filter(source => selectedIds.has(Number(source.id))),
    [sources, selectedIds],
  );
  const referenceSources = useMemo(
    () => sources.filter(source => ['email', 'blog', 'landing_page'].includes(source.source_type || '')),
    [sources],
  );
  const latestDraft = drafts.find(item => item.kind === 'draft');

  const refreshSources = useCallback(async () => {
    const data = await apiJson('/api/content-sources');
    setSources(data.rows || []);
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await apiJson('/api/content-projects');
    setProjects(data.rows || []);
  }, []);

  const refreshShopify = useCallback(async () => {
    try {
      const data = await apiJson('/api/content-shopify');
      setShopify(data);
      setPublishBlogId(current => current || data.blogs?.[0]?.id || '');
    } catch {
      setShopify(current => ({ ...current, configured: false }));
    }
  }, []);

  const loadProject = useCallback(async (id) => {
    if (!id) {
      setBrief(EMPTY_BRIEF);
      setDrafts([]);
      setOutline('');
      setDraft('');
      setMetadata({});
      setSourceInfluence([]);
      setGuardrailViolations([]);
      setSeoAeo(null);
      setFeedbackItems([]);
      setFeedbackForm({ applies_to: 'voice', rating: 'approved', note: '' });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiJson(`/api/content-projects?id=${encodeURIComponent(id)}`);
      setBrief(normalizeProject(data.project));
      setDrafts(data.drafts || []);
      const newestOutline = (data.drafts || []).find(item => item.kind === 'outline');
      const newestDraft = (data.drafts || []).find(item => item.kind === 'draft');
      setOutline(newestOutline?.body_markdown || '');
      setDraft(newestDraft?.body_markdown || '');
      setMetadata(newestDraft?.metadata || newestOutline?.metadata || {});
      setSourceInfluence(newestDraft?.source_influence || newestOutline?.source_influence || []);
      setGuardrailViolations(newestDraft?.guardrail_violations || []);
      setSeoAeo(newestDraft?.metadata?.seo_aeo || newestOutline?.metadata?.seo_aeo || null);
      setFeedbackItems(data.feedback || []);
      setFeedbackForm({ applies_to: 'voice', rating: 'approved', note: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([refreshSources(), refreshProjects()]).then(([sourceResult, projectResult]) => {
      if (sourceResult.status === 'rejected') setError(sourceResult.reason.message);
      if (projectResult.status === 'rejected') setError(projectResult.reason.message);
    });
    refreshShopify();
  }, [refreshProjects, refreshShopify, refreshSources]);

  const updateBrief = (key, value) => {
    setBrief(current => ({ ...current, [key]: value }));
  };

  const saveProject = async (nextBrief = brief) => {
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...nextBrief, selected_source_ids: nextBrief.selected_source_ids }),
      });
      setBrief(normalizeProject(data.project));
      await refreshProjects();
      setMessage('Project saved.');
      return data.project;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const addSource = async () => {
    setSaving(true);
    setError('');
    try {
      await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          ...sourceForm,
          tags: sourceForm.tags,
        }),
      });
      setSourceForm({ title: '', source_type: 'blog', url: '', tags: '', body: '' });
      await refreshSources();
      setMessage('Source imported.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const bulkImport = async () => {
    if (!importText.trim()) return;
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_import', importText }),
      });
      setImportText('');
      await refreshSources();
      setMessage(`${data.inserted || 0} sources imported.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const scrapeUrl = async () => {
    if (!webImport.url.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scrape_url', url: webImport.url, tags: webImport.tags, source_type: 'auto' }),
      });
      setWebImport(current => ({ ...current, url: '' }));
      await refreshSources();
      await refreshShopify();
      setMessage('Website page imported.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const scrapeSitemap = async () => {
    if (!webImport.sitemapUrl.trim()) return;
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scrape_sitemap',
          url: webImport.sitemapUrl,
          tags: webImport.tags,
          limit: webImport.limit,
        }),
      });
      await refreshSources();
      await refreshShopify();
      setMessage(`${data.inserted || 0} website page${data.inserted === 1 ? '' : 's'} imported and added to internal linking${data.errors?.length ? `; ${data.errors.length} skipped.` : '.'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const importKlaviyo = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'klaviyo_import', limit: klaviyoLimit }),
      });
      await refreshSources();
      if (data.configured === false) {
        setError((data.errors || [])[0] || 'Klaviyo is not configured.');
      } else if (!data.inserted) {
        const detail = (data.errors || [])[0] || `${data.scanned_messages || 0} email messages scanned across ${data.scanned || 0} campaigns.`;
        setError(`No Klaviyo emails imported. ${detail}`);
      } else {
        setMessage(`${data.inserted || 0} Klaviyo email${data.inserted === 1 ? '' : 's'} imported${data.errors?.length ? `; ${data.errors.length} skipped.` : '.'}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSource = async (id) => {
    setError('');
    try {
      await apiJson('/api/content-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      setBrief(current => ({
        ...current,
        selected_source_ids: current.selected_source_ids.filter(sourceId => Number(sourceId) !== Number(id)),
      }));
      await refreshSources();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleSource = (id) => {
    setBrief(current => {
      const numeric = Number(id);
      const currentIds = new Set((current.selected_source_ids || []).map(Number));
      if (currentIds.has(numeric)) currentIds.delete(numeric);
      else currentIds.add(numeric);
      return { ...current, selected_source_ids: [...currentIds] };
    });
  };

  const generate = async (action) => {
    setGenerating(action);
    setError('');
    setMessage('');
    try {
      const saved = brief.id ? await saveProject(brief) : await saveProject({ ...brief, title: brief.title || brief.topic || 'Untitled content project' });
      if (!saved) return;
      const data = await apiJson('/api/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          projectId: saved.id,
          selectedSourceIds: brief.selected_source_ids,
          outline,
          draft,
        }),
      });
      const result = data.result || {};
      if (action === 'outline') {
        setOutline(result.markdown || result.outline_markdown || '');
        setActivePanel('outline');
      } else {
        setDraft(result.markdown || '');
        setActivePanel('draft');
      }
      setMetadata({ ...result, model: data.model, provider: data.provider, fallback_reason: data.fallback_reason });
      setSourceInfluence(result.source_influence || []);
      setGuardrailViolations(result.guardrail_violations || []);
      setSeoAeo(result.seo_aeo || null);
      setMessage(result.guardrail_violations?.length ? 'Generated with guardrail issues to fix.' : 'Generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating('');
    }
  };

  const generateBlogDraft = async () => {
    setGenerating('blog');
    setError('');
    setMessage('');
    try {
      const topic = brief.topic.trim();
      if (!topic) {
        setError('Enter a blog topic first.');
        return;
      }
      const saved = brief.id
        ? await saveProject({ ...brief, title: brief.title || topic, selected_source_ids: [] })
        : await saveProject({ ...brief, title: brief.title || topic, selected_source_ids: [] });
      if (!saved) return;
      setMessage(`Researching ${referenceSources.length || sources.length} reference source${(referenceSources.length || sources.length) === 1 ? '' : 's'}...`);
      const outlineData = await apiJson('/api/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'outline',
          projectId: saved.id,
          selectedSourceIds: [],
          outline: '',
          draft: '',
        }),
      });
      const outlineResult = outlineData.result || {};
      const nextOutline = outlineResult.markdown || outlineResult.outline_markdown || '';
      setOutline(nextOutline);
      setSourceInfluence(outlineResult.source_influence || []);
      setGuardrailViolations(outlineResult.guardrail_violations || []);
      setMessage('Outline built. Writing the draft...');
      const draftData = await apiJson('/api/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          projectId: saved.id,
          selectedSourceIds: [],
          outline: nextOutline,
          draft: '',
        }),
      });
      const draftResult = draftData.result || {};
      setDraft(draftResult.markdown || '');
      setMetadata({ ...draftResult, model: draftData.model, provider: draftData.provider, fallback_reason: draftData.fallback_reason });
      setSourceInfluence(draftResult.source_influence || outlineResult.source_influence || []);
      setGuardrailViolations(draftResult.guardrail_violations || []);
      setSeoAeo(draftResult.seo_aeo || null);
      setMessage(draftResult.guardrail_violations?.length ? 'Draft generated with guardrail issues to fix.' : 'Draft generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating('');
    }
  };

  const runChecks = async () => {
    setGenerating('export');
    setError('');
    try {
      const data = await apiJson('/api/content-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export', projectId: brief.id, bodyMarkdown: draft }),
      });
      setGuardrailViolations(data.guardrailViolations || []);
      setSeoAeo(data.seoAeo || null);
      setMessage(data.guardrailViolations?.length ? 'Guardrail issues found.' : 'Checks passed.');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setGenerating('');
    }
  };

  const saveVersion = async (kind) => {
    const bodyMarkdown = kind === 'outline' ? outline : draft;
    if (!brief.id || !bodyMarkdown.trim()) return;
    const checked = kind === 'draft' ? await runChecks() : { guardrailViolations: [] };
    if (checked?.guardrailViolations?.length) return;
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_draft',
          projectId: brief.id,
          kind,
          title: metadata.title || brief.title,
          bodyMarkdown,
          metadata,
          sourceInfluence,
          guardrail_violations: guardrailViolations,
          model: metadata.model,
        }),
      });
      setDrafts(current => [data.draft, ...current]);
      setMessage(`${kind === 'outline' ? 'Outline' : 'Draft'} version saved.`);
      await refreshProjects();
      return data.draft;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveFeedback = async (draftId = latestDraft?.id) => {
    const note = feedbackForm.note.trim();
    if (!note) return null;
    const saved = brief.id ? brief : await saveProject({ ...brief, title: brief.title || brief.topic || 'Untitled content project' });
    if (!saved?.id && !brief.id) return null;
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_feedback',
          projectId: saved.id || brief.id,
          draftId,
          applies_to: feedbackForm.applies_to,
          rating: feedbackForm.rating,
          note,
        }),
      });
      setFeedbackItems(current => [data.feedback, ...current]);
      setFeedbackForm(current => ({ ...current, note: '' }));
      setMessage('Feedback saved for future runs.');
      return data.feedback;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const sendToShopify = async ({ publishLive = false } = {}) => {
    if (!draft.trim()) return;
    if (!publishBlogId) {
      setError('Pick a Shopify blog first.');
      return;
    }
    setGenerating(publishLive ? 'publish-live' : 'publish-draft');
    setError('');
    try {
      const saved = brief.id ? brief : await saveProject({ ...brief, title: brief.title || brief.topic || 'Untitled content project' });
      if (!saved) return null;
      const data = await apiJson('/api/content-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          projectId: saved.id || brief.id,
          blogId: publishBlogId,
          bodyMarkdown: draft,
          title: metadata.title || brief.title || brief.topic,
          summary: metadata.meta_description || '',
          slug: metadata.slug || '',
          tags: brief.product ? [brief.product] : [],
          publishLive,
        }),
      });
      setBrief(current => ({
        ...current,
        shopify_article_id: data.article?.id,
        shopify_article_url: data.article?.url,
        shopify_state: publishLive ? 'published' : 'draft',
      }));
      const linkNote = data.internal_links_unresolved?.length
        ? ` ${data.internal_links_unresolved.length} internal link placeholder${data.internal_links_unresolved.length === 1 ? '' : 's'} still need a URL.`
        : '';
      setMessage(publishLive
        ? `Published live on Shopify.${linkNote}`
        : `Sent to Shopify as a hidden draft. Review it in Shopify admin, then publish live.${linkNote}`);
      await refreshProjects();
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setGenerating('');
    }
  };

  const deleteProject = async (id) => {
    setError('');
    try {
      await apiJson('/api/content-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      setConfirmDeleteId(null);
      if (Number(brief.id) === Number(id)) loadProject(null);
      await refreshProjects();
      setMessage('Draft deleted.');
    } catch (err) {
      setError(err.message);
    }
  };

  const importShopifyArticles = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_articles' }),
      });
      await refreshSources();
      await refreshShopify();
      const method = data.source === 'public_sitemap' ? ' from the public sitemap' : '';
      const warning = data.warning ? ` ${data.warning}` : '';
      setMessage(`${data.inserted || 0} new and ${data.updated || 0} updated Shopify blog article${(data.inserted || 0) + (data.updated || 0) === 1 ? '' : 's'} imported${method} into the reference library${data.errors?.length ? `; ${data.errors.length} skipped.` : '.'}${warning}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const syncSiteLinks = async () => {
    setSaving(true);
    setError('');
    try {
      const data = await apiJson('/api/content-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_links' }),
      });
      setShopify(current => ({ ...current, links: data.links || current.links }));
      setMessage(`${data.upserted || 0} site links synced from ${data.domain}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const approveDraft = async () => {
    const savedDraft = await saveVersion('draft');
    if (!savedDraft) return;
    const hadFeedback = feedbackForm.note.trim();
    if (hadFeedback) await saveFeedback(savedDraft.id);
    if (shopify.configured && shopify.can_publish && publishBlogId && !brief.shopify_article_id) {
      const sent = await sendToShopify({ publishLive: false });
      if (sent) return;
    }
    setMessage(hadFeedback ? 'Draft approved and feedback saved.' : 'Draft approved and saved.');
  };

  const exportDraft = async (format) => {
    const checked = await runChecks();
    if (!checked || checked.guardrailViolations?.length) return;
    const safeTitle = (brief.title || brief.topic || 'howl-content-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'howl-content-draft';
    if (format === 'html') downloadText(`${safeTitle}.html`, checked.html || '', 'text/html');
    else downloadText(`${safeTitle}.md`, checked.markdown || draft, 'text/markdown');
  };

  const copyDraft = async () => {
    const checked = await runChecks();
    if (!checked || checked.guardrailViolations?.length) return;
    await navigator.clipboard.writeText(checked.markdown || draft);
    setMessage('Draft copied.');
  };

  return (
    <div className="content-studio content-studio-simple workspace-page" aria-busy={loading}>
      <header className="content-simple-head">
        <div>
          <span className="workspace-kicker">Blog Studio</span>
          <h1>What do you want a blog about?</h1>
          <p>Give it the topic. HOWL researches the reference library, uses the emails and blogs for voice, then writes a draft.</p>
        </div>
        <button type="button" className="content-new-draft" onClick={() => loadProject(null)}>+ New draft</button>
      </header>

      {error && <div className="app-error">{error}</div>}
      {message && !error && <div className="content-note">{message}</div>}

      {projects.length > 0 && (
        <div className="content-drafts-shelf">
          <span className="content-drafts-eyebrow">On the desk · {projects.length}</span>
          <div className="content-drafts-rail">
            {projects.map(project => {
              const active = Number(brief.id) === Number(project.id);
              const confirming = confirmDeleteId === project.id;
              const state = project.shopify_state === 'published' ? 'live'
                : project.shopify_state === 'draft' ? 'staged'
                : project.draft_count > 0 ? 'written'
                : 'empty';
              const stateLabel = {
                live: 'Live on Shopify',
                staged: 'Staged on Shopify',
                written: `${project.draft_count} version${project.draft_count === 1 ? '' : 's'}`,
                empty: 'Not written yet',
              }[state];
              const date = new Date(project.last_draft_at || project.updated_at)
                .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              return (
                <article key={project.id} className={`${active ? 'active' : ''}${confirming ? ' confirming' : ''}`}>
                  {confirming ? (
                    <div className="content-draft-confirm">
                      <span>Delete this draft?</span>
                      <div>
                        <button type="button" className="danger" onClick={() => deleteProject(project.id)}>Delete</button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}>Keep</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="content-draft-open" onClick={() => loadProject(project.id)}>
                        <strong>{project.title || 'Untitled'}</strong>
                        <small><i className={`draft-dot ${state}`} />{stateLabel} · {date}</small>
                      </button>
                      <button type="button" className="content-draft-delete" title="Delete draft" aria-label={`Delete ${project.title || 'draft'}`} onClick={() => setConfirmDeleteId(project.id)}>&times;</button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <section className="content-command">
        <label>
          <span>Blog topic</span>
          <textarea
            rows="4"
            value={brief.topic}
            onChange={event => {
              const value = event.target.value;
              setBrief(current => ({
                ...current,
                topic: value,
                title: current.id ? current.title : value.slice(0, 120),
              }));
            }}
            placeholder="Example: Best propane fire pits for small patios"
          />
        </label>
        <div className="content-command-footer">
          <div>
            <strong>{referenceSources.length || sources.length}</strong>
            <span>reference sources ready</span>
          </div>
          <button type="button" className="primary-action" disabled={generating === 'blog' || !brief.topic.trim()} onClick={generateBlogDraft}>
            {generating === 'blog' ? 'Writing…' : 'Generate blog draft'}
          </button>
        </div>
        <details className="content-advanced">
          <summary>Optional direction</summary>
          <div className="content-form-grid">
            <label>Target query<input value={brief.target_query || ''} onChange={event => updateBrief('target_query', event.target.value)} placeholder="best propane fire pit for patio" /></label>
            <label>Product/category<input value={brief.product || ''} onChange={event => updateBrief('product', event.target.value)} placeholder="R1, R4 MKii, propane fire pits" /></label>
            <label>Audience<textarea rows="3" value={brief.audience || ''} onChange={event => updateBrief('audience', event.target.value)} /></label>
            <label>CTA<textarea rows="3" value={brief.desired_cta || ''} onChange={event => updateBrief('desired_cta', event.target.value)} /></label>
            <label>Must include<textarea rows="3" value={brief.must_include || ''} onChange={event => updateBrief('must_include', event.target.value)} /></label>
            <label>Avoid<textarea rows="3" value={brief.avoid || ''} onChange={event => updateBrief('avoid', event.target.value)} /></label>
          </div>
        </details>
      </section>

      <div className="content-simple-grid">
        <section className="content-panel content-draft-panel">
          <div className="content-panel-head">
            <div>
              <span>Draft</span>
              <h2>{metadata.title || brief.title || 'Blog draft'}</h2>
            </div>
            <div className="content-actions">
              <button type="button" disabled={generating === 'rewrite' || !draft.trim()} onClick={() => generate('rewrite')}>Rewrite</button>
              <button type="button" disabled={!draft.trim()} onClick={runChecks}>Check</button>
              <button type="button" disabled={!draft.trim() || saving || guardrailViolations.length > 0} onClick={approveDraft}>Approve</button>
            </div>
          </div>
          {metadata.meta_description && <div className="content-meta"><strong>Meta</strong><span>{metadata.meta_description}</span></div>}
          {metadata.model && (
            <div className={`content-model-note${metadata.fallback_reason ? ' fallback' : ''}`}>
              Written by {metadata.model}
              {metadata.fallback_reason ? ` (fallback: ${metadata.fallback_reason})` : ''}
            </div>
          )}
          <textarea className="content-editor draft" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Your generated blog draft will appear here." />
          <div className="content-actions content-export-actions">
            <button type="button" disabled={!draft.trim()} onClick={() => exportDraft('markdown')}>Markdown</button>
            <button type="button" disabled={!draft.trim()} onClick={() => exportDraft('html')}>HTML</button>
            <button type="button" disabled={!draft.trim()} onClick={copyDraft}>Copy</button>
          </div>
        </section>

        <aside className="content-simple-aside">
          <section>
            <span>Shopify</span>
            {shopify.configured ? (
              <div className="content-shopify">
                {shopify.blogs?.length ? (
                  shopify.can_publish ? (
                    <>
                      <select value={publishBlogId} onChange={event => setPublishBlogId(event.target.value)}>
                        {shopify.blogs.map(blog => (
                          <option key={blog.id} value={blog.id}>{blog.title}</option>
                        ))}
                      </select>
                      <div className="content-actions">
                        <button type="button" disabled={!draft.trim() || generating === 'publish-draft'} onClick={() => sendToShopify({ publishLive: false })}>
                          {generating === 'publish-draft' ? 'Sending…' : 'Send as draft'}
                        </button>
                        <button type="button" disabled={!canPublish || !draft.trim() || generating === 'publish-live'} onClick={() => sendToShopify({ publishLive: true })}>
                          {generating === 'publish-live' ? 'Publishing…' : 'Publish live'}
                        </button>
                      </div>
                    </>
                  ) : <small>Read-only access: blog imports and site links work. Add the write_content scope to publish drafts from here.</small>
                ) : <small>{shopify.blog_error || 'No blogs found on the store yet.'}</small>}
                {brief.shopify_article_url && (
                  <small>
                    {brief.shopify_state === 'published' ? 'Live: ' : 'Draft on Shopify: '}
                    <a href={brief.shopify_article_url} target="_blank" rel="noreferrer">{brief.shopify_article_url.replace(/^https?:\/\//, '')}</a>
                  </small>
                )}
                <small>
                  {shopify.links?.count || 0} internal links in inventory
                  {shopify.links?.last_synced_at ? ` · synced ${new Date(shopify.links.last_synced_at).toLocaleDateString()}` : ''}
                </small>
              </div>
            ) : <small>Add SHOPIFY_ACCESS_TOKEN (with read/write content scope) to publish blogs straight to the store.</small>}
          </section>
          <section>
            <span>SEO/AEO</span>
            {seoAeo ? (
              <div className="content-seo-score">
                <strong>{seoAeo.score}</strong>
                <small>{seoAeo.passed}/{seoAeo.total} checks · {seoAeo.word_count || 0} words</small>
                <ul>
                  {(seoAeo.checks || []).slice(0, 7).map(check => (
                    <li key={check.id} className={check.ok ? 'pass' : 'fail'}>{check.label}</li>
                  ))}
                </ul>
              </div>
            ) : <small>Generate or check a draft to score SEO/AEO structure.</small>}
          </section>
          <section>
            <span>Research used</span>
            {sourceInfluence.length ? sourceInfluence.map((item, index) => (
              <div className="content-influence" key={`${item.source_id || index}-${item.used_for || index}`}>
                <strong>{item.source_title || `Source ${item.source_id || index + 1}`}</strong>
                <small>{item.used_for || 'Reference'}</small>
              </div>
            )) : <small>The next run will use the reference emails, blogs, and landing pages automatically.</small>}
          </section>
          <section>
            <span>Guardrails</span>
            {guardrailViolations.length ? (
              <ul className="content-violations">
                {guardrailViolations.map(violation => <li key={violation}>{violation}</li>)}
              </ul>
            ) : <small>No current violations.</small>}
          </section>
          <section>
            <span>Feedback</span>
            <textarea rows="4" value={feedbackForm.note} onChange={event => setFeedbackForm(current => ({ ...current, note: event.target.value }))} placeholder="Tell it what to keep or change next time." />
            <button type="button" disabled={saving || !feedbackForm.note.trim()} onClick={() => saveFeedback()}>Save feedback</button>
          </section>
        </aside>
      </div>

      <details className="content-library">
        <summary>Reference library and imports</summary>
        <div className="content-library-inner">
          <div className="content-source-import">
            <div className="content-form-grid compact">
              <label>Title<input value={sourceForm.title} onChange={event => setSourceForm(current => ({ ...current, title: event.target.value }))} /></label>
              <label>Type<select value={sourceForm.source_type} onChange={event => setSourceForm(current => ({ ...current, source_type: event.target.value }))}>{SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>URL<input value={sourceForm.url} onChange={event => setSourceForm(current => ({ ...current, url: event.target.value }))} /></label>
              <label>Tags<input value={sourceForm.tags} onChange={event => setSourceForm(current => ({ ...current, tags: event.target.value }))} placeholder="seo, safety, r1" /></label>
              <label className="wide">Body<textarea rows="6" value={sourceForm.body} onChange={event => setSourceForm(current => ({ ...current, body: event.target.value }))} /></label>
              <button type="button" className="primary-action" disabled={saving || !sourceForm.title.trim() || !sourceForm.body.trim()} onClick={addSource}>Import source</button>
            </div>
            <div className="content-bulk">
              <label>CSV or JSON import<textarea rows="7" value={importText} onChange={event => setImportText(event.target.value)} placeholder={'title,source_type,url,tags,body\nWelcome email,email,,welcome,"Paste copy here"'} /></label>
              <button type="button" disabled={saving || !importText.trim()} onClick={bulkImport}>Bulk import</button>
            </div>
          </div>
          <div className="content-import-helpers">
            <article>
              <span>Website scraper</span>
              <label>Page URL<input value={webImport.url} onChange={event => setWebImport(current => ({ ...current, url: event.target.value }))} placeholder="https://howlcampfires.com/blogs/..." /></label>
              <label>Sitemap URL<input value={webImport.sitemapUrl} onChange={event => setWebImport(current => ({ ...current, sitemapUrl: event.target.value }))} /></label>
              <label>Tags<input value={webImport.tags} onChange={event => setWebImport(current => ({ ...current, tags: event.target.value }))} /></label>
              <label>Limit<input type="number" min="1" max="75" value={webImport.limit} onChange={event => setWebImport(current => ({ ...current, limit: event.target.value }))} /></label>
              <div>
                <button type="button" disabled={saving || !webImport.url.trim()} onClick={scrapeUrl}>Import URL</button>
                <button type="button" disabled={saving || !webImport.sitemapUrl.trim()} onClick={scrapeSitemap}>Import sitemap</button>
              </div>
            </article>
            <article>
              <span>Klaviyo</span>
              <p>Import recent email campaigns into the reference library.</p>
              <label>Campaign limit<input type="number" min="1" max="50" value={klaviyoLimit} onChange={event => setKlaviyoLimit(event.target.value)} /></label>
              <button type="button" disabled={saving} onClick={importKlaviyo}>Import emails</button>
            </article>
            <article>
              <span>Shopify</span>
              <p>Pull the store's published blog articles into the library and refresh the internal link inventory from the sitemap.</p>
              <div>
                <button type="button" disabled={saving} onClick={importShopifyArticles}>Import blog articles</button>
                <button type="button" disabled={saving} onClick={syncSiteLinks}>Sync site links</button>
              </div>
            </article>
          </div>
          <div className="content-source-list">
            {sources.map(source => (
              <article key={source.id}>
                <span>
                  <strong>{sourceLabel(source)}</strong>
                  <small>{source.tags?.join(', ') || 'No tags'} · {source.chunk_count || 0} chunks</small>
                </span>
                <button type="button" onClick={() => deleteSource(source.id)}>Delete</button>
              </article>
            ))}
            {!sources.length && <div className="workspace-empty"><strong>No references yet.</strong><p>Import emails, blog posts, landing pages, or copy notes. Future drafts will use them automatically.</p></div>}
          </div>
        </div>
      </details>

      <details className="content-library">
        <summary>Outline, feedback, and versions</summary>
        <div className="content-library-inner">
          <textarea className="content-editor outline" value={outline} onChange={event => setOutline(event.target.value)} placeholder="Generated outline appears here." />
          <div className="content-export-grid">
            <article>
              <span>Saved feedback</span>
              {feedbackItems.length ? feedbackItems.map(item => (
                <p key={item.id}>{item.note}</p>
              )) : <p>No saved feedback yet.</p>}
            </article>
            <article>
              <span>Version history</span>
              {drafts.length ? drafts.map(item => (
                <button key={item.id} type="button" onClick={() => {
                  if (item.kind === 'outline') setOutline(item.body_markdown);
                  else setDraft(item.body_markdown);
                  setMetadata(item.metadata || {});
                  setSourceInfluence(item.source_influence || []);
                  setGuardrailViolations(item.guardrail_violations || []);
                  setSeoAeo(item.metadata?.seo_aeo || null);
                }}>
                  <strong>{item.kind} v{item.version}</strong>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </button>
              )) : <p>No saved versions yet.</p>}
            </article>
          </div>
        </div>
      </details>
    </div>
  );
}
