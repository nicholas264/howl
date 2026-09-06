import { neon } from '@neondatabase/serverless';
import { reencryptGoogleConnections } from '../api/_lib/google-token-crypto.js';

if (!process.env.DATABASE_URL || !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2) {
  throw new Error('Select the intended database and provide its dedicated V2 encryption key.');
}
if (process.env.CONFIRM_GOOGLE_CRYPTO_READERS_READY !== 'true') {
  throw new Error('Deploy V2-compatible readers with the same key to every application using this database before migration.');
}
console.log(await reencryptGoogleConnections(neon(process.env.DATABASE_URL)));
