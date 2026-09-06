import test from 'node:test';
import assert from 'node:assert/strict';
import { clerkSecretKey } from '../api/_lib/clerk-config.js';

test('Clerk configuration rejects masked credentials without exposing them', () => {
  const original = process.env.CLERK_PRODUCTION_SECRET_KEY;
  const flag = process.env.HOWL_USE_PRODUCTION_AUTH;
  try {
    process.env.HOWL_USE_PRODUCTION_AUTH = 'true';
    process.env.CLERK_PRODUCTION_SECRET_KEY = 'sk_live_masked…key';
    assert.throws(clerkSecretKey, /complete Clerk secret key/);
    process.env.CLERK_PRODUCTION_SECRET_KEY = 'sk_live_testfixture';
    assert.equal(clerkSecretKey(), 'sk_live_testfixture');
  } finally {
    if (original === undefined) delete process.env.CLERK_PRODUCTION_SECRET_KEY;
    else process.env.CLERK_PRODUCTION_SECRET_KEY = original;
    if (flag === undefined) delete process.env.HOWL_USE_PRODUCTION_AUTH;
    else process.env.HOWL_USE_PRODUCTION_AUTH = flag;
  }
});
