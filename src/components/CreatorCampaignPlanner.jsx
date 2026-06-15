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

export default function CreatorCampaignPlanner({ onOpenCreator }) {
  const [products, setProducts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [productId, setProductId] = useState('');
  const [assetCount, setAssetCount] = useState(6);
  const [provenPercent, setProvenPercent] = useState(60);
  const [windowDays, setWindowDays] = useState(90);
  const [objective, setObjective] = useState('Acquire new customers efficiently with product proof that feels native to each creator.');
  const [plan, setPlan] = useState(null);
  const [recentPlans, setRecentPlans] = useState([]);
  const [attribution, setAttribution] = useState({ total_launches: 0, attributed_launches: 0, attributed_creators: 0, unlinked_labels: [] });
  const [creatorOptions, setCreatorOptions] = useState([]);
  const [showAttribution, setShowAttribution] = useState(false);
  const [linkSelections, setLinkSelections] = useState({});
  const [linking, setLinking] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/shopify-products').then(response => response.json()),
      fetch('/api/creator-campaign-planner').then(response => response.ok ? response.json() : Promise.reject()),
    ]).then(([productResult, planResult]) => {
      if (productResult.status === 'fulfilled') {
        setProducts(productResult.value.products || []);
        setConnected(Boolean(productResult.value.connected));
      }
      if (planResult.status === 'fulfilled') {
        setRecentPlans(planResult.value.plans || []);
        setAttribution(planResult.value.attribution || {});
        setCreatorOptions(planResult.value.creators || []);
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
        body: JSON.stringify({ action: 'save_briefs', plan_id: plan.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create briefs');
      setPlan(current => ({ ...current, status: 'briefed' }));
      setNotice(`${data.briefs?.length || assignments.length} creator briefs created and ready for review.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openRecent = item => {
    setPlan(item);
    setProductId(productKey(products.find(product => product.title === item.product_title)));
    setAssetCount(Number(item.asset_count) || 6);
    setProvenPercent(Number(item.proven_percent) || 60);
    setObjective(item.objective || '');
    setExpanded(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
                  <button disabled={!linkSelections[item.label] || linking === item.label} onClick={() => linkCreator(item.label)}>
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
          <header><span>Campaign setup</span><small>Four inputs</small></header>
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
          <label className="campaign-allocation">
            <span><b>Proven creators</b><strong>{provenPercent}%</strong></span>
            <input type="range" min="0" max="100" step="10" value={provenPercent} onChange={event => setProvenPercent(Number(event.target.value))} />
            <small>{100 - provenPercent}% reserved for net-new creator learning</small>
          </label>
          <label>
            Objective
            <textarea rows="4" value={objective} onChange={event => setObjective(event.target.value)} />
          </label>
          <button className="campaign-generate" onClick={generate} disabled={generating || !selectedProduct}>
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
                </div>
              </header>

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
                          <ol>{(assignment.hooks || []).map(hook => <li key={hook}>{hook}</li>)}</ol>
                          <span>Body</span>
                          <p>{assignment.full_script}</p>
                          <span>CTA options</span>
                          <ul>{(assignment.ctas || []).map(cta => <li key={cta}>{cta}</li>)}</ul>
                        </section>
                        <footer>
                          <button onClick={() => onOpenCreator?.(assignment.creator_id)}>Open creator</button>
                          <small>{(assignment.shot_list || []).length} planned shots · {(assignment.hooks || []).length} hooks</small>
                        </footer>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>

              <div className="campaign-approve">
                <div><span>Ready to operationalize?</span><strong>Create one editable brief per assignment.</strong></div>
                <button onClick={saveBriefs} disabled={saving || plan.status === 'briefed'}>
                  {plan.status === 'briefed' ? 'Briefs created' : saving ? 'Creating briefs…' : 'Approve plan + create briefs'}
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
                <i>{item.status}</i>
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
