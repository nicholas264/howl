import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

function parseJson(value) {
  return JSON.parse(value.replace(/```json|```/g, '').trim());
}

function editBrief(mode, targetDuration, variantIntent) {
  const target = Number(targetDuration || 0);
  const targetLine = target > 0
    ? `Aim for roughly ${target} seconds of kept dialogue if the transcript has enough useful material.`
    : 'Keep the strongest usable ad dialogue without forcing an arbitrary length.';
  const angleLine = variantIntent
    ? `Prioritize a ${String(variantIntent).replaceAll('_', ' ')} ad angle.`
    : 'Prioritize the strongest direct-response ad angle.';
  if (mode === 'tighten') {
    return `${targetLine}
Remove repeated setup, soft qualifiers, long pivots, weak asides, and any sentence that does not help the ad move faster.
Preserve the clearest hook, product proof, objection handling, and CTA.`;
  }
  if (mode === 'punchy') {
    return `${targetLine}
Build a punchy short-form cut: keep the strongest opening claim, vivid product moments, emotional proof, and a clean CTA.
Remove slow preamble, meandering context, hedging, and anything that delays the first concrete benefit.`;
  }
  if (mode === 'variant') {
    return `${targetLine}
${angleLine}
Keep only words that support that angle. Remove good-but-off-angle sections if they weaken the variant.`;
  }
  return `Remove only clear filler words, repeated false starts, accidental duplicate phrases, and abandoned takes.
Never remove product claims, proof, transitions, objections, offers, calls to action, or words needed for grammatical meaning.`;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const sessionId = Number(req.body?.session_id);
  const mode = ['cleanup', 'tighten', 'punchy', 'variant'].includes(req.body?.mode)
    ? req.body.mode
    : 'cleanup';
  const targetDuration = Number(req.body?.target_duration || 0);
  const variantIntent = req.body?.variant_intent || '';
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const [session] = await sql`
      SELECT id, words
      FROM ugc_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const words = Array.isArray(session.words) ? session.words : [];
    if (!words.length) return res.status(400).json({ error: 'Transcribe the footage before using AI cleanup' });
    if (words.length > 2500) {
      return res.status(400).json({ error: 'AI cleanup supports transcripts up to 2,500 words' });
    }

    const indexedTranscript = words
      .map((word, index) => {
        const start = Number(word.start || 0).toFixed(2);
        const end = Number(word.end || word.start || 0).toFixed(2);
        return `${index} [${start}-${end}s]: ${(word.word || '').toString().trim()}`;
      })
      .join('\n');
    const instruction = editBrief(mode, targetDuration, variantIntent);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1600,
        temperature: 0,
        system: `You are an expert direct-response UGC dialogue editor.
You receive an indexed word transcript with timestamps and return the exact word indexes to remove.
Never invent words or rewrite the transcript.
Keep speech grammatical by preserving all required connector words when a sentence remains.
The editor will show every proposed cut to a human before rendering.
Return only valid JSON with:
{"remove_indexes":[integer],"summary":"one short sentence","editor_note":"one short phrase naming the cut strategy"}`,
        messages: [{
          role: 'user',
          content: `Edit mode: ${mode}
${instruction}

Return remove_indexes only. The kept words should play as a coherent UGC ad.

${indexedTranscript}`,
        }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'AI cleanup failed');
    const raw = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
    const parsed = parseJson(raw);
    const removeIndexes = [...new Set(
      (Array.isArray(parsed.remove_indexes) ? parsed.remove_indexes : [])
        .map(Number)
        .filter(index => Number.isInteger(index) && index >= 0 && index < words.length),
    )].sort((a, b) => a - b);

    await sql`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      SELECT
        creator_id, 'edit_suggested', 'AI transcript cleanup suggested',
        ${JSON.stringify({ session_id: sessionId, removed_word_count: removeIndexes.length, summary: parsed.summary || null })}::jsonb,
        ${access.userId}
      FROM ugc_sessions
      WHERE id = ${sessionId} AND creator_id IS NOT NULL
    `;
    return res.json({
      ok: true,
      mode,
      target_duration: targetDuration || null,
      variant_intent: variantIntent || null,
      remove_indexes: removeIndexes,
      summary: (parsed.summary || '').toString().slice(0, 300),
      editor_note: (parsed.editor_note || '').toString().slice(0, 160),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'AI cleanup failed' });
  }
}
