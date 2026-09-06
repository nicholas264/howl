import { createHash, randomBytes } from 'node:crypto';
import { encryptGoogleToken as encrypt, decryptGoogleToken as decrypt } from './google-token-crypto.js';

let tablesReady = null;

async function createTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_google_connections (
      user_id                 TEXT PRIMARY KEY,
      encrypted_refresh_token TEXT NOT NULL,
      scopes                  TEXT[] NOT NULL DEFAULT '{}',
      google_email            TEXT,
      connected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at            TIMESTAMPTZ,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS app_google_oauth_states (
      state_hash  TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      purpose     TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_google_oauth_states_expiry ON app_google_oauth_states(expires_at)`;
}

export async function ensureGoogleOAuthTables(sql) {
  if (!tablesReady) tablesReady = createTables(sql);
  try {
    await tablesReady;
  } catch (error) {
    tablesReady = null;
    throw error;
  }
}

function stateHash(state) {
  return createHash('sha256').update(state).digest('hex');
}

export async function createGoogleOAuthState(sql, userId, purpose) {
  await ensureGoogleOAuthTables(sql);
  const state = randomBytes(32).toString('base64url');
  await sql`DELETE FROM app_google_oauth_states WHERE expires_at <= now() OR user_id = ${userId}`;
  await sql`
    INSERT INTO app_google_oauth_states (state_hash, user_id, purpose, expires_at)
    VALUES (${stateHash(state)}, ${userId}, ${purpose}, now() + interval '10 minutes')
  `;
  return state;
}

export async function consumeGoogleOAuthState(sql, state) {
  await ensureGoogleOAuthTables(sql);
  if (!state) return null;
  const [record] = await sql`
    DELETE FROM app_google_oauth_states
    WHERE state_hash = ${stateHash(state)} AND expires_at > now()
    RETURNING user_id, purpose
  `;
  return record || null;
}

export async function saveGoogleConnection(sql, {
  userId,
  refreshToken,
  scopes = [],
  googleEmail = null,
}) {
  await ensureGoogleOAuthTables(sql);
  await sql`
    INSERT INTO app_google_connections (
      user_id, encrypted_refresh_token, scopes, google_email, connected_at, updated_at
    ) VALUES (
      ${userId}, ${encrypt(refreshToken)}, ${scopes}, ${googleEmail}, now(), now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
      scopes = EXCLUDED.scopes,
      google_email = EXCLUDED.google_email,
      connected_at = now(),
      updated_at = now()
  `;
}

export async function getGoogleConnection(sql, userId) {
  await ensureGoogleOAuthTables(sql);
  const [connection] = await sql`
    SELECT user_id, scopes, google_email, connected_at, last_used_at, updated_at
    FROM app_google_connections
    WHERE user_id = ${userId}
  `;
  return connection || null;
}

export async function disconnectGoogle(sql, userId) {
  await ensureGoogleOAuthTables(sql);
  await sql`DELETE FROM app_google_connections WHERE user_id = ${userId}`;
}

export async function getUserGoogleAccessToken(sql, userId) {
  await ensureGoogleOAuthTables(sql);
  const [connection] = await sql`
    SELECT encrypted_refresh_token
    FROM app_google_connections
    WHERE user_id = ${userId}
  `;
  if (!connection) {
    const error = new Error('Google is not connected for this HOWL user');
    error.reconnectRequired = true;
    throw error;
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decrypt(connection.encrypted_refresh_token),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) {
    const error = new Error(tokens.error_description || 'Google connection expired');
    error.reconnectRequired = true;
    throw error;
  }
  await sql`UPDATE app_google_connections SET last_used_at = now() WHERE user_id = ${userId}`;
  return tokens.access_token;
}
