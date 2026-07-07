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

export default function ContentStudio() {
  const [projects, setProjects] = useState([]);
  const [sources, setSources] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [sourceForm, setSourceForm] = useState({ title: '', source_type: 'blog', url: '', tags: '', body: '' });
  const [importText, setImportText] = useState('');
  const [webImport, setWebImport] = useState({ url: '', sitemapUrl: 'https://liveouter.com/sitemap.xml', tags: 'website,blog', limit: 10 });
  const [klaviyoLimit, setKlaviyoLimit] = useState(12);
  const [outline, setOutline] = useState('');
  const [draft, setDraft] = useState('');
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackForm, setFeedbackForm] = useState({ applies_to: 'voice', rating: 'approved', note: '' });
  const [metadata, setMetadata] = useState({});
  const [sourceInfluence, setSourceInfluence] = useState([]);
  const [guardrailViolations, setGuardrailViolations] = useState([]);
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
  const latestDraft = drafts.find(item => item.kind === 'draft');

  const refreshSources = useCallback(async () => {
    const data = await apiJson('/api/content-sources');
    setSources(data.rows || []);
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await apiJson('/api/content-projects');
    setProjects(data.rows || []);
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
  }, [refreshProjects, refreshSources]);

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
        body: JSON.stringify({ action: 'scrape_url', url: webImport.url, tags: webImport.tags, source_type: 'blog' }),
      });
      setWebImport(current => ({ ...current, url: '' }));
      await refreshSources();
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
      setMessage(`${data.inserted || 0} website page${data.inserted === 1 ? '' : 's'} imported${data.errors?.length ? `; ${data.errors.length} skipped.` : '.'}`);
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
      setMetadata({ ...result, model: data.model });
      setSourceInfluence(result.source_influence || []);
      setGuardrailViolations(result.guardrail_violations || []);
      setMessage(result.guardrail_violations?.length ? 'Generated with guardrail issues to fix.' : 'Generated.');
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

  const approveDraft = async () => {
    const savedDraft = await saveVersion('draft');
    if (!savedDraft) return;
    const hadFeedback = feedbackForm.note.trim();
    if (hadFeedback) await saveFeedback(savedDraft.id);
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
    <div className="content-studio workspace-page">
      <header className="workspace-head content-head">
        <div>
          <span className="workspace-kicker">Creative system</span>
          <h1>Content Studio</h1>
          <p>Build SEO and answer-engine drafts from a manual topic, HOWL voice sources, and learned editorial feedback.</p>
        </div>
        <div className="content-project-picker">
          <button type="button" onClick={() => loadProject(null)}>New</button>
          <select value={brief.id || ''} onChange={event => loadProject(event.target.value)}>
            <option value="">Drafting new project</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
        </div>
      </header>

      {error && <div className="app-error">{error}</div>}
      {message && !error && <div className="content-note">{message}</div>}

      <div className="content-tabs" role="tablist">
        {['brief', 'sources', 'outline', 'draft', 'feedback', 'exports'].map(panel => (
          <button key={panel} type="button" className={activePanel === panel ? 'active' : ''} onClick={() => setActivePanel(panel)}>
            {panel}
          </button>
        ))}
      </div>

      <div className="content-layout">
        <aside className="content-side">
          <section>
            <span>Project</span>
            <strong>{brief.title || brief.topic || 'Untitled draft'}</strong>
            <small>{selectedSources.length} voice sources selected · {drafts.length} saved versions · {feedbackItems.length} feedback notes</small>
          </section>
          <section>
            <span>Source influence</span>
            {sourceInfluence.length ? sourceInfluence.map((item, index) => (
              <div className="content-influence" key={`${item.source_id || index}-${item.used_for || index}`}>
                <strong>{item.source_title || `Source ${item.source_id || index + 1}`}</strong>
                <small>{item.used_for || 'Reference'}</small>
              </div>
            )) : <small>No generated influence notes yet.</small>}
          </section>
          <section>
            <span>Guardrails</span>
            {guardrailViolations.length ? (
              <ul className="content-violations">
                {guardrailViolations.map(violation => <li key={violation}>{violation}</li>)}
              </ul>
            ) : <small>No current violations.</small>}
          </section>
        </aside>

        <main className="content-main" aria-busy={loading}>
          {activePanel === 'brief' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Brief</span>
                  <h2>Set the topic manually.</h2>
                </div>
                <button type="button" className="primary-action" disabled={saving || !brief.topic.trim()} onClick={() => saveProject()}>
                  {saving ? 'Saving…' : 'Save brief'}
                </button>
              </div>
              <div className="content-form-grid">
                <label>Project title<input value={brief.title} onChange={event => updateBrief('title', event.target.value)} placeholder="Propane fire pit safety guide" /></label>
                <label>Topic<input value={brief.topic} onChange={event => updateBrief('topic', event.target.value)} placeholder="How to use a propane fire pit safely" /></label>
                <label>Target query<input value={brief.target_query || ''} onChange={event => updateBrief('target_query', event.target.value)} placeholder="are propane fire pits safe" /></label>
                <label>Product/category<input value={brief.product || ''} onChange={event => updateBrief('product', event.target.value)} placeholder="R1, R4 MKii, propane fire pits" /></label>
                <label>Audience<textarea rows="3" value={brief.audience || ''} onChange={event => updateBrief('audience', event.target.value)} /></label>
                <label>Search intent<textarea rows="3" value={brief.search_intent || ''} onChange={event => updateBrief('search_intent', event.target.value)} /></label>
                <label>Desired CTA<textarea rows="3" value={brief.desired_cta || ''} onChange={event => updateBrief('desired_cta', event.target.value)} /></label>
                <label>Must include<textarea rows="4" value={brief.must_include || ''} onChange={event => updateBrief('must_include', event.target.value)} /></label>
                <label className="wide">Avoid<textarea rows="4" value={brief.avoid || ''} onChange={event => updateBrief('avoid', event.target.value)} /></label>
              </div>
            </section>
          )}

          {activePanel === 'sources' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Sources</span>
                  <h2>Train voice and structure.</h2>
                </div>
                <button type="button" className="primary-action" disabled={saving || !sourceForm.title.trim() || !sourceForm.body.trim()} onClick={addSource}>Import source</button>
              </div>
              <div className="content-source-import">
                <div className="content-form-grid compact">
                  <label>Title<input value={sourceForm.title} onChange={event => setSourceForm(current => ({ ...current, title: event.target.value }))} /></label>
                  <label>Type<select value={sourceForm.source_type} onChange={event => setSourceForm(current => ({ ...current, source_type: event.target.value }))}>{SOURCE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>URL<input value={sourceForm.url} onChange={event => setSourceForm(current => ({ ...current, url: event.target.value }))} /></label>
                  <label>Tags<input value={sourceForm.tags} onChange={event => setSourceForm(current => ({ ...current, tags: event.target.value }))} placeholder="seo, safety, r1" /></label>
                  <label className="wide">Body<textarea rows="7" value={sourceForm.body} onChange={event => setSourceForm(current => ({ ...current, body: event.target.value }))} /></label>
                </div>
                <div className="content-bulk">
                  <label>CSV or JSON import<textarea rows="8" value={importText} onChange={event => setImportText(event.target.value)} placeholder={'title,source_type,url,tags,body\nWelcome email,email,,welcome,"Paste copy here"'} /></label>
                  <button type="button" disabled={saving || !importText.trim()} onClick={bulkImport}>Bulk import</button>
                </div>
              </div>
              <div className="content-import-helpers">
                <article>
                  <span>Website scraper</span>
                  <label>Page URL<input value={webImport.url} onChange={event => setWebImport(current => ({ ...current, url: event.target.value }))} placeholder="https://liveouter.com/blogs/..." /></label>
                  <label>Sitemap URL<input value={webImport.sitemapUrl} onChange={event => setWebImport(current => ({ ...current, sitemapUrl: event.target.value }))} /></label>
                  <label>Tags<input value={webImport.tags} onChange={event => setWebImport(current => ({ ...current, tags: event.target.value }))} /></label>
                  <label>Limit<input type="number" min="1" max="30" value={webImport.limit} onChange={event => setWebImport(current => ({ ...current, limit: event.target.value }))} /></label>
                  <div>
                    <button type="button" disabled={saving || !webImport.url.trim()} onClick={scrapeUrl}>Import URL</button>
                    <button type="button" disabled={saving || !webImport.sitemapUrl.trim()} onClick={scrapeSitemap}>Import sitemap</button>
                  </div>
                </article>
                <article>
                  <span>Klaviyo</span>
                  <p>Import recent email campaigns into the source library using the configured Klaviyo API key.</p>
                  <label>Campaign limit<input type="number" min="1" max="50" value={klaviyoLimit} onChange={event => setKlaviyoLimit(event.target.value)} /></label>
                  <button type="button" disabled={saving} onClick={importKlaviyo}>Import emails</button>
                </article>
              </div>
              <div className="content-source-list">
                {sources.map(source => (
                  <article key={source.id} className={selectedIds.has(Number(source.id)) ? 'selected' : ''}>
                    <label>
                      <input type="checkbox" checked={selectedIds.has(Number(source.id))} onChange={() => toggleSource(source.id)} />
                      <span>
                        <strong>{sourceLabel(source)}</strong>
                        <small>{source.tags?.join(', ') || 'No tags'} · {source.chunk_count || 0} chunks</small>
                      </span>
                    </label>
                    <button type="button" onClick={() => deleteSource(source.id)}>Delete</button>
                  </article>
                ))}
                {!sources.length && <div className="workspace-empty"><strong>No voice sources yet.</strong><p>Import past emails, blog posts, landing pages, or copy notes to teach style, pacing, structure, and claim discipline.</p></div>}
              </div>
            </section>
          )}

          {activePanel === 'outline' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Outline</span>
                  <h2>Approve the structure before drafting.</h2>
                </div>
                <div className="content-actions">
                  <button type="button" disabled={generating === 'outline'} onClick={() => generate('outline')}>{generating === 'outline' ? 'Generating…' : 'Generate outline'}</button>
                  <button type="button" disabled={!outline.trim() || saving} onClick={() => saveVersion('outline')}>Save version</button>
                </div>
              </div>
              <textarea className="content-editor outline" value={outline} onChange={event => setOutline(event.target.value)} placeholder="Generate or write an SEO/AEO outline here." />
            </section>
          )}

          {activePanel === 'draft' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Draft</span>
                  <h2>Write, edit, and check the article.</h2>
                </div>
                <div className="content-actions">
                  <button type="button" disabled={generating === 'draft' || !outline.trim()} onClick={() => generate('draft')}>{generating === 'draft' ? 'Drafting…' : 'Generate draft'}</button>
                  <button type="button" disabled={generating === 'rewrite' || !draft.trim()} onClick={() => generate('rewrite')}>Rewrite</button>
                  <button type="button" disabled={!draft.trim()} onClick={runChecks}>Run checks</button>
                  <button type="button" disabled={!draft.trim() || saving || guardrailViolations.length > 0} onClick={approveDraft}>Approve</button>
                </div>
              </div>
              {metadata.meta_description && <div className="content-meta"><strong>Meta</strong><span>{metadata.meta_description}</span></div>}
              <textarea className="content-editor draft" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Generate a full blog draft from the approved outline." />
              <div className="content-feedback-quick">
                <label>Feedback for future runs<textarea rows="3" value={feedbackForm.note} onChange={event => setFeedbackForm(current => ({ ...current, note: event.target.value }))} placeholder="Example: Make intros shorter, keep HOWL more direct, avoid generic outdoor lifestyle copy." /></label>
                <button type="button" disabled={saving || !feedbackForm.note.trim()} onClick={() => saveFeedback()}>Save feedback</button>
              </div>
            </section>
          )}

          {activePanel === 'feedback' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Feedback</span>
                  <h2>Teach the content skill over time.</h2>
                </div>
                <button type="button" className="primary-action" disabled={saving || !feedbackForm.note.trim()} onClick={() => saveFeedback()}>
                  {saving ? 'Saving…' : 'Save feedback'}
                </button>
              </div>
              <div className="content-feedback-form">
                <label>Applies to<select value={feedbackForm.applies_to} onChange={event => setFeedbackForm(current => ({ ...current, applies_to: event.target.value }))}>
                  <option value="voice">Voice</option>
                  <option value="structure">Structure</option>
                  <option value="seo">SEO/AEO</option>
                  <option value="claims">Claims</option>
                  <option value="general">General</option>
                </select></label>
                <label>Signal<select value={feedbackForm.rating} onChange={event => setFeedbackForm(current => ({ ...current, rating: event.target.value }))}>
                  <option value="approved">Approved pattern</option>
                  <option value="revise">Revise next time</option>
                  <option value="avoid">Avoid</option>
                </select></label>
                <label className="wide">Feedback<textarea rows="5" value={feedbackForm.note} onChange={event => setFeedbackForm(current => ({ ...current, note: event.target.value }))} /></label>
              </div>
              <div className="content-feedback-list">
                {feedbackItems.length ? feedbackItems.map(item => (
                  <article key={item.id}>
                    <span>{item.applies_to || 'general'} · {item.rating || 'note'}</span>
                    <p>{item.note}</p>
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </article>
                )) : <div className="workspace-empty"><strong>No feedback saved yet.</strong><p>Approve drafts and save edit notes so future outlines and drafts learn the house style.</p></div>}
              </div>
            </section>
          )}

          {activePanel === 'exports' && (
            <section className="content-panel">
              <div className="content-panel-head">
                <div>
                  <span>Exports</span>
                  <h2>Package a clean draft.</h2>
                </div>
                <div className="content-actions">
                  <button type="button" disabled={!draft.trim()} onClick={runChecks}>Run checks</button>
                  <button type="button" disabled={!draft.trim() || guardrailViolations.length > 0} onClick={() => exportDraft('markdown')}>Markdown</button>
                  <button type="button" disabled={!draft.trim() || guardrailViolations.length > 0} onClick={() => exportDraft('html')}>HTML</button>
                  <button type="button" disabled={!draft.trim() || guardrailViolations.length > 0} onClick={copyDraft}>Copy</button>
                </div>
              </div>
              <div className="content-export-grid">
                <article>
                  <span>Current package</span>
                  <strong>{metadata.title || brief.title || 'Untitled draft'}</strong>
                  <p>{metadata.meta_description || 'Run draft generation to create title, meta, schema, and source influence notes.'}</p>
                  {Array.isArray(metadata.schema_suggestions) && <small>Schema: {metadata.schema_suggestions.join(', ')}</small>}
                </article>
                <article>
                  <span>Version history</span>
                  {drafts.length ? drafts.map(item => (
                    <button key={item.id} type="button" onClick={() => {
                      if (item.kind === 'outline') {
                        setOutline(item.body_markdown);
                        setActivePanel('outline');
                      } else {
                        setDraft(item.body_markdown);
                        setActivePanel('draft');
                      }
                      setMetadata(item.metadata || {});
                      setSourceInfluence(item.source_influence || []);
                      setGuardrailViolations(item.guardrail_violations || []);
                    }}>
                      <strong>{item.kind} v{item.version}</strong>
                      <small>{new Date(item.created_at).toLocaleString()}</small>
                    </button>
                  )) : <p>No saved versions yet.</p>}
                </article>
              </div>
              {latestDraft && <p className="content-version-note">Latest draft: v{latestDraft.version} saved {new Date(latestDraft.created_at).toLocaleString()}.</p>}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
