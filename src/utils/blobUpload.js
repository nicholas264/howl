export async function uploadPublicBlob(pathname, body, {
  contentType,
  clientPayload,
  handleUploadUrl = '/api/blob/upload-token',
  onUploadProgress,
} = {}) {
  if (!clientPayload) throw new Error('Not signed in - please reload and sign in again.');

  const tokenRes = await fetch(handleUploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload,
        multipart: false,
      },
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Upload token failed (${tokenRes.status}): ${text.slice(0, 300) || 'No response body'}`);
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.clientToken) {
    throw new Error(`Upload token response did not include a client token.`);
  }

  return putBlobWithProgress({
    pathname,
    body,
    clientToken: tokenData.clientToken,
    contentType,
    onUploadProgress,
  });
}

function putBlobWithProgress({ pathname, body, clientToken, contentType, onUploadProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `https://blob.vercel-storage.com/?pathname=${encodeURIComponent(pathname)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${clientToken}`);
    xhr.setRequestHeader('x-api-version', '12');
    xhr.setRequestHeader('x-vercel-blob-access', 'public');
    if (contentType) xhr.setRequestHeader('x-content-type', contentType);

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      onUploadProgress?.({
        loaded: event.loaded,
        total: event.total,
        percentage: event.total ? event.loaded / event.total : 0,
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Blob upload returned an invalid response.'));
        }
        return;
      }
      reject(new Error(`Vercel Blob upload failed (${xhr.status}): ${String(xhr.responseText || '').slice(0, 300)}`));
    };

    xhr.onerror = () => reject(new Error('Vercel Blob upload failed before the server responded.'));
    xhr.onabort = () => reject(new Error('Vercel Blob upload was cancelled.'));
    xhr.send(body);
  });
}
