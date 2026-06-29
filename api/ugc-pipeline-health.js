import { requirePermission } from './_lib/app-access.js';
import { remotionConfig } from './_lib/ugc-remotion.js';

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const services = [];
  const addService = ({ key, label, ok, detail, missing = [] }) => {
    services.push({
      key,
      label,
      ok: Boolean(ok),
      detail: detail || '',
      missing,
    });
  };

  addService({
    key: 'blob',
    label: 'Blob upload',
    ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    detail: process.env.BLOB_READ_WRITE_TOKEN ? 'Upload token configured' : 'Missing Blob read/write token',
    missing: process.env.BLOB_READ_WRITE_TOKEN ? [] : ['BLOB_READ_WRITE_TOKEN'],
  });

  try {
    await access.sql`SELECT 1 AS ok`;
    addService({
      key: 'database',
      label: 'Session database',
      ok: true,
      detail: 'Neon connection reachable',
    });
  } catch (err) {
    addService({
      key: 'database',
      label: 'Session database',
      ok: false,
      detail: err.message || 'Database check failed',
    });
  }

  addService({
    key: 'transcription',
    label: 'Transcription',
    ok: Boolean(process.env.OPENAI_API_KEY),
    detail: process.env.OPENAI_API_KEY ? 'Whisper key configured' : 'Missing OpenAI key',
    missing: process.env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
  });

  addService({
    key: 'ai_editing',
    label: 'AI first cut',
    ok: Boolean(process.env.ANTHROPIC_API_KEY),
    detail: process.env.ANTHROPIC_API_KEY ? 'Anthropic key configured' : 'Missing Anthropic key',
    missing: process.env.ANTHROPIC_API_KEY ? [] : ['ANTHROPIC_API_KEY'],
  });

  const lambda = remotionConfig();
  addService({
    key: 'lambda_render',
    label: 'Lambda render',
    ok: lambda.configured,
    detail: lambda.configured ? `Remotion connected in ${lambda.region}` : 'Remotion Lambda needs setup',
    missing: lambda.missing,
  });

  return res.json({
    ok: services.every(service => service.ok),
    services,
    checked_at: new Date().toISOString(),
  });
}
