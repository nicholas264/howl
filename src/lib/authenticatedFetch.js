// Temporary adapter for existing fetch callers. Tokens never leave this origin.
export function createAuthenticatedFetch(fetchImpl, getToken, origin) {
  return async (input, init = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return fetchImpl(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    return fetchImpl(input, { ...init, headers });
  };
}
