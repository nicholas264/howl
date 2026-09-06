# Howl recovery procedures

## Release order

1. Run `npm run check` and the dependency audit.
2. Take a database dump with PostgreSQL 18 client tools. Keep dumps and reports
   outside Git, with owner-only filesystem permissions.
3. Run `node scripts/verify-backup.mjs /private/path/backup.sql`. This restores
   the SQL dump into isolated PostgreSQL/PGlite and exercises additive migrations.
4. Run `node --env-file=.vercel/.env.production.local scripts/migrate.mjs` against
   the explicitly selected production connection before deploying the new API.
5. Deploy and verify sign-in, authorized reads, denied writes for read-only users,
   shared draft reload, and background processing. Never use paid ads, real
   orders, or outbound email as disposable smoke tests.

## Database backup readiness

The September 6 local restore recovered 65 tables and 14,592 rows and passed the
second release's additive migrations. This proves that the inspected local dump
can be restored; it does not prove offsite disaster recovery or continuous backup.

Approved destination: `s3://howl-private-backups-p4qjctk972/database/`, us-east-1.
Required controls: all four S3 public-access blocks, AES256 server-side encryption,
versioning, and 35-day current/noncurrent object retention. AWS denied creation
under the configured Remotion IAM user. No object was uploaded. The narrowly
scoped provisioning policy is in `backup-provisioning-policy.json`; an AWS
administrator must provision/grant this access before backup automation can run.
Use a separate write/read-only backup principal after provisioning; it does not
need bucket-policy modification, object deletion, or access to render assets.

Target recovery objectives, pending a timed offsite exercise: RPO 24 hours and
RTO 4 hours. A local two-second SQL restore is not the application RTO. Recovery
also requires a database service, credentials, media, DNS, authentication,
deployment, and verified user access. Never restore over the live database;
restore into an isolated database, compare integrity/counts, then perform an
explicit connection cutover with the prior database retained for rollback.

## External actions

An `uncertain` operation means the provider may already have performed the action.
Do not delete journal rows, fabricate a new request key, or mark an attempt rejected
merely because its response was lost. Retry the original request after recovering
a receipt; local launch/outreach bookkeeping is idempotent.

Admin → Operations can recover Meta ad creation receipts. The operator supplies
an existing Meta ad ID and review note. The server checks account, creative, ad set,
name, tracking configuration, and creation time, then saves an audit record.
Other provider steps currently require their specific reconciliation procedure;
the UI does not offer an unsafe generic reset.

Resend sends include provider idempotency keys. A provider's idempotency window is
finite; the permanent local journal remains the replay authority. Shopify retries
resume a known draft, even if catalog/address inputs later change. Fulfillment and
uncertain draft-creation recovery are separate work that must be verified before
an operation is treated as complete.

## Renders and transcription

Known Remotion renders are polled every five minutes independently of a browser.
A start with no provider receipt becomes `render_unknown`; it cannot be safely
restarted until its provider outcome is reconciled. An exhausted work lease is
reported as unknown rather than successful or free. Keep the original render ID,
bucket, function, region, and attempt metadata for provider investigation.

Transcription uses a unique claim and optimistic session revision. A late result
cannot overwrite concurrent edits. Processing has a four-minute deadline; source
video is limited to 2 GB and extracted audio to 25 MB. Normalization is bounded to
four minutes and 256 MB. Failures preserve original media and require a visible
retry after the current session state has been reloaded.

## Production authentication cutover

`CLERK_PRODUCTION_SECRET_KEY` is stored as a production-only Vercel Secret.
Authentication selects it only when `HOWL_USE_PRODUCTION_AUTH=true`. The frontend
publishable key and backend switch must be changed in the same deployment.
The verified issuer is `https://clerk.welcometothecampfire.io`.

Provision the two explicitly approved production identities, then seed
`app_auth_identities` with their exact issuer/subject and existing workspace IDs.
This preserves creator ownership, Google connection ownership, roles, and suspension.
If using one-time email migration records instead, only preauthorized, unexpired
records may link a verified primary email; arbitrary email matches never grant
membership. Set `CLERK_IDENTITY_MIGRATION_ISSUER` to the verified production issuer.

Retain the legacy `CLERK_SECRET_KEY` temporarily: legacy Google OAuth ciphertext
uses it as part of its encryption fallback. Do not rotate/delete it until those
records have been re-encrypted with a dedicated encryption secret. Rollback must
restore the matching frontend key and auth selector together; rolling back only
one will make sign-in fail.
