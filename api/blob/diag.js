// Temporary diagnostic. Runs the full Blob upload flow from inside the
// function so we can confirm whether the production environment can actually
// reach the Blob store with the configured token. Returns a JSON report.
import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  const out = {
    nodeEnv: process.env.NODE_ENV,
    hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    blobTokenPrefix: (process.env.BLOB_READ_WRITE_TOKEN || '').slice(0, 24),
    hasClerkSecret: !!process.env.CLERK_SECRET_KEY,
  };

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ ...out, error: 'no BLOB_READ_WRITE_TOKEN' });
  }

  try {
    const ls = await list({ limit: 1 });
    out.listOk = true;
    out.listSampleCount = ls.blobs?.length ?? 0;
  } catch (err) {
    out.listOk = false;
    out.listError = err.message;
  }

  try {
    const r = await put(`image-library/diag-${Date.now()}.txt`, 'diag', { access: 'public' });
    out.putOk = true;
    out.putUrl = r.url;
  } catch (err) {
    out.putOk = false;
    out.putError = err.message;
  }

  return res.json(out);
}
