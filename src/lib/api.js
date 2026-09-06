import { apiFetch as fetch } from './apiFetch.js';
export async function readApiJson(response, fallback = 'Request failed') {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      const looksLikeSource = contentType.includes('javascript') || /^\s*import\s/m.test(text);
      const message = looksLikeSource
        ? 'Local API route is not running. Start the app with Vercel dev or point Vite at a real API host.'
        : text.slice(0, 220);
      throw new Error(message || fallback);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || fallback);
  }

  return payload || {};
}

export async function apiJson(input, init, fallback) {
  const response = await fetch(input, init);
  return readApiJson(response, fallback);
}
