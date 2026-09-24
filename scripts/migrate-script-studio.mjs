import { neon } from '@neondatabase/serverless';
import { ensureScriptStudio } from '../api/_lib/script-studio-store.js';
const connection=process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if(!connection)throw new Error('Select the intended environment and supply a migration database connection.');
const sql=neon(connection);
await ensureScriptStudio(sql);
const role=process.env.HOWL_RUNTIME_DB_ROLE;
if(role) {
  if(!/^howl_[a-z0-9_]+$/.test(role))throw new Error('Expected a dedicated howl_ runtime role.');
  await sql.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.script_studio_scripts,public.script_studio_ads TO "${role}"`);
}
const [row]=await sql`SELECT to_regclass('public.script_studio_scripts') AS scripts,to_regclass('public.script_studio_ads') AS ads`;
if(!row.scripts || !row.ads)throw new Error('Script Studio migration verification failed.');
console.log('Script Studio saved versions and ad attribution tables are ready.');
