import { neon } from '@neondatabase/serverless';
import { ensureDealerOutreach } from '../api/_lib/dealer-outreach.js';

// Run only after selecting the intended environment. This migration is additive.
const connection = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!connection) throw new Error('Select the intended environment and provide DATABASE_MIGRATION_URL or DATABASE_URL.');
const sql = neon(connection);
await ensureDealerOutreach(sql);
if (process.env.HOWL_RUNTIME_DB_ROLE) {
  const role = process.env.HOWL_RUNTIME_DB_ROLE;
  if (!/^howl_[a-z0-9_]+$/.test(role)) throw new Error('Expected a dedicated howl_ runtime role.');
  await sql.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dealer_outreach TO "${role}"`);
}
const [table] = await sql`SELECT to_regclass('public.dealer_outreach') AS name`;
if (!table.name) throw new Error('Dealer outreach migration did not create its table.');
console.log('Dealer outreach table is ready. Existing orders and outreach data are unchanged.');
