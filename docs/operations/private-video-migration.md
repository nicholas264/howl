# Reviewed editor source migration

Production inventory on September 7 found one public source: session 1, 51,370,969
bytes, status rendered, with a recorded owner, no creator/deliverable linkage and
no database references outside that session. New editor uploads are already private.

`node scripts/migrate-video-media.mjs --plan /absolute/private/manifest.json`
creates an owner-only recovery MP4 and manifest. It does not upload or update rows.
The reviewed workflow intentionally rejects multiple sources, unexpected references,
active work, external destinations and files over 100 MB. Larger or linked sources
need a separate streaming migration rather than increasing this buffer limit.

`node scripts/migrate-video-media.mjs --apply /absolute/private/manifest.json`
checks the database/store target, recovery hash, unchanged source and session,
then creates an exact private copy without overwriting existing objects. It verifies
bytes and anonymous denial before atomically updating the session URL/revision and
registering its original owner. Concurrent edits or registry failures prevent the
entire database change. Replays verify the same private copy and ownership.

Both commands require DATABASE_URL, BLOB_READ_WRITE_TOKEN and
HOWL_PRIVATE_READ_WRITE_TOKEN. Use trusted operator provisioning, keep credentials
out of logs and command arguments, and retain recovery files outside the repository.
The script has no deletion mode; it retains the old public source.

Execution awaits explicit approval for moving this production video to the existing
`howl-private-media` store. Automatic approval review rejected the initial planning
command before execution; no recovery manifest, private copy or database migration
was created by that command. Retirement of the public original is a separate action.
