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
    return res.status(r.status).json(data);
  } catch (err) {
    console.error('transcribe error', err);
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}
