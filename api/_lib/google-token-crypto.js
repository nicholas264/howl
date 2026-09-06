import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(material) {
  if (!material || material === ':') throw new Error('Google token encryption is not configured');
  return createHash('sha256').update(material).digest();
}
function legacyMaterial(env) {
  return env.GOOGLE_TOKEN_ENCRYPTION_KEY || `${env.CLERK_SECRET_KEY || ''}:${env.GOOGLE_CLIENT_SECRET || ''}`;
}
function encode(value, material) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(material), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function encryptGoogleToken(value, env = process.env) {
  return env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2
    ? `v2.${encode(value, env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2)}`
    : encode(value, legacyMaterial(env));
}
export function decryptGoogleToken(value, env = process.env) {
  const versioned = typeof value === 'string' && value.startsWith('v2.');
  const parts = (versioned ? value.slice(3) : value || '').split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Stored Google credential is invalid');
  }
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Stored Google credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', key(versioned ? env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2 : legacyMaterial(env)), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// CAS avoids overwriting a newly reconnected account during key migration.
export async function reencryptGoogleConnections(sql, env = process.env) {
  if (!env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2) throw new Error('Dedicated Google encryption key is required');
  const rows = await sql`SELECT user_id, encrypted_refresh_token FROM app_google_connections`;
  let migrated = 0;
  let current = 0;
  let changed = 0;
  for (const row of rows) {
    const plaintext = decryptGoogleToken(row.encrypted_refresh_token, env);
    if (row.encrypted_refresh_token.startsWith('v2.')) { current++; continue; }
    const encrypted = encryptGoogleToken(plaintext, env);
    if (decryptGoogleToken(encrypted, env) !== plaintext) throw new Error('Google encryption verification failed');
    const updated = await sql`UPDATE app_google_connections SET encrypted_refresh_token=${encrypted}
      WHERE user_id=${row.user_id} AND encrypted_refresh_token=${row.encrypted_refresh_token} RETURNING user_id`;
    if (updated.length) migrated++; else changed++;
  }
  return { migrated, current, concurrentlyChanged: changed };
}
