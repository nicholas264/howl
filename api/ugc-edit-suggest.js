import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 60,
};

function parseJson(value) {
  return JSON.parse(value.replace(/```json|```/g, '').trim());
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const sessionId = Number(req.body?.session_id);
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const [session] = await sql`
      SELECT id, words
      FROM ugc_sessions
      WHERE id = ${sessionId} AND user_id = ${access.userId}
      LIMIT 1
    `;
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const words = Array.isArray(session.words) ? session.words : [];
    if (!words.length) return res.status(400).json({ error: 'Transcribe the footage before using AI cleanup' });
    if (words.length > 2500) {
      return res.status(400).json({ error: 'AI cleanup supports transcripts up to 2,500 words' });
    }

    const indexedTranscript = words
      .map((word, index) => `${index}: ${(word.word || '').toString().trim()}`)
      .join('\n');
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
        system: `You are a conservative dialogue editor for direct-response UGC.
Remove only clear filler words, repeated false starts, accidental duplicate phrases, and abandoned takes.
Never remove product claims, proof, transitions, objections, offers, calls to action, or words needed for grammatical meaning.
The editor will show every proposed cut to a human before rendering.
Return only valid JSON with:
{"remove_indexes":[integer],"summary":"one short sentence"}`,
        messages: [{
          role: 'user',
          content: `Review this indexed word transcript. Return exact word indexes that can be removed without changing meaning.\n\n${indexedTranscript}`,
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
      remove_indexes: removeIndexes,
      summary: (parsed.summary || '').toString().slice(0, 300),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'AI cleanup failed' });
  }
}
