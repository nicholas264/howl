import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptGoogleToken, decryptGoogleToken } from '../api/_lib/google-token-crypto.js';

test('Google encryption can migrate without reinterpreting legacy ciphertext under a new key', () => {
  const legacy = { CLERK_SECRET_KEY: 'old-clerk', GOOGLE_CLIENT_SECRET: 'old-google' };
  const oldToken = encryptGoogleToken('synthetic-refresh-token', legacy);
  const combined = { ...legacy, GOOGLE_TOKEN_ENCRYPTION_KEY_V2: 'independent-dedicated-key' };
  assert.equal(decryptGoogleToken(oldToken, combined), 'synthetic-refresh-token');
  const newToken = encryptGoogleToken(decryptGoogleToken(oldToken, combined), combined);
  assert.ok(newToken.startsWith('v2.'));
  assert.equal(decryptGoogleToken(newToken, { GOOGLE_TOKEN_ENCRYPTION_KEY_V2: combined.GOOGLE_TOKEN_ENCRYPTION_KEY_V2 }), 'synthetic-refresh-token');
  assert.throws(() => decryptGoogleToken(newToken, legacy));
  assert.throws(() => decryptGoogleToken(newToken, { GOOGLE_TOKEN_ENCRYPTION_KEY_V2: 'wrong-key' }));
  assert.throws(() => decryptGoogleToken(`${oldToken}.extra`, legacy));
});

test('Google re-encryption verifies and migrates persisted credentials idempotently', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { reencryptGoogleConnections } = await import('../api/_lib/google-token-crypto.js');
  const db = new PGlite();
  const sql = async (strings, ...values) => {
    const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  try {
    await db.exec('CREATE TABLE app_google_connections(user_id TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL)');
    const legacy = { CLERK_SECRET_KEY: 'fixture-clerk', GOOGLE_CLIENT_SECRET: 'fixture-google' };
    const env = { ...legacy, GOOGLE_TOKEN_ENCRYPTION_KEY_V2: 'fixture-dedicated' };
    await sql`INSERT INTO app_google_connections VALUES (${'fixture-user'}, ${encryptGoogleToken('fixture-refresh', legacy)})`;
    assert.deepEqual(await reencryptGoogleConnections(sql, env), { migrated: 1, current: 0, concurrentlyChanged: 0 });
    assert.deepEqual(await reencryptGoogleConnections(sql, env), { migrated: 0, current: 1, concurrentlyChanged: 0 });
    const [row] = await sql`SELECT encrypted_refresh_token FROM app_google_connections`;
    assert.equal(decryptGoogleToken(row.encrypted_refresh_token, { GOOGLE_TOKEN_ENCRYPTION_KEY_V2: env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2 }), 'fixture-refresh');
  } finally { await db.close(); }
});
