import React, { useEffect, useState, useCallback } from 'react';

/**
 * From Winners — pulls analyzed creatives from /api/meta:list_analyzed_winners,
 * lets the user multi-select, then generates new script variations that iterate
 * on the selected winners' patterns. Output is dropped into the same `variations`
 * state used by the existing Results panel so the rest of the pipeline (Image
 * Ads, Video Ads, etc.) is unchanged.
 */
export default function FromWinnersTool({ setActiveTab, setVariations }) {
  const [windowDays, setWindowDays] = useState(30);
  const [winners, setWinners] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [count, setCount] = useState(8);
  const [extraContext, setExtraContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const load = useCallback(async (days) => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_analyzed_winners', sinceDays: days }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setWinners(d.winners || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(windowDays); }, [load, windowDays]);

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const fmtMoney = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const generate = async () => {
    if (selected.size === 0 || !winners) return;
    const refs = winners.filter(w => selected.has(w.group_key));

    const refBlocks = refs.map((r, i) => {
      const lines = [
        `WINNER ${i + 1}: ${r.name || '(unnamed)'}`,
        `Spend: ${fmtMoney(r.spend)} · Revenue: ${fmtMoney(r.purchase_value)} · Purchases: ${r.purchases || 0}`,
        `Format: ${r.format || '—'} · Hook type: ${r.hook_type || '—'} · Angle: ${r.angle || '—'}`,
        r.hook_text_verbatim ? `Hook (verbatim): "${r.hook_text_verbatim}"` : null,
        r.talent_description ? `Talent: ${r.talent_description}` : null,
        r.visual_summary ? `Visual: ${r.visual_summary}` : null,
        r.why_it_worked ? `Why it worked: ${r.why_it_worked}` : null,
        r.transcript ? `Full script:\n${r.transcript}` : null,
      ].filter(Boolean);
      return lines.join('\n');
    }).join('\n\n---\n\n');

    const systemPrompt = `You write Meta ad scripts for HOWL Campfires (smokeless propane fire pits — R1, R4 MKii). You're given proven winners from the brand's account with their performance and structural breakdowns. Generate NEW script variations that iterate on these patterns.

Rules:
- Match HOWL's voice: direct, masculine, outdoor, no fluff, no AI tells.
- Never use em dashes (— or –) anywhere.
- Don't use "It's not X, it's Y" antithesis or other LLM tells.
- Each variation should pull from the winners' DNA but feel fresh — not paraphrased.
- If multiple winners are referenced, blend their patterns intentionally (e.g. winner A's hook style on winner B's angle).
- Vary product, hook, angle, talent type across the set.

Output ONLY a valid JSON array. Each element:
{
  "hook": "the spoken/on-screen opening line",
  "script": "full script — pure spoken word, no production notes, no visual cues",
  "product": "r1 | r4mkii | other",
  "angle": "short label",
  "format": "ugc-talking-head | ugc-product-demo | studio-product | founder | callout-graphic | review-collage | static-image",
  "inspired_by": "1 short sentence naming which winner(s) and what you pulled forward"
}

No prose outside the array. No markdown fences.`;

    const userPrompt = `Generate ${count} new script variations.

REFERENCE WINNERS:

${refBlocks}

${extraContext ? `\nADDITIONAL CONTEXT FROM USER:\n${extraContext}\n` : ''}
Now write ${count} new variations that iterate on the patterns above.`;

    setGenerating(true); setGenerateError('');
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message || data.error);
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const cleaned = text.replace(/```json|```/g, '').trim();
      const variations = JSON.parse(cleaned);
      setVariations(variations);
      setActiveTab('results');
    } catch (err) { setGenerateError(err.message); }
    finally { setGenerating(false); }
  };

  return (
    <div style={{ padding: '28px 36px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f0f4f8', margin: 0 }}>From Winners</h2>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
            Select analyzed creatives, then generate iterations that pull from their DNA.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setWindowDays(d)} disabled={loading} style={{
              padding: '5px 10px',
              background: windowDays === d ? 'rgba(220,68,10,0.15)' : 'none',
              border: `1px solid ${windowDays === d ? '#DC440A' : '#2a3441'}`,
              color: windowDays === d ? '#DC440A' : '#8b949e',
              fontFamily: 'inherit', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
              cursor: loading ? 'not-allowed' : 'pointer', borderRadius: 3,
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {error && <div style={{ padding: '8px 12px', border: '1px solid rgba(248,81,73,0.4)', background: 'rgba(248,81,73,0.08)', color: '#f85149', fontSize: 11, borderRadius: 4, marginBottom: 16 }}>{error}</div>}

      {loading && !winners && (
        <div style={{ fontSize: 12, color: '#8b949e', padding: 24 }}>Loading…</div>
      )}

      {winners && winners.length === 0 && (
        <div style={{ padding: 24, border: '1px solid #2a3441', borderRadius: 4, color: '#8b949e', fontSize: 12, marginTop: 18 }}>
          No analyzed creatives yet. Go to <strong style={{ color: '#DC440A' }}>Insights → Creative Analytics</strong>, click <strong>Analyze</strong> on a few high-performing rows, then come back here.
        </div>
      )}

      {winners && winners.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14, marginTop: 18, marginBottom: 28 }}>
            {winners.map(w => {
              const isOn = selected.has(w.group_key);
              return (
                <div key={w.group_key} onClick={() => toggle(w.group_key)} style={{
                  padding: 14, borderRadius: 6, cursor: 'pointer',
                  background: isOn ? 'rgba(220,68,10,0.06)' : '#0d1117',
                  border: `1px solid ${isOn ? '#DC440A' : '#2a3441'}`,
                  transition: 'border-color 0.15s, background 0.15s',
                }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    {w.thumbnail_url
                      ? <img src={w.thumbnail_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#1c2330' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      : <div style={{ width: 48, height: 48, background: '#1c2330', borderRadius: 4, flexShrink: 0 }} />
                    }
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: '#f0f4f8', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name || '(unnamed)'}</div>
                      <div style={{ display: 'flex', gap: 10, fontSize: 9.5, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>
                        <span style={{ color: '#3fb950', fontWeight: 700 }}>{fmtMoney(w.purchase_value)}</span>
                        <span>{fmtMoney(w.spend)} spend</span>
                      </div>
                    </div>
                    <div style={{
                      width: 18, height: 18, flexShrink: 0, borderRadius: 3,
                      background: isOn ? '#DC440A' : 'transparent',
                      border: `1px solid ${isOn ? '#DC440A' : '#3a4452'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, color: '#0d1117', fontWeight: 700,
                    }}>{isOn ? '✓' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {w.hook_type && <span style={pillStyle}>{w.hook_type}</span>}
                    {w.format && <span style={pillStyle}>{w.format}</span>}
                    {w.angle && <span style={{ ...pillStyle, background: 'rgba(63,185,80,0.1)', borderColor: 'rgba(63,185,80,0.4)', color: '#3fb950' }}>{w.angle}</span>}
                  </div>
                  {w.hook_text_verbatim && (
                    <div style={{ fontSize: 11, color: '#c9d1d9', fontStyle: 'italic', lineHeight: 1.4, marginBottom: 8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      "{w.hook_text_verbatim}"
                    </div>
                  )}
                  {w.why_it_worked && (
                    <div style={{ fontSize: 10.5, color: '#8b949e', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {w.why_it_worked}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ position: 'sticky', bottom: 0, background: '#0d1117', borderTop: '1px solid #2a3441', padding: '16px 0', marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>
                {selected.size === 0 ? 'Select winners to generate from' : `${selected.size} selected`}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#8b949e', letterSpacing: 1, textTransform: 'uppercase' }}>
                Variations
                <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 8)))} style={{
                  width: 56, padding: '4px 8px', background: '#1c2330', border: '1px solid #2a3441',
                  color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11, borderRadius: 3,
                }} />
              </label>
              <button onClick={generate} disabled={selected.size === 0 || generating} style={{
                padding: '8px 18px', fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700,
                background: selected.size > 0 && !generating ? '#DC440A' : 'rgba(220,68,10,0.2)',
                border: '1px solid #DC440A', color: selected.size > 0 && !generating ? '#fff' : 'rgba(255,255,255,0.5)',
                fontFamily: 'inherit', borderRadius: 3, cursor: selected.size > 0 && !generating ? 'pointer' : 'not-allowed',
                marginLeft: 'auto',
              }}>
                {generating ? 'Generating…' : `Generate ${count} variations`}
              </button>
            </div>
            <textarea
              placeholder="Optional: extra context (e.g. 'focus on R4 launch', 'lean into burn-ban angle for summer')"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              rows={2}
              style={{
                width: '100%', marginTop: 10, padding: '8px 10px',
                background: '#1c2330', border: '1px solid #2a3441',
                color: '#f0f4f8', fontFamily: 'inherit', fontSize: 11.5, lineHeight: 1.5,
                borderRadius: 3, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            {generateError && <div style={{ fontSize: 11, color: '#f85149', marginTop: 8 }}>{generateError}</div>}
          </div>
        </>
      )}
    </div>
  );
}

const pillStyle = {
  display: 'inline-block', padding: '2px 7px', fontSize: 8.5, letterSpacing: 1.2, textTransform: 'uppercase',
  background: 'rgba(220,68,10,0.1)', border: '1px solid rgba(220,68,10,0.4)', color: '#DC440A',
  borderRadius: 3, fontWeight: 600,
};
