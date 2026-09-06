import { createAuthenticatedFetch } from './authenticatedFetch.js';

let session = null;
export async function getApiToken() {
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true') return 'local-dev';
  const current = session;
  if (!current) throw new Error('Sign in to save media.');
  const token = await current.getToken();
  if (session !== current || !token) throw new Error('Your session changed. Sign in again.');
  return token;
}
export function configureApiSession(getToken) {
  const current = { getToken };
  session = current;
  return () => { if (session === current) session = null; };
}

export async function apiFetch(input, init) {
  const current = session;
  if (!current) return globalThis.fetch(input, init);
  return createAuthenticatedFetch(globalThis.fetch.bind(globalThis), async () => {
    const token = await current.getToken();
    if (session !== current) throw new Error('Your account changed. Retry this action.');
    return token;
  }, window.location.origin)(input, init);
}
