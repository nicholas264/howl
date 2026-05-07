import { requireAuth } from './_lib/auth.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuf = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || 'audio/wav';
    const ext = contentType.includes('mp4') ? 'mp4'
      : contentType.includes('webm') ? 'webm'
      : contentType.includes('mpeg') ? 'mp3'
      : contentType.includes('ogg') ? 'ogg'
      : 'wav';

    const form = new FormData();
    form.append('file', new Blob([audioBuf], { type: contentType }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await r.json();
    if (r.ok && Array.isArray(data.words) && Array.isArray(data.segments)) {
      data.words = attachPunctuation(data.words, data.segments);
      // Rebuild a punctuated text from segments if `text` was missing/cleaner version desired.
      if (!data.text) {
        data.text = data.segments.map(s => s.text).join(' ').trim();
      }
    }
    return res.status(r.status).json(data);
  } catch (err) {
    console.error('transcribe error', err);
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}

function attachPunctuation(words, segments) {
  if (!words.length || !Array.isArray(segments) || !segments.length) return words;
  const tokens = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    for (const t of seg.text.trim().split(/\s+/)) tokens.push(t);
  }
  const strip = (s) => (s || '').toLowerCase().replace(/[^a-z0-9'-]/gi, '');
  const out = words.map(w => ({ ...w }));
  let ti = 0;
  for (let wi = 0; wi < out.length && ti < tokens.length; wi++) {
    const wPlain = strip(out[wi].word);
    if (!wPlain) continue;
    while (ti < tokens.length) {
      const tPlain = strip(tokens[ti]);
      if (tPlain === wPlain || (tPlain && wPlain && (tPlain.startsWith(wPlain) || wPlain.startsWith(tPlain)))) {
        out[wi].word = tokens[ti];
        ti++;
        break;
      }
      ti++;
    }
  }
  return out;
}
