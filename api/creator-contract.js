import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function fileName(value) {
  return String(value || 'creator-contract.pdf')
    .replace(/["\r\n]/g, '')
    .slice(0, 180) || 'creator-contract.pdf';
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await ensureCreatorOpsTables(access.sql);
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'Agreement id required' });
    const [agreement] = await access.sql`
      SELECT id, title, source_pdf_url, source_file_name
      FROM creator_agreements
      WHERE id = ${id}
        AND source_type = 'uploaded_pdf'
        AND source_pdf_url IS NOT NULL
      LIMIT 1
    `;
    if (!agreement) return res.status(404).json({ error: 'Uploaded contract not found' });

    const upstream = await fetch(agreement.source_pdf_url);
    if (!upstream.ok) {
      return res.status(502).json({ error: `Contract file fetch failed (${upstream.status})` });
    }
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `inline; filename="${fileName(agreement.source_file_name || agreement.title)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('creator-contract error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
