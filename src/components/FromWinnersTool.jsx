import React, { useCallback, useEffect, useMemo, useState } from 'react';

const STRATEGIES = [
  { key: 'controlled', label: 'Controlled iterations', description: 'Keep the winning structure and change one variable at a time.' },
  { key: 'crossbreed', label: 'Crossbreed winners', description: 'Combine the hook mechanic of one winner with the proof or format of another.' },
  { key: 'frontier', label: 'Adjacent bets', description: 'Use the learning, but move into a genuinely new angle or execution.' },
];

const PRODUCTS = [
  { key: 'mixed', label: 'Mixed products' },
  { key: 'r1', label: 'R1' },
  { key: 'r4mkii', label: 'R4 MKii' },
];

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

function parseJsonArray(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('The model did not return a JSON array.');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Concept response was not an array.');
  return parsed;
}

export default function FromWinnersTool({ setActiveTab, setVariations, onOpenCreator }) {
  const [studioMode, setStudioMode] = useState('net_new');
  const [windowDays, setWindowDays] = useState(30);
  const [winners, setWinners] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [count, setCount] = useState(6);
  const [strategy, setStrategy] = useState('controlled');
  const [product, setProduct] = useState('mixed');
  const [objective, setObjective] = useState('Lower NCAC while protecting conversion quality');
  const [mustInclude, setMustInclude] = useState('');
  const [avoid, setAvoid] = useState('Generic campfire lifestyle montage; vague “game changer” language; unsupported claims');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [concepts, setConcepts] = useState([]);
  const [creators, setCreators] = useState([]);
  const [creatorId, setCreatorId] = useState('');
  const [shopifyProducts, setShopifyProducts] = useState([]);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [netNewProduct, setNetNewProduct] = useState('');
  const [netNewAngle, setNetNewAngle] = useState('');
  const [netNewObjective, setNetNewObjective] = useState('Acquire new customers with credible product proof');
  const [netNewDirection, setNetNewDirection] = useState('');
  const [netNewCount, setNetNewCount] = useState(4);
  const [netNewConcepts, setNetNewConcepts] = useState([]);
  const [netNewBriefs, setNetNewBriefs] = useState([]);

  const load = useCallback(async (days) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_analyzed_winners', sinceDays: days }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setWinners(data.winners || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (studioMode === 'iterate') load(windowDays);
  }, [load, studioMode, windowDays]);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/creators').then(response => response.ok ? response.json() : Promise.reject()),
      fetch('/api/shopify-products').then(response => response.json()),
    ]).then(([creatorResult, productResult]) => {
      if (creatorResult.status === 'fulfilled') {
        setCreators(creatorResult.value.creators || []);
      }
      if (productResult.status === 'fulfilled') {
        setShopifyProducts(productResult.value.products || []);
        setShopifyConnected(Boolean(productResult.value.connected));
      }
    });
  }, []);

  useEffect(() => {
    if (!winners?.length) return;
    try {
      const carried = JSON.parse(sessionStorage.getItem('howl:selected-winners') || '[]');
      if (Array.isArray(carried) && carried.length) {
        const available = new Set(winners.map(w => w.group_key));
        setSelected(new Set(carried.filter(key => available.has(key))));
        sessionStorage.removeItem('howl:selected-winners');
      }
    } catch {}
  }, [winners]);

  const selectedWinners = useMemo(
    () => (winners || []).filter(winner => selected.has(winner.group_key)),
    [winners, selected],
  );

  const toggle = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dismissWinner = async (winner) => {
    setError('');
    try {
      const response = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss_analyzed_winner', groupKey: winner.group_key }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setWinners(current => (current || []).filter(item => item.group_key !== winner.group_key));
      setSelected(current => {
        const next = new Set(current);
        next.delete(winner.group_key);
        return next;
      });
    } catch (err) {
      setError(`Could not remove concept: ${err.message}`);
    }
  };

  const generate = async () => {
    if (!selectedWinners.length) return;
    const incompleteVideos = selectedWinners.filter(
      winner => winner.asset_kind === 'video' && winner.transcription_status !== 'complete',
    );
    if (incompleteVideos.length) {
      setGenerateError(
        `${incompleteVideos.length} selected video winner${incompleteVideos.length === 1 ? ' needs' : 's need'} a complete transcript. Re-analyze ${incompleteVideos.length === 1 ? 'it' : 'them'} in Creative Analytics before generating.`,
      );
      return;
    }
    const references = selectedWinners.map((winner, index) => {
      const spend = Number(winner.spend) || 0;
      const revenue = Number(winner.purchase_value) || 0;
      const purchases = Number(winner.purchases) || 0;
      return [
        `WINNER ${index + 1}: ${winner.name || 'Untitled'}`,
        `Performance: spend ${money(spend)}, purchase value ${money(revenue)}, ROAS ${spend ? (revenue / spend).toFixed(2) : 'n/a'}, purchases ${purchases}, CPA ${purchases ? money(spend / purchases) : 'n/a'}`,
        `DNA: format=${winner.format || 'unknown'}; hook_type=${winner.hook_type || 'unknown'}; angle=${winner.angle || 'unknown'}`,
        winner.hook_text_verbatim ? `Opening: "${winner.hook_text_verbatim}"` : null,
        winner.visual_summary ? `Visual system: ${winner.visual_summary}` : null,
        winner.talent_description ? `Talent: ${winner.talent_description}` : null,
        winner.why_it_worked ? `Observed reason it worked: ${winner.why_it_worked}` : null,
        winner.transcript ? `Transcript:\n${winner.transcript}` : null,
      ].filter(Boolean).join('\n');
    }).join('\n\n-----\n\n');

    const strategyInstruction = {
      controlled: 'Create a test matrix. Preserve one proven control from a winner and change exactly one major variable per concept.',
      crossbreed: 'Each concept must explicitly combine two different winners. Name what comes from each and ensure the combination is coherent.',
      frontier: 'Move one step beyond the winners into adjacent unmet angles. Preserve a proven psychological mechanism, but do not copy the surface execution.',
    }[strategy];

    const system = `You are HOWL Campfires' senior performance creative strategist. You turn observed ad performance into disciplined, shootable test concepts.

HOWL sells portable propane fire pits, primarily R1 and R4 MKii. The voice is direct, practical, specific, outdoor-literate, and confident without macho filler.

Your job is not to paraphrase winning scripts. Your job is to identify the mechanism that likely drove performance and design distinct tests that can teach the team something.

Rules:
- ${strategyInstruction}
- Every concept needs a falsifiable hypothesis and one clearly named primary variable.
- Ground claims in proof that can be filmed or shown.
- The first three seconds must be visually specific, not just a spoken hook.
- Avoid em dashes, fake testimonials, invented specs, and generic AI copy patterns.
- Scripts must sound spoken, use short sentences, and include a clear product reveal and CTA.
- Concepts must be meaningfully different from one another in angle, opening image, or persuasion mechanism.
- Prefer practical production that HOWL can shoot outdoors with a creator, founder, customer, product, phone, and existing footage.

Return ONLY a JSON array with this exact shape:
{
  "concept_name": "short memorable name",
  "product": "r1 | r4mkii",
  "format": "ugc-demo | founder-demo | comparison | problem-solution | customer-story | static | montage",
  "angle": "specific persuasion angle",
  "inspired_by": ["winner name"],
  "winning_pattern_kept": "the proven mechanism retained",
  "primary_variable": "the single main variable this test changes",
  "hypothesis": "If we change X, then Y should improve because Z",
  "opening_visual": "what appears in frame 0-3 seconds",
  "hook": "spoken or on-screen opening line",
  "proof_sequence": ["specific proof beat 1", "beat 2", "beat 3"],
  "script": "complete spoken script, approximately 20-35 seconds",
  "shot_list": ["shot 1", "shot 2", "shot 3", "shot 4"],
  "cta": "specific CTA",
  "why_new": "how this differs from the references",
  "risk": "what could make the test fail"
}`;

    const user = `Build ${count} creative concepts.

BUSINESS OBJECTIVE:
${objective}

PRODUCT DIRECTION:
${product === 'mixed' ? 'Use both R1 and R4 MKii across the set when relevant.' : `Focus on ${product}.`}

MUST INCLUDE:
${mustInclude || 'No additional requirement.'}

AVOID:
${avoid || 'No additional exclusions.'}

REFERENCE WINNERS:
${references}`;

    setGenerating(true);
    setGenerateError('');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 12000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || data.error);
      const text = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
      setConcepts(parseJsonArray(text));
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const sendToResults = () => {
    setVariations(concepts.map(rawConcept => {
      const concept = rawConcept || {};
      return {
      hook: concept.hook,
      script: concept.script,
      product: concept.product,
      angle: concept.angle,
      format: concept.format,
      concept_name: concept.concept_name,
      hypothesis: concept.hypothesis,
      opening_visual: concept.opening_visual,
      proof_sequence: concept.proof_sequence,
      shot_list: concept.shot_list,
      inspired_by: (concept.inspired_by || []).join(', '),
      };
    }));
    setActiveTab('results');
  };

  const deleteConcept = (indexToDelete) => {
    setConcepts(current => current.filter((_, index) => index !== indexToDelete));
  };

  const generateNetNew = async () => {
    if (!creatorId || !netNewProduct) {
      setGenerateError('Choose a creator and Shopify product first.');
      return;
    }
    const [productId, variantId] = netNewProduct.split('::');
    const productRecord = shopifyProducts.find(item => item.id === productId);
    const variant = productRecord?.variants?.find(item => item.id === variantId);
    if (!productRecord || !variant) {
      setGenerateError('The selected Shopify product is no longer available.');
      return;
    }
    setGenerating(true);
    setGenerateError('');
    try {
      const response = await fetch('/api/creator-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_concepts',
          creator_id: Number(creatorId),
          count: netNewCount,
          product: productRecord.title,
          product_context: {
            id: productRecord.id,
            title: productRecord.title,
            description: productRecord.description,
            handle: productRecord.handle,
            variant: {
              id: variant.id,
              title: variant.title,
              sku: variant.sku,
              price: variant.price,
            },
          },
          angle: netNewAngle,
          objective: netNewObjective,
          direction: netNewDirection,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate concepts');
      setNetNewConcepts(data.concepts || []);
      setNetNewBriefs(data.briefs || []);
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const deleteNetNewConcept = indexToDelete => {
    setNetNewConcepts(current => current.filter((_, index) => index !== indexToDelete));
  };

  return (
    <div className="concept-studio">
      <header className="concept-head">
        <div>
          <div className="motion-kicker">Creative strategy</div>
          <h1>Concept studio</h1>
          <p>Build creator-specific UGC from first principles, then feed performance learnings back into the next test.</p>
        </div>
        <div className="concept-window concept-mode-switch">
          <button className={studioMode === 'net_new' ? 'active' : ''} onClick={() => setStudioMode('net_new')}>Net new for creator</button>
          <button className={studioMode === 'iterate' ? 'active' : ''} onClick={() => setStudioMode('iterate')}>Iterate winners</button>
        </div>
      </header>

      {error ? <div className="motion-error">{error}</div> : null}
      {studioMode === 'iterate' && loading && !winners ? <div className="motion-loading">Loading analyzed winners…</div> : null}

      {studioMode === 'net_new' ? (
        <div className="concept-layout">
          <aside className="concept-controls">
            <section>
              <label>1. Creator</label>
              <select className="concept-select" value={creatorId} onChange={event => setCreatorId(event.target.value)}>
                <option value="">Choose creator</option>
                {creators.map(creator => <option key={creator.id} value={creator.id}>{creator.name}{creator.niche ? ` · ${creator.niche}` : ''}</option>)}
              </select>
            </section>
            <section>
              <label>2. Shopify product</label>
              <select className="concept-select" value={netNewProduct} onChange={event => setNetNewProduct(event.target.value)}>
                <option value="">{shopifyConnected ? 'Choose product' : 'Shopify connection required'}</option>
                {shopifyProducts.flatMap(productRecord => productRecord.variants.map(variant => (
                  <option key={variant.id} value={`${productRecord.id}::${variant.id}`}>
                    {productRecord.title}{variant.title !== 'Default Title' ? ` · ${variant.title}` : ''} · ${money(variant.price)}
                  </option>
                )))}
              </select>
            </section>
            <section>
              <label>3. Product angle</label>
              <textarea value={netNewAngle} onChange={event => setNetNewAngle(event.target.value)} rows={3} placeholder="Burn bans, cold-weather heat, portability, truck camping..." />
            </section>
            <section>
              <label>Objective</label>
              <textarea value={netNewObjective} onChange={event => setNetNewObjective(event.target.value)} rows={3} />
            </section>
            <section>
              <label>Additional direction</label>
              <textarea value={netNewDirection} onChange={event => setNetNewDirection(event.target.value)} rows={3} placeholder="Offer, season, proof requirement, guardrails..." />
            </section>
          </aside>
          <main className="concept-main">
            <div className="concept-section-title">
              <div><span>Creator-first development</span><strong>Strategy → concept → script → assignment</strong></div>
              <label>Concepts <input type="number" min="1" max="8" value={netNewCount} onChange={event => setNetNewCount(Math.max(1, Math.min(8, Number(event.target.value) || 4)))} /></label>
            </div>
            <div className="concept-context-note">
              <strong>Grounded in the creator record</strong>
              <p>Niche, strengths, audience demographics, psychographics, activities, social metrics, and prior ad performance shape every concept.</p>
            </div>
            <div className="concept-generate-row">
              <p>{creatorId ? 'Creator context selected.' : 'Choose the person who will actually film the ad.'}</p>
              <button onClick={generateNetNew} disabled={!creatorId || !netNewProduct || generating}>{generating ? 'Building creator concepts…' : `Generate ${netNewCount} concepts`}</button>
            </div>
            {generateError ? <div className="motion-error">{generateError}</div> : null}
            {netNewConcepts.length > 0 && (
              <>
                <div className="concept-output-head">
                  <div><span>Saved to creator</span><strong>{netNewConcepts.length} concept briefs + scripts</strong></div>
                  <button onClick={() => onOpenCreator?.(Number(creatorId))}>Open creator workflow</button>
                </div>
                <div className="concept-output-grid">
                  {netNewConcepts.map((concept, index) => (
                    <article className="concept-output" key={`${concept.concept_name || 'concept'}-${index}`}>
                      <div className="concept-number">{String(index + 1).padStart(2, '0')}</div>
                      <button className="concept-delete" type="button" onClick={() => deleteNetNewConcept(index)}>Hide</button>
                      <div className="concept-tags">{[concept.product, concept.format, concept.angle].filter(Boolean).map((tag, tagIndex) => <span key={`${tag}-${tagIndex}`}>{tag}</span>)}</div>
                      <h2>{concept.concept_name}</h2>
                      <blockquote>{concept.hook}</blockquote>
                      <dl>
                        <div><dt>Creator fit</dt><dd>{concept.creator_fit || '—'}</dd></div>
                        <div><dt>Hypothesis</dt><dd>{concept.hypothesis || '—'}</dd></div>
                        <div><dt>Opening frame</dt><dd>{concept.opening_visual || '—'}</dd></div>
                      </dl>
                      <details><summary>Brief and shot plan</summary><p className="concept-script">{concept.brief}</p><h4>Shots</h4><ol>{(concept.shot_list || []).map(item => <li key={item}>{item}</li>)}</ol></details>
                      <details><summary>Full script</summary><p className="concept-script">{concept.script}</p></details>
                      <footer><span>Brief #{netNewBriefs[index]?.id || 'saved'} · Ready for assignment</span><span>CTA: {concept.cta}</span></footer>
                    </article>
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      ) : (
      <>
      <div className="concept-window concept-performance-window">
        {[7, 14, 30, 90].map(days => <button className={windowDays === days ? 'active' : ''} onClick={() => setWindowDays(days)} key={days}>{days}d</button>)}
      </div>
      <div className="concept-layout">
        <aside className="concept-controls">
          <section>
            <label>1. Testing strategy</label>
            {STRATEGIES.map(item => (
              <button className={`concept-choice ${strategy === item.key ? 'active' : ''}`} onClick={() => setStrategy(item.key)} key={item.key}>
                <strong>{item.label}</strong><span>{item.description}</span>
              </button>
            ))}
          </section>
          <section>
            <label>2. Product</label>
            <div className="concept-segmented">
              {PRODUCTS.map(item => <button className={product === item.key ? 'active' : ''} onClick={() => setProduct(item.key)} key={item.key}>{item.label}</button>)}
            </div>
          </section>
          <section>
            <label htmlFor="concept-objective">3. Objective</label>
            <textarea id="concept-objective" value={objective} onChange={event => setObjective(event.target.value)} rows={3} />
          </section>
          <section>
            <label htmlFor="concept-include">Must include</label>
            <textarea id="concept-include" value={mustInclude} onChange={event => setMustInclude(event.target.value)} rows={2} placeholder="Launch, offer, proof, audience, season…" />
          </section>
          <section>
            <label htmlFor="concept-avoid">Avoid</label>
            <textarea id="concept-avoid" value={avoid} onChange={event => setAvoid(event.target.value)} rows={3} />
          </section>
        </aside>

        <main className="concept-main">
          <div className="concept-section-title">
            <div><span>Reference set</span><strong>{selected.size} selected</strong></div>
            <label>Concepts <input type="number" min="1" max="12" value={count} onChange={event => setCount(Math.max(1, Math.min(12, Number(event.target.value) || 6)))} /></label>
          </div>

          <div className="concept-winners">
            {(winners || []).map(winner => {
              const active = selected.has(winner.group_key);
              const spend = Number(winner.spend) || 0;
              const revenue = Number(winner.purchase_value) || 0;
              const transcriptReady = winner.asset_kind !== 'video' || winner.transcription_status === 'complete';
              return (
                <div className={`concept-winner ${active ? 'active' : ''} ${transcriptReady ? '' : 'incomplete'}`} key={winner.group_key}>
                  <button className="concept-winner-select" type="button" onClick={() => toggle(winner.group_key)}>
                    {winner.thumbnail_url ? <img src={winner.thumbnail_url} alt="" /> : <div className="concept-thumb" />}
                    <div>
                      <strong>{winner.name || 'Blank concept'}</strong>
                      <span>{spend ? (revenue / spend).toFixed(2) : '0.00'}x ROAS · {money(spend)} spend</span>
                      <span className={transcriptReady ? 'analysis-ready' : 'analysis-missing'}>
                        {transcriptReady
                          ? `${winner.asset_kind === 'video' ? 'Transcript ready · ' : ''}${Number(winner.vision_frame_count) || 1} visual frame${Number(winner.vision_frame_count) === 1 ? '' : 's'}`
                          : 'Transcript missing · re-analyze'}
                      </span>
                    </div>
                    <i>{active ? '✓' : '+'}</i>
                  </button>
                  <button
                    className="concept-winner-delete"
                    type="button"
                    aria-label={`Remove ${winner.name || 'blank concept'} from Concept Studio`}
                    onClick={() => dismissWinner(winner)}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>

          <div className="concept-generate-row">
            <p>{selectedWinners.length ? `${selectedWinners.length} references ready.` : 'Select two to four winners with complementary learnings.'}</p>
            <button onClick={generate} disabled={!selectedWinners.length || generating}>{generating ? 'Building test matrix…' : `Generate ${count} concepts`}</button>
          </div>
          {generateError ? <div className="motion-error">{generateError}</div> : null}

          {concepts.length > 0 ? (
            <>
              <div className="concept-output-head"><div><span>Test matrix</span><strong>{concepts.length} shootable concepts</strong></div><button onClick={sendToResults}>Send scripts to Results</button></div>
              <div className="concept-output-grid">
                {concepts.map((rawConcept, index) => {
                  const concept = rawConcept || {};
                  return (
                  <article className="concept-output" key={`${concept.concept_name || 'blank'}-${index}`}>
                    <div className="concept-number">{String(index + 1).padStart(2, '0')}</div>
                    <button
                      className="concept-delete"
                      type="button"
                      aria-label={`Delete ${concept.concept_name || `concept ${index + 1}`}`}
                      onClick={() => deleteConcept(index)}
                    >
                      Delete
                    </button>
                    <div className="concept-tags">
                      {[concept.product, concept.format, concept.angle].filter(Boolean).map((tag, tagIndex) => <span key={`${tag}-${tagIndex}`}>{tag}</span>)}
                    </div>
                    <h2>{concept.concept_name || 'Blank concept'}</h2>
                    <blockquote>{concept.hook || 'No hook was generated.'}</blockquote>
                    <dl>
                      <div><dt>Hypothesis</dt><dd>{concept.hypothesis || '—'}</dd></div>
                      <div><dt>Keep</dt><dd>{concept.winning_pattern_kept || '—'}</dd></div>
                      <div><dt>Change</dt><dd>{concept.primary_variable || '—'}</dd></div>
                      <div><dt>Opening frame</dt><dd>{concept.opening_visual || '—'}</dd></div>
                    </dl>
                    <details><summary>Proof and shot plan</summary>
                      <h4>Proof sequence</h4><ol>{(concept.proof_sequence || []).map(item => <li key={item}>{item}</li>)}</ol>
                      <h4>Shot list</h4><ol>{(concept.shot_list || []).map(item => <li key={item}>{item}</li>)}</ol>
                    </details>
                    <details><summary>Full script</summary><p className="concept-script">{concept.script}</p></details>
                    <footer><span>Why new: {concept.why_new}</span><span>Risk: {concept.risk}</span></footer>
                  </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </main>
      </div>
      </>
      )}
    </div>
  );
}
