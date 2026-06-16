import { useEffect, useMemo, useState } from 'react';

const FORMAT_LABELS = {
  talking_head: 'Talking head',
  yap: 'Yap',
  skit: 'Skit',
  high_production: 'High production',
  demonstration: 'Demonstration',
  comparison: 'Comparison',
  day_in_the_life: 'Day in the life',
  customer_story: 'Customer story',
};

function productKey(product) {
  return product?.id || product?.handle || product?.title || '';
}

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

function lines(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

export default function CreatorCampaignPlanner({ onOpenCreator }) {
  const [products, setProducts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [productId, setProductId] = useState('');
  const [assetCount, setAssetCount] = useState(6);
  const [totalBudget, setTotalBudget] = useState(10000);
  const [provenPercent, setProvenPercent] = useState(60);
  const [windowDays, setWindowDays] = useState(90);
  const [objective, setObjective] = useState('Acquire new customers efficiently with product proof that feels native to each creator.');
  const [plan, setPlan] = useState(null);
  const [recentPlans, setRecentPlans] = useState([]);
  const [attribution, setAttribution] = useState({ total_launches: 0, attributed_launches: 0, attributed_creators: 0, unlinked_labels: [] });
  const [creatorOptions, setCreatorOptions] = useState([]);
  const [showAttribution, setShowAttribution] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [guidelines, setGuidelines] = useState({
    brand_name: 'HOWL Campfires',
    voice_guidance: '',
    approved_claims: [],
    prohibited_phrases: [],
    prohibited_claims: [],
    required_disclosures: [],
  });
  const [guidelineDraft, setGuidelineDraft] = useState(null);
  const [linkSelections, setLinkSelections] = useState({});
  const [linking, setLinking] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingGuidelines, setSavingGuidelines] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/shopify-products').then(response => response.json()),
      fetch('/api/creator-campaign-planner').then(response => response.ok ? response.json() : Promise.reject()),
      fetch('/api/brand-guidelines').then(response => response.ok ? response.json() : Promise.reject()),
    ]).then(([productResult, planResult, guidelineResult]) => {
      if (productResult.status === 'fulfilled') {
        setProducts(productResult.value.products || []);
        setConnected(Boolean(productResult.value.connected));
      }
      if (planResult.status === 'fulfilled') {
        setRecentPlans(planResult.value.plans || []);
        setAttribution(planResult.value.attribution || {});
        setCreatorOptions(planResult.value.creators || []);
      }
      if (guidelineResult.status === 'fulfilled') {
        setGuidelines(guidelineResult.value.guidelines || {});
        setGuidelineDraft(guidelineResult.value.guidelines || {});
      }
      setLoading(false);
    });
  }, []);

  const selectedProduct = useMemo(
    () => products.find(product => productKey(product) === productId),
    [productId, products],
  );
  const assignments = plan?.assignments || [];
  const allocation = useMemo(() => assignments.reduce((result, assignment) => {
    result[assignment.cohort] = (result[assignment.cohort] || 0) + 1;
    return result;
  }, {}), [assignments]);

  const generate = async () => {
    if (!selectedProduct) {
      setError('Choose a Shopify product first.');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    setPlan(null);
    try {
      const response = await fetch('/api/creator-campaign-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          product_context: {
            id: selectedProduct.id,
            title: selectedProduct.title,
            handle: selectedProduct.handle,
            description: selectedProduct.description,
            image_url: selectedProduct.image_url,
            variants: selectedProduct.variants?.map(variant => ({
              title: variant.title,
              sku: variant.sku,
              price: variant.price,
            })),
          },
          asset_count: assetCount,
          total_budget: totalBudget,
          proven_percent: provenPercent,
          window_days: windowDays,
          objective,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not build campaign plan');
      setPlan(data.plan);
      setRecentPlans(current => [data.plan, ...current.filter(item => item.id !== data.plan.id)].slice(0, 20));
      setExpanded(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const saveBriefs = async () => {
    if (!plan?.id) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/creator-campaign-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_briefs', plan_id: plan.id, assignments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create briefs');
      setPlan(current => ({ ...current, status: 'briefed' }));
      setNotice(`${data.briefs?.length || assignments.length} draft creator briefs created. Review and approve each one before sending.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateAssignment = (index, patch) => {
    setPlan(current => {
      if (!current) return current;
      const nextAssignments = [...(current.assignments || [])];
      nextAssignments[index] = { ...nextAssignments[index], ...patch };
      return { ...current, assignments: nextAssignments };
    });
  };

  const updateAssignmentList = (index, key, value) => {
    updateAssignment(index, {
      [key]: value.split('\n').map(item => item.trim()).filter(Boolean),
    });
  };

  const saveGuidelines = async () => {
    if (!guidelineDraft) return;
    setSavingGuidelines(true);
    setError('');
    try {
      const payload = {
        ...guidelineDraft,
        approved_claims: lines(guidelineDraft.approved_claims),
        prohibited_phrases: lines(guidelineDraft.prohibited_phrases),
        prohibited_claims: lines(guidelineDraft.prohibited_claims),
        required_disclosures: lines(guidelineDraft.required_disclosures),
      };
      const response = await fetch('/api/brand-guidelines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save brand guidelines');
      setGuidelines(data.guidelines);
      setGuidelineDraft(data.guidelines);
      setShowGuidelines(false);
      setNotice('Brand guardrails saved. New plans will be validated against them.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingGuidelines(false);
    }
  };

  const openRecent = item => {
    setPlan(item);
    setProductId(productKey(products.find(product => product.title === item.product_title)));
    setAssetCount(Number(item.asset_count) || 6);
    setTotalBudget(Number(item.total_budget) || 0);
    setProvenPercent(Number(item.proven_percent) || 60);
    setObjective(item.objective || '');
    setExpanded(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCreator = creatorId => {
    if (onOpenCreator) return onOpenCreator(Number(creatorId));
    setError('Creator navigation is not available from this view.');
  };

  const linkCreator = async label => {
    const creatorId = Number(linkSelections[label]);
    if (!creatorId) return;
    setLinking(label);
    setError('');
    try {
      const response = await fetch('/api/creator-campaign-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_creator_label', label, creator_id: creatorId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not link creator history');
      const refresh = await fetch('/api/creator-campaign-planner');
      if (refresh.ok) {
        const refreshed = await refresh.json();
        setAttribution(refreshed.attribution || {});
        setCreatorOptions(refreshed.creators || []);
      } else {
        setAttribution(current => ({
          ...current,
          attributed_launches: Number(current.attributed_launches || 0) + Number(data.linked || 0),
          unlinked_labels: (current.unlinked_labels || []).filter(item => item.label !== label),
        }));
      }
      setNotice(`Linked ${data.linked} historical launch${data.linked === 1 ? '' : 'es'} to ${data.creator.name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking('');
    }
  };

  const attributionRate = Number(attribution.total_launches || 0)
    ? Math.round((Number(attribution.attributed_launches || 0) / Number(attribution.total_launches)) * 100)
    : 100;
  const blockedRuleCount = (guidelines.prohibited_phrases?.length || 0) + (guidelines.prohibited_claims?.length || 0);
  const outcomeRoas = Number(plan?.outcome_spend) > 0
    ? Number(plan.outcome_revenue || 0) / Number(plan.outcome_spend)
    : null;
  const outcomeCpa = Number(plan?.outcome_purchases) > 0
    ? Number(plan.outcome_spend || 0) / Number(plan.outcome_purchases)
    : null;

  return (
    <section className="campaign-planner">
      <header className="campaign-head">
        <div>
          <span className="workspace-kicker">Performance-led creative</span>
          <h1>Plan the next creator campaign.</h1>
          <p>Choose the product and portfolio mix. HOWL matches creators to concepts using account performance, creator history, and profile fit.</p>
        </div>
        <div className="campaign-principle">
          <span>Decision rule</span>
          <strong>Evidence first. Taste second. AI last.</strong>
        </div>
      </header>

      <section className="campaign-guardrail">
        <div>
          <span>Brand guardrail</span>
          <strong>{blockedRuleCount} blocked phrases or claims enforced</strong>
          <p>{guidelines.voice_guidance || 'Add voice, claims, and prohibited language before generating.'}</p>
        </div>
        <button onClick={() => setShowGuidelines(current => !current)}>
          {showGuidelines ? 'Close guidelines' : 'Edit guidelines'}
        </button>
        {showGuidelines && guidelineDraft ? (
          <div className="campaign-guideline-editor">
            <label>Voice and tone<textarea rows="4" value={guidelineDraft.voice_guidance || ''} onChange={event => setGuidelineDraft(current => ({ ...current, voice_guidance: event.target.value }))} /></label>
            <label>Approved claims<textarea rows="5" value={lines(guidelineDraft.approved_claims)} onChange={event => setGuidelineDraft(current => ({ ...current, approved_claims: event.target.value.split('\n') }))} placeholder="One approved claim per line" /></label>
            <label>Blocked language<textarea rows="5" value={lines(guidelineDraft.prohibited_phrases)} onChange={event => setGuidelineDraft(current => ({ ...current, prohibited_phrases: event.target.value.split('\n') }))} placeholder="Words or phrases that must never appear" /></label>
            <label>Blocked claims<textarea rows="5" value={lines(guidelineDraft.prohibited_claims)} onChange={event => setGuidelineDraft(current => ({ ...current, prohibited_claims: event.target.value.split('\n') }))} placeholder="Claims that must never appear" /></label>
            <label className="campaign-guideline-wide">Required disclosures<textarea rows="3" value={lines(guidelineDraft.required_disclosures)} onChange={event => setGuidelineDraft(current => ({ ...current, required_disclosures: event.target.value.split('\n') }))} placeholder="One disclosure per line" /></label>
            <button className="campaign-generate campaign-guideline-save" onClick={saveGuidelines} disabled={savingGuidelines}>
              {savingGuidelines ? 'Saving guardrails…' : 'Save brand guardrails'}
            </button>
          </div>
        ) : null}
      </section>

      {attributionRate < 100 ? (
        <section className="campaign-attribution">
          <div>
            <span>Creator performance setup</span>
            <strong>{attributionRate}% of launch history is linked to creators</strong>
            <p>Format and hook evidence is available now. Link historical creator labels to unlock genuine proven-creator allocation.</p>
          </div>
          <button onClick={() => setShowAttribution(current => !current)}>
            {showAttribution ? 'Hide mapping' : `Map ${(attribution.unlinked_labels || []).length} labels`}
          </button>
          {showAttribution ? (
            <div className="campaign-attribution-map">
              {(attribution.unlinked_labels || []).map(item => (
                <section key={item.label}>
                  <span><strong>{item.label}</strong><small>{item.launches} launch{item.launches === 1 ? '' : 'es'}</small></span>
                  <select value={linkSelections[item.label] || ''} onChange={event => setLinkSelections(current => ({ ...current, [item.label]: event.target.value }))}>
                    <option value="">Choose creator record</option>
                    {creatorOptions.map(creator => <option value={creator.id} key={creator.id}>{creator.name} · {creator.stage}</option>)}
                  </select>
                  <button
                    disabled={!linkSelections[item.label] || linking === item.label}
                    title={!linkSelections[item.label] ? 'Choose a creator record before linking this historical label.' : ''}
                    onClick={() => linkCreator(item.label)}
                  >
                    {linking === item.label ? 'Linking…' : 'Link'}
                  </button>
                </section>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="campaign-builder">
        <section className="campaign-inputs">
          <header><span>Campaign setup</span><small>Five inputs</small></header>
          <label>
            Product
            <select value={productId} onChange={event => setProductId(event.target.value)}>
              <option value="">{loading ? 'Loading products…' : connected ? 'Choose a product' : 'Shopify is not connected'}</option>
              {products.map(product => <option key={productKey(product)} value={productKey(product)}>{product.title}</option>)}
            </select>
          </label>
          {selectedProduct ? (
            <div className="campaign-product">
              {selectedProduct.image_url ? <img src={selectedProduct.image_url} alt="" /> : <span />}
              <div><strong>{selectedProduct.title}</strong><small>{selectedProduct.description?.slice(0, 145) || 'No product description available.'}</small></div>
            </div>
          ) : null}
          <div className="campaign-pair">
            <label>
              Assets
              <select value={assetCount} onChange={event => setAssetCount(Number(event.target.value))}>
                {[4, 6, 8, 10, 12, 16].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Evidence window
              <select value={windowDays} onChange={event => setWindowDays(Number(event.target.value))}>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
              </select>
            </label>
          </div>
          <label>
            Paid media budget
            <input type="number" min="0" step="500" value={totalBudget} onChange={event => setTotalBudget(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label className="campaign-allocation">
            <span><b>Proven creators</b><strong>{provenPercent}%</strong></span>
            <input type="range" min="0" max="100" step="10" value={provenPercent} onChange={event => setProvenPercent(Number(event.target.value))} />
            <small>{100 - provenPercent}% reserved for net-new creator learning</small>
          </label>
          <label>
            Objective
            <textarea rows="4" value={objective} onChange={event => setObjective(event.target.value)} />
          </label>
          <button className="campaign-generate" onClick={generate} disabled={generating}>
            {generating ? 'Analyzing creators and account patterns…' : 'Build campaign plan'}
          </button>
          {error ? <div className="app-error">{error}</div> : null}
        </section>

        <main className="campaign-results">
          {!plan && !generating ? (
            <div className="campaign-empty">
              <span>01</span>
              <h2>A portfolio, not a prompt.</h2>
              <p>The output will show who to use, what each person should make, which formats balance the campaign, and the performance evidence behind every decision.</p>
              <div>
                {['Creator allocation', 'Format mix', 'Hooks + scripts', 'Decision evidence'].map(item => <i key={item}>{item}</i>)}
              </div>
            </div>
          ) : null}
          {generating ? (
            <div className="campaign-loading">
              <span />
              <strong>Building the portfolio</strong>
              <p>Ranking creator history, reading account patterns, and writing distinct concepts.</p>
            </div>
          ) : null}
          {plan ? (
            <>
              <header className="campaign-plan-head">
                <div>
                  <span>Recommended portfolio</span>
                  <h2>{plan.product_title}</h2>
                  <p>{plan.strategy_summary || 'Performance-led creator allocation.'}</p>
                </div>
                <div className="campaign-plan-stats">
                  <div><strong>{assignments.length}</strong><span>assets</span></div>
                  <div><strong>{allocation.proven || 0}</strong><span>proven</span></div>
                  <div><strong>{allocation.net_new || 0}</strong><span>net new</span></div>
                  {plan.total_budget ? <div><strong>{money(plan.total_budget)}</strong><span>budget</span></div> : null}
                </div>
              </header>

              {Number(plan.outcome_spend || 0) > 0 ? (
                <section className="campaign-outcomes">
                  <div><span>Spend</span><strong>{money(plan.outcome_spend)}</strong></div>
                  <div><span>Revenue</span><strong>{money(plan.outcome_revenue)}</strong></div>
                  <div><span>ROAS</span><strong>{outcomeRoas?.toFixed(2)}x</strong></div>
                  <div><span>CPA</span><strong>{outcomeCpa ? money(outcomeCpa) : '—'}</strong></div>
                  <p>{plan.attributed_assignments} of {assignments.length} assignments have launched performance attached.</p>
                </section>
              ) : null}

              <div className="campaign-assignment-list">
                {assignments.map((assignment, index) => (
                  <article className={`campaign-assignment ${expanded === index ? 'open' : ''}`} key={`${assignment.creator_id}-${index}`}>
                    <button className="campaign-assignment-summary" onClick={() => setExpanded(expanded === index ? null : index)}>
                      <span className="campaign-slot">{String(index + 1).padStart(2, '0')}</span>
                      <span className="campaign-person">
                        <i>{assignment.cohort === 'proven' ? 'Proven creator' : 'Net-new creator'}</i>
                        <strong>{assignment.creator_name}</strong>
                      </span>
                      <span className="campaign-concept">
                        <i>{FORMAT_LABELS[assignment.format] || assignment.format}</i>
                        <strong>{assignment.concept_name}</strong>
                        {assignment.allocated_budget ? <small>{money(assignment.allocated_budget)} recommended spend</small> : null}
                        {Number(assignment.outcome?.spend || 0) > 0 ? (
                          <small>
                            {money(assignment.outcome.spend)} spent · {(Number(assignment.outcome.revenue || 0) / Number(assignment.outcome.spend)).toFixed(2)}x ROAS
                          </small>
                        ) : null}
                      </span>
                      <span className="campaign-expand">{expanded === index ? '−' : '+'}</span>
                    </button>
                    {expanded === index ? (
                      <div className="campaign-assignment-detail">
                        <section className="campaign-logic">
                          <span>Why HOWL chose this</span>
                          <p>{assignment.performance_logic}</p>
                          <p>{assignment.creator_match}</p>
                          <div>{(assignment.evidence || []).map(item => <i key={item}>{item}</i>)}</div>
                        </section>
                        <div className="campaign-creative-grid">
                          <section><span>Hypothesis</span><p>{assignment.hypothesis}</p></section>
                          <section><span>Opening frame</span><p>{assignment.opening_visual}</p></section>
                        </div>
                        <section className="campaign-script">
                          <span>Hook options</span>
                          <textarea
                            rows="4"
                            value={(assignment.hooks || []).join('\n')}
                            onChange={event => updateAssignmentList(index, 'hooks', event.target.value)}
                          />
                          <span>Body</span>
                          <textarea
                            rows="10"
                            value={assignment.full_script || ''}
                            onChange={event => updateAssignment(index, { full_script: event.target.value })}
                          />
                          <span>CTA options</span>
                          <textarea
                            rows="4"
                            value={(assignment.ctas || []).join('\n')}
                            onChange={event => updateAssignmentList(index, 'ctas', event.target.value)}
                          />
                          <span>Shot list</span>
                          <textarea
                            rows="5"
                            value={(assignment.shot_list || []).join('\n')}
                            onChange={event => updateAssignmentList(index, 'shot_list', event.target.value)}
                          />
                        </section>
                        <footer>
                          <button type="button" onClick={() => openCreator(assignment.creator_id)}>Open creator</button>
                          <small>{(assignment.shot_list || []).length} planned shots · {(assignment.hooks || []).length} hooks</small>
                        </footer>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>

              <div className="campaign-approve">
                <div><span>Ready to operationalize?</span><strong>Create draft briefs. Review and approve each one before sending.</strong></div>
                <button
                  onClick={saveBriefs}
                  disabled={saving || plan.status === 'briefed'}
                  title={plan.status === 'briefed' ? 'Draft briefs have already been created for this plan.' : ''}
                >
                  {plan.status === 'briefed' ? 'Briefs created' : saving ? 'Creating briefs…' : 'Create editable draft briefs'}
                </button>
              </div>
              {notice ? <div className="app-notice">{notice}</div> : null}
            </>
          ) : null}
        </main>
      </div>

      {recentPlans.length ? (
        <section className="campaign-history">
          <header><span>Recent plans</span><small>Decision history</small></header>
          <div>
            {recentPlans.slice(0, 6).map(item => (
              <button key={item.id} onClick={() => openRecent(item)}>
                <span><strong>{item.product_title}</strong><small>{new Date(item.created_at).toLocaleDateString()}</small></span>
                <span>{item.asset_count} assets</span>
                <i>{Number(item.outcome_spend || 0) > 0 ? `${(Number(item.outcome_revenue || 0) / Number(item.outcome_spend)).toFixed(2)}x` : item.status}</i>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {plan?.evidence?.patterns?.length ? (
        <small className="campaign-source-note">
          Evidence window: {plan.evidence_window_days} days · {plan.evidence.patterns.length} account patterns considered · Spend references are Meta-attributed.
        </small>
      ) : null}
    </section>
  );
}
