import { neon } from '@neondatabase/serverless';

const connection = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!connection) throw new Error('Select the intended environment and provide a database connection.');
const sql = neon(connection);
await sql`ALTER TABLE creator_seeding_log ADD COLUMN IF NOT EXISTS engagement_id BIGINT REFERENCES creator_engagements(id) ON DELETE SET NULL`;
console.log('Seeding agreement link is ready. Existing ledger entries are unchanged.');
