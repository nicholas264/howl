# Restricted runtime database access

Status: provisioning and Vercel cutover await explicit approval. No new runtime
logins have been created. Production still uses `neondb_owner`; preview uses
`howl_preview_owner`. Older deployment snapshots and Development credentials also
remain separate unresolved access paths.

The provisioning command creates `howl_runtime` for production or
`howl_preview_runtime` for preview. Each gets SELECT/INSERT/UPDATE/DELETE on
application tables, USAGE on their sequences, and USAGE on the public schema.
It receives no ownership, schema CREATE, role/database creation, BYPASSRLS, or
TRUNCATE privilege. The schema-migration ledger is excluded from data grants.
This is database-level privilege reduction; application permission checks still
enforce member roles within the shared workspace.

## Provisioning

Run only after approving the intended environment. Set these values through a
private environment, never in command history containing credentials:

- `DATABASE_URL`: existing migration/table-owner connection for the target database.
- `HOWL_ROLE_ADMIN_DATABASE_URL`: role administrator in the same cluster, if the
  target table owner cannot create roles (needed for the preview owner).
- `HOWL_RUNTIME_DB_ROLE`: exactly `howl_runtime` or `howl_preview_runtime`.
- `HOWL_RUNTIME_CREDENTIAL_FILE`: absolute path inside an ignored, owner-only
  provisioning directory. The command creates the credential file with mode 0600.

Run `node scripts/provision-runtime-role.mjs`. It can resume using the same private
file after an interrupted attempt. It refuses an existing role without a matching
local record. Output contains only status and grant counts. Keep migration
credentials out of all deployed application environments.

## Cutover and verification

Preserve the existing credentials privately for rollback. Update only the intended
Vercel target's database URL, username, and password variables; preserve the other
targets. Publish only the current tested commit after all variables are set.
Existing running deployments retain their old snapshots until replaced/retired.

Verify the new connection's role flags, ownership, schema CREATE and TRUNCATE
privileges, table coverage, and denied migration-ledger access. Verify application
reads and permitted writes with authenticated members, plus cron authentication.
Do not issue real paid launches, orders, or emails as connection smoke tests.

Rollback restores the former target-specific database values and redeploys the
same tested commit. Do not delete roles or rotate migration credentials during
rollback; inspect the failure first.

## Future migrations

Use the separate migration credential with `npm run db:migrate` and set
`HOWL_RUNTIME_DB_ROLE` to the applicable runtime role. The migration refreshes data
grants after creating new tables/sequences. Provisioning never runs automatically
in a Vercel build. New tables intentionally do not inherit broad PUBLIC access.
