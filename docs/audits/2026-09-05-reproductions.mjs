// Offline audit reproductions. Run from the repo root:
// node docs/audits/2026-09-05-reproductions.mjs
// All network calls, provider mutations, and database calls are mocked.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import shopifyCallback from '../../api/shopify-callback.js';
import { ROLE_PERMISSIONS, hasPermission, getAppAccess } from '../../api/_lib/app-access.js';

process.env.NODE_ENV = 'production';
process.env.ADMIN_EMAILS = '';
process.env.SHOPIFY_CLIENT_ID = 'audit-dummy-id';
process.env.SHOPIFY_CLIENT_SECRET = 'audit-dummy-secret';
process.env.META_ACCESS_TOKEN = 'audit-dummy-token';
process.env.META_AD_ACCOUNT_ID = 'audit-dummy-account';
const response = () => ({ status() { return this; }, json() { return this; }, send() { return this; }, setHeader() {} });
let captured;
globalThis.fetch = async (url, init) => {
  captured = { url, body: JSON.parse(init.body) };
  return { json: async () => ({ access_token: 'audit-dummy-token', scope: 'read_products' }) };
};
await shopifyCallback({ query: { code: 'arbitrary-code', shop: 'untrusted.example' }, headers: {} }, response());
assert.equal(captured.url, 'https://untrusted.example/admin/oauth/access_token');
assert.equal(captured.body.client_secret, 'audit-dummy-secret');
console.log('REPRODUCED: public Shopify callback sends secret to unvalidated hostname without state/HMAC.');

const main = await readFile(new URL('../../src/main.jsx', import.meta.url), 'utf8');
const fetchStart = main.indexOf('const authenticatedFetch = async');
const fetchEnd = main.indexOf('\n    window.fetch = authenticatedFetch', fetchStart);
assert.ok(fetchStart >= 0 && fetchEnd > fetchStart);
let forwarded;
const interceptor = new Function('getToken', 'orig', main.slice(fetchStart, fetchEnd) + '; return authenticatedFetch;')(
  async () => 'audit-dummy-token',
  async (url, init) => { forwarded = { url, init }; },
);
await interceptor('https://untrusted.example/api/image');
assert.equal(forwarded.init.headers.Authorization, 'Bearer audit-dummy-token');
console.log('REPRODUCED: actual frontend interceptor attaches Clerk token to cross-origin /api/ request.');

const sql = async (parts) => parts.join('').includes('FROM app_users')
  ? [{ user_id: 'audit-user', email: 'audit@example.test', role: 'producer', status: 'suspended' }]
  : [];
const access = await getAppAccess({ userId: 'audit-user', email: 'audit@example.test' }, sql);
assert.equal(access.user.status, 'suspended');
assert.equal(hasPermission(access, 'assets.write'), true);
console.log('REPRODUCED: suspended producer retains permission bits trusted by Blob token callback.');

const meta = await readFile(new URL('../../api/meta.js', import.meta.url), 'utf8');
const handlerStart = meta.indexOf('export default async function handler');
assert.ok(handlerStart >= 0);
let dismissed = false;
const handler = new Function('requireWorkspaceAccess', 'hasPermission', 'dismissAnalyzedWinner',
  meta.slice(handlerStart).replace('export default ', '') + '; return handler;')(
  async () => ({ userId: 'audit-viewer', email: 'audit@example.test', permissions: ROLE_PERMISSIONS.viewer }),
  hasPermission,
  async () => { dismissed = true; return { status: 200, body: { ok: true } }; },
);
await handler({ method: 'POST', body: { action: 'dismiss_analyzed_winner', groupKey: 'audit-group' } }, response());
assert.equal(dismissed, true);
console.log('REPRODUCED: actual Meta handler lets viewer invoke winner dismissal.');
