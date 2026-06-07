// Temporary diagnostic. Runs the full Blob upload flow from inside the
// function so we can confirm whether the production environment can actually
// reach the Blob store with the configured token. Returns a JSON report.
import { put, list } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

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

  // Sign a clientToken the same way handleUpload would, then PUT with it as
  // the browser does. If THIS fails but putOk is true, the clientToken flow
  // is broken even though direct uploads work.
  try {
    const pathname = `image-library/diag-client-${Date.now()}.jpg`;
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: ['image/jpeg'],
      maximumSizeInBytes: 10 * 1024 * 1024,
      addRandomSuffix: true,
      validUntil: Date.now() + 60_000,
    });
    out.clientTokenOk = true;
    out.clientTokenLen = clientToken.length;

    const putRes = await fetch(`https://blob.vercel-storage.com/?pathname=${encodeURIComponent(pathname)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${clientToken}`,
        'content-type': 'image/jpeg',
        'x-api-version': '12',
        'x-add-random-suffix': '1',
        'x-add-access': 'public',
      },
      body: 'fake-jpeg-body',
    });
    out.clientPutStatus = putRes.status;
    out.clientPutBody = (await putRes.text()).slice(0, 300);
  } catch (err) {
    out.clientTokenOk = false;
    out.clientTokenError = err.message;
  }

  return res.json(out);
}
