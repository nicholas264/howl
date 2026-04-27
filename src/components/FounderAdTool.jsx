import { useState, useCallback } from 'react';

const SCRIPT_TYPES = [
  { id: 'origin',       label: 'Origin Story',        desc: 'Why four engineers quit to build this' },
  { id: 'manufacturing',label: 'Made in Colorado',     desc: 'The factory, the process, the materials' },
  { id: 'burn_ban',     label: 'Burn Ban Explainer',   desc: 'Why HOWL is legal when everything else isn\'t' },
  { id: 'vs_wood',      label: 'vs. Wood Fire',        desc: 'Head-to-head: why propane wins' },
  { id: 'tech',         label: 'The Technology',       desc: 'A-Flame®, BarCoal®, how it actually works' },
  { id: 'cold_weather', label: 'Cold Weather Story',   desc: '0°F fire. The one that ends the cold.' },
  { id: 'customer_result', label: 'Customer Result',   desc: 'Real review, told through the founder\'s lens' },
];

const PRODUCTS = [
  { id: 'r1',     label: 'R1 — The Fast & Light ($374)',    short: 'R1' },
  { id: 'r4mkii', label: 'R4 MKii — The 4-Season ($1,474)', short: 'R4 MKii' },
  { id: 'both',   label: 'Both Products',                    short: 'R1 + R4 MKii' },
];

const LENGTHS = [
  { id: '30',  label: '30s', words: '~75 words' },
  { id: '60',  label: '60s', words: '~150 words' },
  { id: '90',  label: '90s', words: '~225 words' },
];

const TONES = [
  { id: 'direct',      label: 'Direct & Punchy' },
  { id: 'storyteller', label: 'Storyteller' },
  { id: 'engineer',    label: 'Engineer Nerd' },
  { id: 'fired_up',   label: 'Fired Up / Rally' },
];

function buildFounderPrompt(scriptType, product, length, tone, customContext) {
  const typeMap = {
    origin: 'Origin story — why four engineers decided propane fire pits suck and built HOWL from scratch in Colorado.',
    manufacturing: 'Manufacturing story — the Wheat Ridge, CO factory, 292 parts, 304 stainless steel, aircraft aluminum, brass, zero plastic, zero electronics. Made by hand in America.',
    burn_ban: 'Burn ban explainer — Stage 1 and Stage 2 burn bans are everywhere. Wood fires, charcoal, even most propane fires are banned. HOWL uses A-Flame® technology and is UL Certified legal in Stage II Burn Bans in all 50 states. When everyone else has to put the fire out, HOWL customers still have one.',
    vs_wood: 'Wood fire vs. HOWL — honest comparison. No smoke in your face, no hauling logs, no fire ban worries, instant on/off, same look and feel of a real fire. Not better in every way. Better in the ways that matter when you\'re out there.',
    tech: 'Technology deep-dive — A-Flame® burner: 160 precision micro-emitters producing 32-inch flames on the R1. BarCoal® radiant tubes on the R4 MKii hit 1,300°F, throwing heat you can feel from 8 feet. No fans, no batteries, no electronics. Physics does the work.',
    cold_weather: 'Cold weather performance — the R4 MKii is the "0°F fire." Real radiant heat from BarCoal® tubes. Your thighs get hot before your face does. Made for alpine, high desert, shoulder season, and deep winter.',
    customer_result: 'Real customer result through the founder lens — pick one of these real quotes and build the script around it: "My wife had to back her chair up. That\'s never happened with a propane fire." / "Still had a campfire at 6 degrees." / "Rain. Wind. Altitude. Burn ban. Nothing stops this thing." / "The YETI of campfires exists and it\'s made in Colorado."',
  };

  const productMap = {
    r1: 'R1 ($374) — 11 lbs, shoebox-sized, 32-inch flames, 8 hours on a 20lb tank, 800°F. "Your 40°F Fire." The world\'s most portable campfire.',
    r4mkii: 'R4 MKii ($1,474) — 27 lbs, 1,300+°F, BarCoal® radiant heaters, EchoHeat Reflector Shields. "Your 0°F Fire." The world\'s hottest propane fire pit.',
    both: 'R1 ($374) — the fast-and-light 40°F fire. R4 MKii ($1,474) — the 4-season 0°F fire. Two products, two missions, one brand.',
  };

  const toneMap = {
    direct: 'Direct and punchy. Short sentences. No fluff. Dan Kennedy meets a Colorado engineer.',
    storyteller: 'Warm and personal. Like the founder is sitting across a campfire telling you the story. Pauses. Real moments.',
    engineer: 'Nerdy and specific. Lean into the specs, the process, the "why does this work" details. The audience respects technical honesty.',
    fired_up: 'High energy, rallying. This is a battle cry for people who refuse to camp without a real fire. Passionate and direct.',
  };

  const wordTarget = { '30': 75, '60': 150, '90': 225 }[length];

  return `You are writing a founder-style video ad script for HOWL Campfires. The founder delivers this directly to camera — raw, honest, no production notes.

BRAND FACTS:
- Founded by four engineers who decided propane fire pits suck
- All manufacturing in Wheat Ridge, Colorado (Front Range)
- 938 verified reviews, 90.4% are 5-star
- UL Certified, legal in Stage II Burn Bans in all 50 states
- No plastic. No electronics. No fans. No batteries.
- Materials: 304 stainless steel, aircraft aluminum, brass
- Proprietary tech: BarCoal® (radiant tube heater), A-Flame® (most fuel-efficient flame on earth)
- Brand voice: "More heat. More light. More freedom."
- NEVER use em dashes. Use periods, commas, or ellipses instead.

SCRIPT TYPE: ${typeMap[scriptType]}

PRODUCT FOCUS: ${productMap[product]}

TONE: ${toneMap[tone]}

TARGET LENGTH: ~${wordTarget} words (${length} second ad)

${customContext ? `ADDITIONAL CONTEXT FROM FOUNDER:\n${customContext}\n` : ''}

Write the script as pure spoken word — exactly what the founder says on camera. No production notes, no visual cues, no [B-ROLL] tags, no scene directions. Just the words, spoken naturally.

Structure the script with these labeled sections:
HOOK: (first 1-2 sentences — stop the scroll, create pattern interrupt)
STORY: (the setup, the problem, the why)
PROOF: (the evidence — specs, reviews, real results)
CTA: (close — direct, specific, no "check us out")

Keep each section tight. The whole script should feel like one continuous, natural piece of speech when read aloud.

Respond with ONLY the script. No preamble, no explanation, no markdown formatting other than the section labels.`;
}

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
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: 'You are an elite direct-response copywriter specializing in founder-style video ad scripts for DTC brands.',
          messages: [{ role: 'user', content: buildFounderPrompt(scriptType, product, length, tone, customContext) }],
        }),
      });
      const data = await response.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
      setScript(text.trim());
    } catch {
      setError('Generation failed. Try again.');
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0d1117' }}>
      <div style={{ padding: '20px 28px', borderBottom: '1px solid #2a3441' }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Create</div>
        <div className="display-md" style={{ color: '#f0f4f8' }}>Founder Ads</div>
        <div className="display-italic" style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>
          First-person scripts in your voice — hook, story, proof, CTA.
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1 }}>

      {/* Left config panel */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #2a3441', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>

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
          <div style={S.label}>Founder Notes <span style={{ color: '#6e7681', fontWeight: 400 }}>(optional)</span></div>
          <textarea
            value={customContext}
            onChange={e => setCustomContext(e.target.value)}
            placeholder="Add specific talking points, a story, a customer quote you want included, a promotion, etc."
            rows={4}
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
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f4f8', letterSpacing: 1 }}>
              Founder Ad Script
            </div>
            {selectedType && (
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 3, letterSpacing: 1 }}>
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
          <div style={{ marginBottom: 24, border: '1px solid #2a3441', borderRadius: 6, overflow: 'hidden' }}>
            {saved.map((s, i) => (
              <div key={s.id} style={{ padding: '12px 16px', borderBottom: i < saved.length - 1 ? '1px solid #2a3441' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#f0f4f8', fontWeight: 600, marginBottom: 2 }}>
                    {SCRIPT_TYPES.find(t => t.id === s.scriptType)?.label} · {PRODUCTS.find(p => p.id === s.product)?.short} · {s.length}s
                  </div>
                  <div style={{ fontSize: 9, color: '#8b949e', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {s.script.slice(0, 120)}...
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => { setScript(s.script); setShowSaved(false); }} style={S.microBtn}>Load</button>
                  <button onClick={() => deleteScript(s.id)} style={{ ...S.microBtn, color: '#DC440A' }}>Del</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Script display */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#8b949e', fontSize: 11, padding: '40px 0' }}>
            <div style={S.spinner} />
            Writing your founder script...
          </div>
        )}

        {!loading && !script && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#6e7681', fontSize: 11, letterSpacing: 1 }}>
            Configure your script on the left and hit Write Script.
          </div>
        )}

        {!loading && script && (
          <div>
            {/* Parsed sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 24, border: '1px solid #2a3441', borderRadius: 8, overflow: 'hidden' }}>
              {parseScript(script).map((section, i) => (
                <div key={i} style={{
                  padding: '20px 24px',
                  borderBottom: i < parseScript(script).length - 1 ? '1px solid #2a3441' : 'none',
                  background: section.label === 'HOOK' ? 'rgba(220,68,10,0.07)' : '#161b22',
                }}>
                  <div style={{ fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: section.label === 'HOOK' ? '#DC440A' : '#6e7681', marginBottom: 10, fontWeight: 700 }}>
                    {section.label}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.8, color: '#f0f4f8', fontFamily: "'Instrument Serif', serif" }}>
                    {section.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Word count + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: '#6e7681', letterSpacing: 1 }}>
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
  label: { fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#8b949e', marginBottom: 8, fontWeight: 600 },
  typeBtn: (active) => ({
    padding: '10px 12px', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`,
    background: active ? 'rgba(220,68,10,0.12)' : '#161b22', color: active ? '#f0f4f8' : '#8b949e',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', borderRadius: 4, textAlign: 'left', transition: 'all .15s',
  }),
  optBtn: (active) => ({
    padding: '9px 12px', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`,
    background: active ? 'rgba(220,68,10,0.12)' : '#161b22', color: active ? '#f0f4f8' : '#8b949e',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', borderRadius: 4, textAlign: 'left', transition: 'all .15s',
  }),
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #2a3441', borderRadius: 4, background: '#161b22', color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, lineHeight: 1.6, resize: 'vertical', outline: 'none' },
  generateBtn: (disabled) => ({ padding: '13px 0', background: disabled ? '#2a3441' : '#DC440A', border: 'none', borderRadius: 4, color: disabled ? '#6e7681' : '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer', width: '100%' }),
  error: { padding: '10px 12px', border: '1px solid rgba(220,68,10,0.4)', background: 'rgba(220,68,10,0.12)', color: '#DC440A', fontSize: 11, borderRadius: 4 },
  primaryBtn: { padding: '9px 20px', background: '#DC440A', border: 'none', borderRadius: 4, color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' },
  secondaryBtn: { padding: '9px 16px', background: 'none', border: '1px solid #2a3441', borderRadius: 4, color: '#8b949e', fontFamily: 'inherit', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' },
  actionBtn: (active) => ({ padding: '7px 14px', background: active ? 'rgba(220,68,10,0.12)' : 'none', border: `1px solid ${active ? '#DC440A' : '#2a3441'}`, borderRadius: 4, color: active ? '#DC440A' : '#8b949e', fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }),
  microBtn: { padding: '4px 10px', background: 'none', border: '1px solid #2a3441', borderRadius: 3, color: '#8b949e', fontFamily: 'inherit', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' },
  spinner: { width: 14, height: 14, border: '2px solid #2a3441', borderTopColor: '#DC440A', borderRadius: '50%', animation: 'sp .7s linear infinite', display: 'inline-block' },
};
