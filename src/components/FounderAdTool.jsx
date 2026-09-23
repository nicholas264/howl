import { apiFetch as fetch } from '../lib/apiFetch.js';
import { useState, useCallback } from 'react';

const SCRIPT_TYPES = [
  { id: 'origin',       label: 'Origin Story',        desc: 'The problem that led to HOWL' },
  { id: 'manufacturing',label: 'Made in Colorado',     desc: 'The factory, the process, the materials' },
  { id: 'burn_ban',     label: 'Burn Ban Explainer',   desc: 'Campfires where local rules permit propane' },
  { id: 'vs_wood',      label: 'vs. Wood Fire',        desc: 'Head-to-head: why propane wins' },
  { id: 'tech',         label: 'The Technology',       desc: 'A-Flame®, BarCoal®, how it actually works' },
  { id: 'cold_weather', label: 'Cold Weather Story',   desc: 'Choose the right model for the season' },
  { id: 'customer_result', label: 'Customer Result',   desc: 'Real review, told through the founder\'s lens' },
];

const PRODUCTS = [
  { id: 'r1', label: 'R1 — Warm-season portability', short: 'R1' },
  { id: 'r3', label: 'R3 — Three-season radiant warmth', short: 'R3' },
  { id: 'r4mkii', label: 'R4 MKii — Four-season radiant warmth', short: 'R4 MKii' },
  { id: 'both', label: 'R1 + R4 MKii', short: 'R1 + R4 MKii' },
  { id: 'all', label: 'Compare the lineup', short: 'R1 + R3 + R4 MKii' },
];

const LENGTHS = [
  { id: '30',  label: '30s', words: '~66 words' },
  { id: '60',  label: '60s', words: '~132 words' },
  { id: '90',  label: '90s', words: '~198 words' },
];

const TONES = [
  { id: 'direct',      label: 'Direct & Punchy' },
  { id: 'storyteller', label: 'Storyteller' },
  { id: 'engineer',    label: 'Engineer Nerd' },
  { id: 'fired_up',   label: 'Fired Up / Rally' },
];

export default function FounderAdTool() {
  const [scriptType, setScriptType] = useState('origin');
  const [product, setProduct] = useState('r1');
  const [length, setLength] = useState('60');
  const [tone, setTone] = useState('direct');
  const [customContext, setCustomContext] = useState('');
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('howl_founder_scripts') || '[]'); } catch { return []; }
  });
  const [showSaved, setShowSaved] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError('');
    setScript('');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          task: 'founder_script',
          brief: { scriptType, product, length, tone, customContext },
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error?.message || data.error || 'Generation failed. Try again.');
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      if (!text.trim()) throw new Error('No script was returned. Try again.');
      setScript(text.trim());
    } catch (err) {
      setError(err.message || 'Generation failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const copy = useCallback(() => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [script]);

  const saveScript = useCallback(() => {
    const entry = {
      id: Date.now(),
      scriptType,
      product,
      length,
      tone,
      script,
      savedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
    const next = [entry, ...saved].slice(0, 20);
    setSaved(next);
    try { localStorage.setItem('howl_founder_scripts', JSON.stringify(next)); } catch {}
  }, [script, scriptType, product, length, tone, saved]);

  const deleteScript = useCallback((id) => {
    const next = saved.filter(s => s.id !== id);
    setSaved(next);
    try { localStorage.setItem('howl_founder_scripts', JSON.stringify(next)); } catch {}
  }, [saved]);

  const selectedType = SCRIPT_TYPES.find(t => t.id === scriptType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fff' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid #dedbd3' }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Create</div>
        <div className="display-md" style={{ color: '#171717' }}>Founder Ads</div>
        <div className="display-italic" style={{ fontSize: 13, color: '#77746f', marginTop: 4 }}>
          First-person scripts in your voice — hook, story, proof, CTA.
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1 }}>

      {/* Left config panel */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #dedbd3', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>

        {/* Script Type */}
        <div>
          <div style={S.label}>Script Type</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {SCRIPT_TYPES.map(t => (
              <button key={t.id} onClick={() => setScriptType(t.id)} style={S.typeBtn(scriptType === t.id)}>
                <div style={{ fontWeight: 600, fontSize: 11 }}>{t.label}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Product */}
        <div>
          <div style={S.label}>Product</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {PRODUCTS.map(p => (
              <button key={p.id} onClick={() => setProduct(p.id)} style={S.optBtn(product === p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Length */}
        <div>
          <div style={S.label}>Length</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {LENGTHS.map(l => (
              <button key={l.id} onClick={() => setLength(l.id)} style={{ ...S.optBtn(length === l.id), flex: 1, textAlign: 'center' }}>
                <div style={{ fontWeight: 600 }}>{l.label}</div>
                <div style={{ fontSize: 8, marginTop: 1, opacity: 0.7 }}>{l.words}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Tone */}
        <div>
          <div style={S.label}>Founder Tone</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TONES.map(t => (
              <button key={t.id} onClick={() => setTone(t.id)} style={S.optBtn(tone === t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom context */}
        <div>
          <div style={S.label}>Founder Notes <span style={{ color: '#88857f', fontWeight: 400 }}>(optional)</span></div>
          <textarea
            value={customContext}
            onChange={e => setCustomContext(e.target.value)}
            placeholder="Add specific talking points, a story, a customer quote you want included, a promotion, etc."
            rows={4}
            maxLength={6000}
            style={S.textarea}
          />
        </div>

        <button onClick={generate} disabled={loading} style={S.generateBtn(loading)}>
          {loading ? 'Writing Script...' : 'Write Script →'}
        </button>

        {error && <div style={S.error}>{error}</div>}

      </div>

      {/* Right — script output */}
      <div style={{ flex: 1, padding: '28px 36px', overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#171717', letterSpacing: 1 }}>
              Founder Ad Script
            </div>
            {selectedType && (
              <div style={{ fontSize: 10, color: '#77746f', marginTop: 3, letterSpacing: 1 }}>
                {selectedType.label} · {PRODUCTS.find(p => p.id === product)?.short} · {length}s · {TONES.find(t => t.id === tone)?.label}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {saved.length > 0 && (
              <button onClick={() => setShowSaved(!showSaved)} style={S.actionBtn(showSaved)}>
                Saved ({saved.length})
              </button>
            )}
          </div>
        </div>

        {/* Saved scripts drawer */}
        {showSaved && saved.length > 0 && (
          <div style={{ marginBottom: 24, border: '1px solid #dedbd3', borderRadius: 6, overflow: 'hidden' }}>
            {saved.map((s, i) => (
              <div key={s.id} style={{ padding: '12px 16px', borderBottom: i < saved.length - 1 ? '1px solid #dedbd3' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#171717', fontWeight: 600, marginBottom: 2 }}>
                    {SCRIPT_TYPES.find(t => t.id === s.scriptType)?.label} · {PRODUCTS.find(p => p.id === s.product)?.short} · {s.length}s
                  </div>
                  <div style={{ fontSize: 9, color: '#77746f', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {s.script.slice(0, 120)}...
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => { setScript(s.script); setShowSaved(false); }} style={S.microBtn}>Load</button>
                  <button onClick={() => deleteScript(s.id)} style={{ ...S.microBtn, color: '#d84a17' }}>Del</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Script display */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#77746f', fontSize: 11, padding: '40px 0' }}>
            <div style={S.spinner} />
            Writing your founder script...
          </div>
        )}

        {!loading && !script && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#88857f', fontSize: 11, letterSpacing: 1 }}>
            Configure your script on the left and hit Write Script.
          </div>
        )}

        {!loading && script && (
          <div>
            {/* Parsed sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 24, border: '1px solid #dedbd3', borderRadius: 8, overflow: 'hidden' }}>
              {parseScript(script).map((section, i) => (
                <div key={i} style={{
                  padding: '20px 24px',
                  borderBottom: i < parseScript(script).length - 1 ? '1px solid #dedbd3' : 'none',
                  background: section.label === 'HOOK' ? 'rgba(220,68,10,0.07)' : '#fff',
                }}>
                  <div style={{ fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: section.label === 'HOOK' ? '#d84a17' : '#88857f', marginBottom: 10, fontWeight: 700 }}>
                    {section.label}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.8, color: '#171717', fontFamily: "'Instrument Serif', serif" }}>
                    {section.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Word count + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: '#88857f', letterSpacing: 1 }}>
                {script.split(/\s+/).filter(Boolean).length} words · ~{Math.round(script.split(/\s+/).filter(Boolean).length / 2.5)}s read time
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveScript} style={S.secondaryBtn}>Save Script</button>
                <button onClick={copy} style={S.primaryBtn}>{copied ? 'Copied!' : 'Copy Script'}</button>
                <button onClick={generate} style={S.secondaryBtn}>Regenerate</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function parseScript(raw) {
  const sectionLabels = ['HOOK', 'STORY', 'PROOF', 'CTA'];
  const sections = [];
  let remaining = raw.trim();

  for (let i = 0; i < sectionLabels.length; i++) {
    const label = sectionLabels[i];
    const nextLabel = sectionLabels[i + 1];
    const startRegex = new RegExp(`^${label}:?\\s*`, 'im');
    const match = remaining.match(startRegex);
    if (!match) continue;

    const start = match.index + match[0].length;
    let end = remaining.length;

    if (nextLabel) {
      const nextMatch = remaining.slice(start).match(new RegExp(`^${nextLabel}:?\\s*`, 'im'));
      if (nextMatch) end = start + nextMatch.index;
    }

    sections.push({ label, text: remaining.slice(start, end).trim() });
  }

  // If parsing failed (no section labels), show raw
  if (sections.length === 0) {
    sections.push({ label: 'SCRIPT', text: raw.trim() });
  }

  return sections;
}

const S = {
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#77746f', marginBottom: 8, fontWeight: 600 },
  typeBtn: (active) => ({
    padding: '10px 12px', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`,
    background: active ? 'rgba(220,68,10,0.12)' : '#fff', color: active ? '#171717' : '#77746f',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', borderRadius: 4, textAlign: 'left', transition: 'all .15s',
  }),
  optBtn: (active) => ({
    padding: '9px 12px', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`,
    background: active ? 'rgba(220,68,10,0.12)' : '#fff', color: active ? '#171717' : '#77746f',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', borderRadius: 4, textAlign: 'left', transition: 'all .15s',
  }),
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dedbd3', borderRadius: 4, background: '#fff', color: '#171717', fontFamily: 'inherit', fontSize: 11, lineHeight: 1.6, resize: 'vertical', outline: 'none' },
  generateBtn: (disabled) => ({ padding: '13px 0', background: disabled ? '#dedbd3' : '#d84a17', border: 'none', borderRadius: 4, color: disabled ? '#88857f' : '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%' }),
  error: { padding: '10px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.12)', color: '#d84a17', fontSize: 11, borderRadius: 4 },
  primaryBtn: { padding: '9px 20px', background: '#d84a17', border: 'none', borderRadius: 4, color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' },
  secondaryBtn: { padding: '9px 16px', background: 'none', border: '1px solid #dedbd3', borderRadius: 4, color: '#77746f', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' },
  actionBtn: (active) => ({ padding: '7px 14px', background: active ? 'rgba(220,68,10,0.12)' : 'none', border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`, borderRadius: 4, color: active ? '#d84a17' : '#77746f', fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }),
  microBtn: { padding: '4px 10px', background: 'none', border: '1px solid #dedbd3', borderRadius: 3, color: '#77746f', fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' },
  spinner: { width: 14, height: 14, border: '2px solid #dedbd3', borderTopColor: '#d84a17', borderRadius: '50%', animation: 'sp .7s linear infinite', display: 'inline-block' },
};
