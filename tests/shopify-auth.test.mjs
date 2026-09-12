import test from 'node:test';
import assert from 'node:assert/strict';
import { shopifyContentConfig, getShopifyAccessToken } from '../api/_lib/shopify-content.js';

const keys = ['SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_DEALER_STORE', 'SHOPIFY_DEALER_CLIENT_ID', 'SHOPIFY_DEALER_CLIENT_SECRET', 'SHOPIFY_DEALER_ACCESS_TOKEN'];
function fixture(t) {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  t.after(() => { for (const k of keys) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; });
  process.env.SHOPIFY_STORE = 'primary.myshopify.com';
  process.env.SHOPIFY_CLIENT_ID = 'primary-id';
  process.env.SHOPIFY_CLIENT_SECRET = 'primary-secret';
  process.env.SHOPIFY_DEALER_STORE = 'dealer.myshopify.com';
}

test('dealer never inherits primary app credentials or combines unrelated credential pairs', async t => {
  fixture(t);
  assert.equal(shopifyContentConfig().configured, true);
  assert.equal(shopifyContentConfig('dealer').configured, false);
  process.env.SHOPIFY_DEALER_CLIENT_ID = 'dealer-id';
  assert.equal(shopifyContentConfig('dealer').configured, false);
  assert.equal(shopifyContentConfig('dealer').clientSecret, undefined);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not contact Shopify'); });
  await assert.rejects(getShopifyAccessToken('dealer'), /SHOPIFY_DEALER_CLIENT_ID/);
});

test('explicit dealer access token works even when primary uses client credentials', async t => {
  fixture(t);
  process.env.SHOPIFY_DEALER_ACCESS_TOKEN = 'dealer-token';
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not exchange primary credentials'); });
  assert.equal(await getShopifyAccessToken('dealer'), 'dealer-token');
});

test('dealer credentials generate and cache their own token and refresh before expiry', async t => {
  fixture(t);
  process.env.SHOPIFY_DEALER_CLIENT_ID = 'dealer-refresh-id';
  process.env.SHOPIFY_DEALER_CLIENT_SECRET = 'dealer-secret';
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://dealer.myshopify.com/admin/oauth/access_token');
    assert.equal(init.body.get('client_id'), 'dealer-refresh-id');
    assert.equal(init.body.get('client_secret'), 'dealer-secret');
    assert.equal(init.body.get('grant_type'), 'client_credentials');
    return Response.json({ access_token: `token-${++calls}`, expires_in: 86400 });
  });
  assert.equal(await getShopifyAccessToken('dealer'), 'token-1');
  assert.equal(await getShopifyAccessToken('dealer'), 'token-1');
  now += 86400 * 1000 - 4 * 60 * 1000;
  assert.equal(await getShopifyAccessToken('dealer'), 'token-2');
  assert.equal(calls, 2);
});

test('report permission failure stays visible while primary analytics still load', async t => {
  fixture(t);
  const original = { NODE_ENV: process.env.NODE_ENV, AUTH_DISABLED: process.env.AUTH_DISABLED, DATABASE_URL: process.env.DATABASE_URL };
  Object.assign(process.env, { NODE_ENV: 'test', AUTH_DISABLED: 'true', DATABASE_URL: 'postgres://test:test@localhost/test' });
  t.after(() => { for (const [k,v] of Object.entries(original)) v === undefined ? delete process.env[k] : process.env[k] = v; });
  process.env.SHOPIFY_DEALER_ACCESS_TOKEN = 'dealer-report-token';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'primary-test-token', expires_in: 86400 });
    if (url.includes('dealer.myshopify.com')) return Response.json({ errors: [{ message: 'Access denied for shopifyqlQuery field. Required access: read_reports' }] });
    const { query } = JSON.parse(init.body);
    if (query.includes('shopifyqlQuery')) return Response.json({ data: { shopifyqlQuery: { tableData: { rows: [] }, parseErrors: [] } } });
    return Response.json({ data: { orders: { edges: [], pageInfo: { hasNextPage: false } } } });
  });
  const { default: handler } = await import('../api/shopify.js');
  let body, status = 200;
  await handler({ method: 'POST', body: { action: 'get_analytics' }, headers: {} }, {
    status(value) { status = value; return this; }, json(value) { body = value; return this; }, setHeader() {},
  });
  assert.equal(status, 200);
  assert.ok(body._stores.primary);
  assert.equal(body._stores.dealer, undefined);
  assert.equal(body._meta.dealerCredentialsConfigured, true);
  assert.equal(body._meta.dealerConfigured, false);
  assert.equal(body._meta.errors[0].code, 'SHOPIFY_REPORTS_ACCESS_REQUIRED');
  assert.match(body._meta.errors[0].error, /read_reports/);
});
