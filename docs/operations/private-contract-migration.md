# Existing contract media migration

The production application uploads new contracts to the separate private Blob store
and serves registered PDFs through the authenticated contract endpoint. This procedure
moves existing uploaded PDFs; it does not migrate video, images or renderer output.

Use the migration database credential and the production-only
`HOWL_PRIVATE_READ_WRITE_TOKEN`, plus the existing `BLOB_READ_WRITE_TOKEN`. Keep them
in a private process environment. Never paste tokens into command arguments or logs.
Do not pull the stale local production environment wholesale into Vercel.

1. Run `node scripts/migrate-contract-media.mjs --plan /private/path/contracts.json`.
   The parent directory must be private. This reads every public-table reference,
   snapshots the original agreement and upload activities, and writes owner-only PDF
   recovery files with SHA-256 hashes. Sent, accepted or unexpected documents stop the
   plan for separate review. It does not change the database or Blob storage.
2. Run the same script with `--apply` and that manifest. Each PDF is copied to a
   deterministic private pathname without overwriting an existing file. Existing
   destinations must match the recovery hash. Anonymous denial and authenticated
   bytes are verified before the reference update. Agreement, ownership registration,
   upload activities and migration audit change in one SQL statement. Concurrent
   record edits cause rollback. Rerunning the same manifest resumes after a lost
   acknowledgement without duplicating the migration.
3. Verify the live application deployment supports private contract reads. Confirm
   the member workflow and the intended retirement of the old public URLs. Once
   retirement is authorized, run `--retire-public` with the same manifest. It verifies
   recovery and private-copy hashes, registration, zero remaining database references,
   and unchanged source bytes before deleting only the duplicate public objects.
   A 404 at the old URL is required to record retirement. Cache propagation can require
   rerunning this stage; do not treat a successful delete request alone as proof.

Keep the manifest and recovery PDFs until the offsite backup/restore requirements
are met. This local snapshot is not offsite disaster recovery. Old deployment URLs
remain a separate exposure until their authorized retirement is complete.

Production status on September 7: agreements 14–17 are migrated and verified.
Automatic approval review rejected the public-copy deletion pending explicit user
approval. All four public duplicates remain; do not rerun that stage without approval.
