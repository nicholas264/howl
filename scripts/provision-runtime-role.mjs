import {readFile,writeFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {grantRuntimeAccess} from './lib/runtime-grants.mjs';

// Explicit operator command. Never run automatically during a Vercel build.
try {
  const role=process.env.HOWL_RUNTIME_DB_ROLE;
  const destination=process.env.HOWL_RUNTIME_CREDENTIAL_FILE;
  if(!['howl_runtime','howl_preview_runtime'].includes(role) || !destination || !isAbsolute(destination) || !process.env.DATABASE_URL) throw new Error('Explicit role, absolute private credential file, and target database required');
  const base=new URL(process.env.DATABASE_URL);
  const adminUrl=new URL(process.env.HOWL_ROLE_ADMIN_DATABASE_URL || process.env.DATABASE_URL);
  if(adminUrl.hostname.replace('-pooler.','.')!==base.hostname.replace('-pooler.','.')) throw new Error('Role administrator must use the same database cluster');
  const administrator=neon(adminUrl.toString());
  const grantor=neon(base.toString());
  let record;
  try {
    const info=await stat(destination);
    if((info.mode & 0o077)!==0) throw new Error('Credential file must be owner-only');
    record=JSON.parse(await readFile(destination,'utf8'));
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const [exists]=await administrator`SELECT rolname FROM pg_roles WHERE rolname=${role}`;
  if(!record) {
    if(exists) throw new Error('Existing role has no matching private provisioning record');
    const runtimeUrl=new URL(base);runtimeUrl.username=role;runtimeUrl.password=randomBytes(36).toString('base64url');
    record={role,url:runtimeUrl.toString()};
    await writeFile(destination,JSON.stringify(record),{mode:0o600,flag:'wx'});
  }
  const runtimeUrl=new URL(record.url);
  if(record.role!==role || runtimeUrl.username!==role || runtimeUrl.hostname!==base.hostname || runtimeUrl.pathname!==base.pathname || !/^[A-Za-z0-9_-]+$/.test(runtimeUrl.password)) throw new Error('Credential record does not match target');
  if(!exists) await administrator.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${runtimeUrl.password}'`);
  const counts=await grantRuntimeAccess(grantor,role);
  const runtime=neon(runtimeUrl.toString());
  const [flags]=await runtime`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
    has_schema_privilege(current_user,'public','CREATE') AS can_create
    FROM pg_roles WHERE rolname=current_user`;
  const [permissions]=await runtime`SELECT count(*) FILTER(WHERE pg_has_role(current_user,c.relowner,'USAGE')) AS owned_tables,
    count(*) FILTER(WHERE has_table_privilege(current_user,c.oid,'TRUNCATE')) AS truncatable_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`;
  if(flags.rolsuper || flags.rolcreatedb || flags.rolcreaterole || flags.rolbypassrls || flags.can_create || Number(permissions.owned_tables) || Number(permissions.truncatable_tables)) throw new Error('Role retains elevated access');
  console.log(JSON.stringify({provisioned:true,role,...counts,restricted:true}));
} catch(error) {
  // Driver failures can embed SQL and generated passwords; never print them.
  console.error(JSON.stringify({provisioned:false,code:error.code || 'configuration_or_privilege_check_failed'}));
  process.exitCode=1;
}
