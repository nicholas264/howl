export async function ensureAuthIdentities(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_auth_migrations (
    issuer TEXT NOT NULL, email TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES app_users(user_id),
    expires_at TIMESTAMPTZ NOT NULL, claimed_subject TEXT,
    PRIMARY KEY(issuer,email), UNIQUE(issuer,user_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS app_auth_identities (
    issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id)
  )`;
}

// Only explicitly provisioned migration records can link identities. Email
// equality alone never transfers membership between arbitrary Clerk accounts.
export async function resolveWorkspaceIdentity(sql,{issuer,subject,email}) {
  const [existing]=await sql`SELECT user_id FROM app_auth_identities WHERE issuer=${issuer} AND subject=${subject}`;
  if(existing) return existing.user_id;
  if(!email) return subject;
  const [linked]=await sql`
    WITH eligible AS MATERIALIZED (
      SELECT issuer,email,user_id FROM app_auth_migrations
      WHERE issuer=${issuer} AND email=${email.toLowerCase()} AND expires_at>now()
        AND (claimed_subject IS NULL OR claimed_subject=${subject}) FOR UPDATE
    ), identity AS (
      INSERT INTO app_auth_identities (issuer,subject,user_id)
      SELECT issuer,${subject},user_id FROM eligible
      ON CONFLICT DO NOTHING RETURNING user_id
    ), consumed AS (
      UPDATE app_auth_migrations SET claimed_subject=${subject}
      WHERE issuer=${issuer} AND email=${email.toLowerCase()} AND EXISTS(SELECT 1 FROM identity)
      RETURNING user_id
    ) SELECT user_id FROM consumed
  `;
  if(linked) return linked.user_id;
  const [concurrent]=await sql`SELECT user_id FROM app_auth_identities WHERE issuer=${issuer} AND subject=${subject}`;
  return concurrent?.user_id || subject;
}
