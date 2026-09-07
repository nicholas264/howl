// Used only by trusted provisioning/release tooling, never request handlers.
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
export async function grantRuntimeAccess(sql,role) {
  if(!/^howl_[a-z0-9_]+$/.test(role)) throw new Error('Expected a dedicated howl_ runtime role');
  const target=identifier(role);
  await sql.query(`GRANT USAGE ON SCHEMA public TO ${target}`);
  const tables=await sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'app_schema_migrations' ORDER BY c.relname`;
  if(tables.length) await sql.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE ${tables.map(row=>'public.'+identifier(row.relname)).join(',')} TO ${target}`);
  const sequences=await sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname`;
  if(sequences.length) await sql.query(`GRANT USAGE ON SEQUENCE ${sequences.map(row=>'public.'+identifier(row.relname)).join(',')} TO ${target}`);
  return {tables:tables.length,sequences:sequences.length};
}
