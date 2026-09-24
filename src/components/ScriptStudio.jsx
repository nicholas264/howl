import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiFetch.js';
import './ScriptStudio.css';

const PRODUCTS = [['r1', 'R1', 'Warm-season portability'], ['r3', 'R3', 'Three-season radiant warmth'], ['r4mkii', 'R4 MKii', 'Four-season radiant warmth'], ['all', 'Compare the lineup', 'Help campers choose']];
const STORAGE = 'howl_script_studio_v1';
function readCurrent() { try { const v = JSON.parse(sessionStorage.getItem('howl_script_studio_current') || 'null'); return v?.result?.script && Array.isArray(v.result.hooks) && Array.isArray(v.result.shot_list) && Array.isArray(v.result.guardrails) && v.brief && v.resultBrief ? v : null; } catch { return null; } }
const defaults = { product: 'r1', startingPoint: 'fresh', delivery: 'founder', duration: 30, creatorId: '', notes: '', references: '', iteration: 'controlled' };
function readSaved() { try { const v = JSON.parse(localStorage.getItem(STORAGE) || '[]'); return Array.isArray(v) ? v.filter(x => x?.result?.script && x?.brief && Array.isArray(x.result.hooks) && Array.isArray(x.result.shot_list) && Array.isArray(x.result.guardrails)).slice(0, 30) : []; } catch { return []; } }
async function request(url, body) {
  const response = await apiFetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || data.error || 'The request failed. Please try again.');
  return data;
}
function documentText(result) {
  return `${result.title}\n\n${result.script}\n\nANGLE\n${result.angle}\n\nAPPROACH\n${result.strategy}\n\nALTERNATE OPENINGS\n${result.hooks.map(h => `${h.spoken}\n${h.next_line}\nVisual: ${h.visual}\nOn-screen: ${h.on_screen}`).join('\n\n')}\n\nSHOT LIST\n${result.shot_list.map(s => `${s.time}: ${s.visual}\nOn-screen: ${s.on_screen}`).join('\n\n')}\n\nPRODUCTION NOTES\n${result.guardrails.join('\n')}`;
}
function winnerEvidence(w) {
  return { name: w.name, group_key: w.group_key, product: w.product, spend: w.spend, purchases: w.purchases, revenue: w.purchase_value, hook: w.hook_text_verbatim, angle: w.angle, format: w.format, transcript: w.transcription_status === 'complete' ? w.transcript : null, transcript_status: w.transcription_status, visual_summary: w.visual_summary, analysis: w.structured_analysis, evidence: w.evidence, operator_summary: w.operator_summary, caveat: 'Shared-media descriptive results, not causal proof; last 30 days. Missing transcripts do not establish spoken copy.' };
}

export default function ScriptStudio({ initialCreatorId, initialDelivery = 'founder', initialStartingPoint = 'fresh', onOpenCreator, setActiveTab, setVariations }) {
  const [restored] = useState(() => { const current = readCurrent(); return initialStartingPoint === 'fresh' && (!initialCreatorId || Number(current?.resultBrief?.creatorId) === Number(initialCreatorId)) ? current : null; });
  const [brief, setBrief] = useState(() => restored?.brief || ({ ...defaults, delivery: initialCreatorId ? 'creator' : initialDelivery, creatorId: initialCreatorId || '', startingPoint: initialStartingPoint }));
  const [result, setResult] = useState(restored?.result || null);
  const [resultBrief, setResultBrief] = useState(restored?.resultBrief || null);
  const [creators, setCreators] = useState([]);
  const [creatorError, setCreatorError] = useState('');
  const [winners, setWinners] = useState([]);
  const [winnerError, setWinnerError] = useState('');
  const [loadingWinners, setLoadingWinners] = useState(false);
  const [selected, setSelected] = useState(restored?.selected || []);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedBriefId, setSavedBriefId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(readSaved);
  const [legacy] = useState(() => { try { const v = JSON.parse(localStorage.getItem('howl_founder_scripts') || '[]'); return Array.isArray(v) ? v.filter(x => typeof x?.script === 'string') : []; } catch { return []; } });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    request('/api/creators').then(data => { if (active) setCreators(data.creators || []); }).catch(e => { if (active) setCreatorError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (brief.startingPoint !== 'winner') return;
    let active = true;
    setLoadingWinners(true); setWinnerError('');
    request('/api/meta', { action: 'list_analyzed_winners', sinceDays: 30 }).then(data => {
      if (!active) return;
      setWinners(data.winners || []);
      try {
        const carried = JSON.parse(sessionStorage.getItem('howl:selected-winners') || '[]');
        if (Array.isArray(carried) && carried.length) {
          setSelected(carried.filter(key => (data.winners || []).some(w => w.group_key === key)).slice(0, 3));
          sessionStorage.removeItem('howl:selected-winners');
        }
      } catch {}
    }).catch(e => { if (active) setWinnerError(e.message); }).finally(() => { if (active) setLoadingWinners(false); });
    return () => { active = false; };
  }, [brief.startingPoint]);
  useEffect(() => {
    if (!result || !resultBrief) return;
    try { sessionStorage.setItem('howl_script_studio_current', JSON.stringify({ brief, result, resultBrief, selected })); } catch {}
  }, [brief, result, resultBrief, selected]);
  const change = (key, value) => setBrief(current => ({ ...current, [key]: value }));
  async function generate(event) {
    event.preventDefault(); setError(''); setNotice('');
    const picked = winners.filter(w => selected.includes(w.group_key));
    const references = [picked.length ? JSON.stringify(picked.map(winnerEvidence)) : '', brief.references].filter(Boolean).join('\n\n');
    if (brief.startingPoint === 'winner' && !references.trim()) { setError('Select a winning ad or paste a reference.'); return; }
    if (references.length > 40000) { setError('These references are too long. Select fewer ads or shorten the pasted reference.'); return; }
    const submitted = { ...brief, references: brief.startingPoint === 'winner' ? references : '' };
    setBusy(true);
    try {
      const data = await request('/api/generate', { task: 'script_studio', brief: submitted, max_tokens: 5000 });
      if (mounted.current) { setResult(data.script); setResultBrief(submitted); setSavedBriefId(null); setNotice('Script ready. Review and edit the spoken copy below.'); }
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access failed. Select and copy the script text instead.'); } }
  function saveLocal() {
    const entry = { id: crypto.randomUUID(), result, brief: resultBrief, savedAt: new Date().toISOString() };
    const next = [entry, ...saved].slice(0, 30);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); setSaved(next); setNotice('Saved on this browser.'); } catch { setError('Browser storage is full or unavailable. Download the script to keep it.'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([documentText(result)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'howl-script.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveCreator() {
    setSaving(true); setError('');
    try {
      const data = await request('/api/creator-workflow', { action: 'save_studio_script', creator_id: resultBrief.creatorId, product: resultBrief.product, script: result });
      if (mounted.current) { setSavedBriefId(data.brief.id); setNotice('Saved to the creator’s briefs and Creative Board.'); }
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setSaving(false); }
  }
  const wordCount = result?.script.trim().split(/\s+/).filter(Boolean).length || 0;
  return <div className="script-studio">
    <header className="ss-heading"><div><h1>Script Studio</h1><p>One product. One clear reason to care. A script ready to shoot.</p></div><span>HOWL creative</span></header>
    <div className="ss-layout">
      <aside className="ss-brief"><form onSubmit={generate}>
        <fieldset disabled={busy || saving}><legend>Your brief</legend>
          <label>Product<select value={brief.product} onChange={e => change('product', e.target.value)}>{PRODUCTS.map(([id, name, hint]) => <option key={id} value={id}>{name} · {hint}</option>)}</select></label>
          <label>Start from<select value={brief.startingPoint} onChange={e => change('startingPoint', e.target.value)}><option value="fresh">A fresh idea</option><option value="winner">A winning ad</option><option value="brief">My own brief</option></select></label>
          {brief.startingPoint === 'winner' && <div className="ss-references">
            <p>Choose up to three analyzed ads, or paste a reference below.</p>
            {loadingWinners && <p role="status">Loading winning ads…</p>}
            {winnerError && <p className="ss-help">Could not load ads: {winnerError} You can still paste a reference.</p>}
            {!loadingWinners && !winnerError && !winners.length && <p>No analyzed winners available. Paste an ad and its evidence below.</p>}
            <div className="ss-winner-list">{winners.map(w => <label key={w.group_key}><input type="checkbox" checked={selected.includes(w.group_key)} disabled={!selected.includes(w.group_key) && selected.length >= 3} onChange={e => setSelected(s => e.target.checked ? [...s, w.group_key] : s.filter(k => k !== w.group_key))} /><span>{w.name || 'Untitled ad'}<small>{w.angle || w.format || 'Analyzed creative'} · {Number(w.purchases) || 0} purchases</small></span></label>)}</div>
            <label>Reference script and results<textarea rows={4} maxLength={30000} value={brief.references} onChange={e => change('references', e.target.value)} placeholder="Paste the ad, what worked, and any results you have." /></label>
            <label>Iteration approach<select value={brief.iteration} onChange={e => change('iteration', e.target.value)}><option value="controlled">Change one variable</option><option value="crossbreed">Combine reference ideas</option><option value="frontier">Explore an adjacent angle</option></select></label>
          </div>}
          <label>Who delivers it?<select value={brief.delivery} onChange={e => change('delivery', e.target.value)}><option value="founder">Founder</option><option value="creator">A specific creator</option><option value="voiceover">Voiceover</option></select></label>
          {brief.delivery === 'creator' && <><label>Creator<select required value={brief.creatorId} onChange={e => change('creatorId', e.target.value)}><option value="">Choose a creator</option>{initialCreatorId && !creators.some(c => Number(c.id) === Number(initialCreatorId)) && <option value={initialCreatorId}>Selected creator #{initialCreatorId}</option>}{creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{creatorError && <p className="ss-help">Could not load the creator list: {creatorError}</p>}<p className="ss-help">Uses their saved niche, strengths, and audience context.</p></>}
          <label>Length<select value={brief.duration} onChange={e => change('duration', Number(e.target.value))}>{[30,60,90].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label>
          <label>{brief.startingPoint === 'brief' ? 'Your brief' : 'Direction (optional)'}<textarea rows={6} required={brief.startingPoint === 'brief'} maxLength={6000} value={brief.notes} onChange={e => change('notes', e.target.value)} placeholder="Who is this for? Add an angle, offer, founder story, real quote, or available footage." /></label>
          <button className="ss-generate" type="submit">{busy ? 'Writing your script…' : result ? 'Generate another script' : 'Generate script'}</button>
        </fieldset>
      </form>
      <details className="ss-library"><summary>Saved on this browser ({saved.length + legacy.length})</summary>
        {saved.map(item => <div key={item.id}><button type="button" disabled={busy || saving} onClick={() => { setBrief({ ...defaults, ...item.brief }); setSelected([]); setResult(item.result); setResultBrief(item.brief); setSavedBriefId(null); setNotice('Opened saved script.'); }}>{item.result.title}<small>{new Date(item.savedAt).toLocaleDateString()}</small></button></div>)}
        {legacy.map((item, i) => <details key={`legacy-${i}`}><summary>Founder: {item.product || 'HOWL'} · {item.savedAt}</summary><p className="ss-legacy">{item.script}</p><button type="button" onClick={() => copy(item.script)}>Copy saved founder script</button></details>)}
        {!saved.length && !legacy.length && <p>Save a finished script here, or download it to keep a copy.</p>}
      </details></aside>
      <section className="ss-output" aria-label="Script workspace" aria-busy={busy}>
        {error && <p className="ss-error" role="alert">{error}</p>}
        <p className="ss-notice" role="status">{busy ? 'Building the hook, argument, and filming plan…' : notice}</p>
        {!result ? <div className="ss-empty"><h2>Start with the campfire.</h2><p>Choose a product and the writer will use its actual strengths, the right persuasion structure, and a voice that fits the speaker.</p><ul><li>A complete spoken script</li><li>Three connected alternate openings</li><li>A practical shot list and creative rationale</li></ul></div> : <>
          <div className="ss-result-heading"><div><h2>{result.title}</h2><p>{PRODUCTS.find(p => p[0] === resultBrief.product)?.[1]} · {resultBrief.delivery} · {resultBrief.duration}s target</p></div><span>{wordCount} words · ~{Math.round(wordCount / 2.2)}s read</span></div>
          <label className="ss-script-label">Spoken script<textarea className="ss-script" disabled={busy || saving} value={result.script} maxLength={12000} onChange={e => { setResult(r => ({ ...r, script: e.target.value })); setSavedBriefId(null); }} /></label>
          <div className="ss-actions"><button onClick={() => copy(result.script)}>Copy script</button><button onClick={download}>Download full brief</button><button disabled={!result.script.trim() || busy} onClick={saveLocal}>Save on this browser</button><button onClick={() => { setVariations([{ hook: result.hooks[0]?.spoken || result.title, script: result.script, product: resultBrief.product, angle: result.angle, concept_name: result.title, format: resultBrief.delivery, shot_list: result.shot_list.map(s => `${s.time}: ${s.visual}`) }]); setActiveTab('results'); }}>Send to Results</button></div>
          {resultBrief.creatorId && <div className="ss-creator-save"><button disabled={busy || saving || !!savedBriefId || !result.script.trim()} onClick={saveCreator}>{saving ? 'Saving brief…' : savedBriefId ? 'Saved to creator' : 'Save to creator briefs'}</button>{savedBriefId && <button onClick={() => onOpenCreator?.(Number(resultBrief.creatorId), 'briefs')}>Open creator briefs</button>}</div>}
          <details className="ss-detail" open><summary>Alternate openings</summary><p>Each opening includes its next line. Check the transition into your edited body before filming.</p>{result.hooks.map((h,i) => <article className="ss-hook" key={i}><h3>Opening {i+1}</h3><blockquote>{h.spoken}</blockquote><p>{h.next_line}</p><small>Visual: {h.visual}<br />On-screen: {h.on_screen}</small></article>)}</details>
          <details className="ss-detail"><summary>Shot list</summary><div className="ss-table"><table><thead><tr><th>Time</th><th>Visual</th><th>On-screen</th></tr></thead><tbody>{result.shot_list.map((s,i) => <tr key={i}><td>{s.time}</td><td>{s.visual}</td><td>{s.on_screen}</td></tr>)}</tbody></table></div></details>
          <details className="ss-detail"><summary>Why this script</summary><h3>{result.angle}</h3><p>{result.strategy}</p>{result.guardrails.length > 0 && <><h3>Before filming</h3><ul>{result.guardrails.map((g,i) => <li key={i}>{g}</li>)}</ul></>}</details>
        </>}
      </section>
    </div>
  </div>;
}
