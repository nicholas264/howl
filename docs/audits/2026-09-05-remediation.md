# Audit remediation status — September 6, 2026

The first release is deployed. The second release adds the fixes below; its
additive production migration and restored-backup migration checks have passed.
Deployment verification is recorded in the release report. This document does
not claim that the remaining infrastructure and product roadmap is complete.

## Second release

- Explicit authenticated API clients replace the global fetch override. Account
  changes invalidate pending token acquisition and unmount private workspace state.
- Invitation acceptance and membership creation are atomic; only verified primary
  Clerk email addresses participate in email-based membership decisions.
- Production Clerk domain and five DNS records are verified. The two approved
  existing members have production identities mapped to their original internal
  IDs. A production-only secret and coordinated cutover switch preserve legacy
  Google OAuth encryption while authentication moves to production.
- Analysis jobs use unique lease tokens, guarded result writes, abortable network
  and ffmpeg work, and hard deadlines. Abandoned known renders recover by cron;
  unknown starts remain quarantined instead of being blindly repeated.
- Shared, paginated launch drafts persist across devices with optimistic revisions.
  Nested local media becomes durable before saving. Old browser carts are imported
  only by explicit user action. Unsaved editor navigation is guarded.
- Immutable approval snapshots contain output fingerprints and terms/brief linkage.
  Launch preflight resolves known asset ownership and verifies provider media
  receipts. Drive uploads compare actual downloaded bytes to approved checksums,
  including when replaying a saved upload receipt.
- Provider upload receipts, stable thumbnail reads, idempotent launch/media/activity
  bookkeeping, and Resend idempotency keys support safe retries. Shopify resumes
  known drafts independently of subsequent catalog or address changes.
- Admin can recover an uncertain Meta ad receipt after server-side verification
  of the existing provider object. Unsupported uncertain outcomes remain blocked
  pending provider-specific reconciliation.
- Creative definitions retain copy and all carousel/dynamic alternatives as
  distinct variants. Shared-media reports are explicitly descriptive. Prospective
  comparison protocols freeze ad assignments, require a full observation window
  and minimum evidence, detect changed definitions, and store immutable decisions.
  They do not establish randomized causal lift or reconstruct historical variants.
- Analytics insight pages write in batches. DNS-pinned, bounded resource fetching
  also covers sitemap/MAP imports, image upload/vision/mirroring, and normalization.
- Transcription has a claim, source/revision guards, bounded streaming, and a
  four-minute deadline. It cannot overwrite edits made during processing.
- Paid work has global/per-user concurrency lanes, daily workspace request budgets,
  token/media usage records, recorded Remotion cost, unknown-expiration recovery,
  and Admin visibility. Unpriced requests are shown as unknown cost, not zero.
- A real database dump restored 65 tables and 14,592 rows in an isolated engine,
  then passed additive migrations. The approved offsite bucket remains blocked by
  AWS IAM permissions; no production backup was uploaded to S3.

## Follow-up releases

- Production authentication now uses the complete live Clerk secret. A malformed
  masked credential caused the initial member verification failure and was
  corrected and redeployed; real member refresh verification remains pending.
- Source playback validates byte ranges, propagates stream backpressure, stops
  disconnected requests, and bounds upstream work. Credential format checks reject
  truncated or masked keys before a provider request.
- Versioned Google token encryption and a compare-and-swap migration are tested
  and deployed. Activation waits for preview isolation and compatible readers;
  legacy credentials and encryption material are preserved.
- An additive database trigger records creative-variant changes atomically with
  metadata updates. Experiment comparisons require an observed baseline and reject
  changes after assignment capture, including changes that later reverse. This is
  observation history, not reconstructed provider effective dates.

- Manual analysis now claims the worker queue lease, and intermediate asset
  metadata writes require that same lease. Expired manual requests fail rather
  than being retried without their request-local transcript.
- Scheduled analysis jobs reserve the same daily budget and concurrency lanes as
  manual jobs. Budget-limited jobs are deferred without consuming a processing
  retry; provider token usage is associated with the individual async job.
- New previews use an empty, separate database and a restricted login with no
  privileges on production tables. Production provider secrets were removed from
  Preview targets, and six legacy preview builds were retired. Development and
  superseded production deployment snapshots still require isolation/retirement.

- Paid-work lanes, usage records, daily budgets, and rate limits now use only
  data operations during requests; release migrations create their tables. A real
  PostgreSQL restricted-role regression verifies both budget denials and successful
  usage recording without CREATE or ALTER privileges. Other runtime schema helpers
  remain; the production runtime role has not yet been restricted.
- Vercel publication now requires syntax checks, all regression tests, the frontend
  build, and the high-severity dependency audit. Tests run with an isolated temporary
  home and an environment allowlist that excludes deployment credentials.

- Upload and local receipts, external-operation journals, draft saves, approval
  preflight, and transcription no longer initialize schema during requests. Existing
  additive migrations were verified in production and preview. Restricted-role
  PostgreSQL tests cover upload replay, changed-request rejection, draft conflicts,
  transcription ownership, and missing creator-approval rejection.

- Membership, admin/feedback access, and Static Studio storage no longer create
  schema during requests. Studio setup is now included in release and backup
  migrations. Restricted-role tests verify invitation consumption, suspension,
  Studio isolation, and revision conflicts; production and preview schema setup
  passed before deployment. Other feature schema helpers remain.

- Google OAuth storage now relies on release migrations rather than request-time
  DDL. The real callback regression runs with a restricted role and covers replay,
  required scopes, refresh, expiry, account isolation, and disconnect. The isolated
  Neon adapter now emits PostgreSQL timestamp text so freshness assertions exercise
  the driver correctly. Google encryption-key activation remains pending.

- Monthly snapshot mutation now requires analytics.write. Partial provider updates
  merge inside PostgreSQL rather than restoring a stale pre-read row; explicit
  null clears only the selected provider. Google/Klaviyo share this writer and
  the release-owned monthly schema. Restricted-role endpoint tests cover writes,
  read-only denial, invalid batches, and interleaved provider updates.
- Retired the legacy public Google Ads auth/callback routes with HTTP 410. They
  can no longer exchange codes or render refresh/access tokens. Existing configured
  Google Ads reporting credentials remain in use; historical exposure is not ruled out.

- Meta/forecast caches, shared dashboard settings, and analysis cron slots are
  created by release migrations rather than requests. Forecast refresh requires
  analytics.write. Cron-slot completion is fenced by a unique claim token, so an
  expired invocation cannot complete a replacement; unsuccessful dispatches do not
  mark the slot complete. PostgreSQL tests cover duplicate/reclaimed slot behavior
  under a restricted role. Production, preview, and restored-backup migrations passed.

- Creator operations, content storage, creative audit events, and evidence tasks
  now use release-owned schema setup across their request paths. Removed repeated
  note-based rewriting of planned seeding statuses; migrations preserve explicit
  status and edited unit costs. Production and preview migrations passed with
  unchanged seeding-record fingerprints. Restricted-role tests cover audit/evidence
  writes, and restored-data migration checks cover the expanded schema setup.

- Creative assets, analysis queue/columns/dismissals, variant and experiment
  schemas, sync state, reviews, and MAP monitoring no longer initialize schema in
  their normal request paths. Release and restored-backup migrations cover these
  structures; asset backfills remain data operations. Restricted-role tests cover
  asset deduplication, queue ownership, sync checkpoints, and MAP settings/dealer
  registry writes. Production and preview migrations passed.

- Image/copy libraries, hidden Drive assets, asset pairs, and launch metadata now
  rely on release migrations. HTTP schema initialization returns 410 and its UI
  buttons are removed. Library reads preserve explicitly cleared product tags.
  Deleting an image-library entry no longer deletes a caller-supplied/shared Blob
  URL; reference-aware physical cleanup remains outstanding. Restricted-role
  endpoint tests cover library writes, cleared tags, and shared-object preservation.

- Restricted runtime-role provisioning and grant-refresh tooling is prepared and
  tested. It excludes migration-ledger access and verifies denial of schema changes
  and TRUNCATE while allowing data operations and observation triggers. Creating the
  persistent roles and switching Vercel targets awaits explicit approval; neither
  production nor preview has switched credentials. See runtime-database-role.md
  in the operations directory for the cutover and rollback procedure.

- Drive pair replacement now commits deletion/insertion in one serializable
  transaction. A failed insert preserves the previous pair; overlapping changes
  return a conflict rather than assigning one file to two pairs across columns.
  The regression uses the real Neon batch encoding against PostgreSQL rollback;
  three overlapping trials in the isolated preview database each retained exactly
  one pair and rejected the competing transaction. Synthetic records were removed.

## Remaining work / external prerequisites

1. Grant the narrowly scoped AWS permissions in `../operations/backup-provisioning-policy.json`,
   provision the approved private destination, automate backups, and perform a timed
   offsite restore. RPO/RTO targets are documented but not yet proven.
2. Production owner sign-in is verified. Finish the remaining role/suspension browser
   checks, isolate Development credentials and old deployment snapshots, and
   re-encrypt legacy Google OAuth records before retiring the old Clerk secret.
3. Finish reconciliation for uncertain uploads, Meta creative/campaign/ad-set creation,
   Shopify draft/order outcomes, email sends, and unknown Remotion starts. Add render
   cancellation, email delivery/bounce ingestion, and seeding fulfillment synchronization.
4. Bind an entire launch packet (copy, destination, placement, paired deliverables,
   approval and rights exceptions), and preserve historical ad/variant assignments
   at ingestion rather than applying current creative identity to past observations.
5. Establish private media access, lifecycle/retention policy, reference-aware orphan
   cleanup, proactive operational alert delivery, and provider completeness checks.
6. Instrument remaining paid provider paths, configure a complete price book and
   dollar budget reservations, and restrict the runtime DB role. Normal runtime DDL
   has been removed; provisioning the prepared restricted identities needs approval.

See `../operations/recovery.md` for release, backup, authentication, and operation
recovery procedures. Regression checks exercise isolated PostgreSQL and injected
provider failures; actual paid launches, orders, and email sends are not smoke tests.

---

# First hardening release (historical record)

This release addresses the highest-risk defects and adds regression/release
infrastructure. It does not close the entire audit or claim that every production
workflow has been exercised. The original audit describes the pre-fix baseline.

## Changes in this release

| Audit item | Shipped code change | Remaining scope |
|---|---|---|
| 1 — Shopify callback | Retired unsafe public install/token-display endpoints with HTTP 410. Existing server-configured Shopify integrations continue to work. | Assess historical exposure and rotate app credentials if needed; no claim that prior misuse has been ruled out. |
| 2 — Token origin | Origin/path checks with correct Request/URL/Headers handling; regression tests. | Incrementally replace the global compatibility adapter with explicit API clients. |
| 3 — Permissions | Exhaustive Meta action permission map, distinct job/analytics-write/content-publish permissions, restricted publishing/sync controls. | Review all legacy UI controls and broader roles as workflows evolve. |
| 4 — Suspension | Suspended users receive no permission bits; Blob verifies active membership and resolves email consistently. | End-to-end Clerk suspension test in a test workspace. |
| 5 — Queue deletion | Additive refresh preserves newly launched jobs; queue status no longer enqueues/rebuilds pending work. | Monitor production backlog age and throughput. |
| 6 — Launch recovery | Persisted provider step receipts; duplicate step replay; uncertain external results held for review; partial test-launch status; logging failures no longer presented as clean success. | Full launch-level resumability, explicit client request identities, durable media-upload references, idempotent local bookkeeping, and automatic provider reconciliation. An uncertain call intentionally blocks retry until reviewed. |
| 7 — Seeding | Atomic daily reservations, journaled draft creation/completion, idempotent seed-row insert, completed-order dedupe, request-key consistency check. | Automatically reconcile uncertain Shopify outcomes; retry existing drafts independently of catalog/address changes; fulfillment status synchronization. |
| 8 — Render races | Server-owned render coordinates, reject stale overrides, atomic completion/history, preserve editor settings and approved/launched deliverable state, serialize session render starts. | Background completion/recovery for abandoned browsers and start-timeout reconciliation. |
| 9 — Analytics freshness | Extracted resumable sync service with leases, per-page checkpoints, preserved date window, complete-only freshness watermark, bounded batches, token-free stored cursors, scheduled ingestion and Admin visibility. | Batch database writes, alert delivery, timezone/attribution-window audit, and real-account completeness checks. |
| 10 — Launch rights | Server checks linked creator deliverable approval and accepted current paid-media terms; validates creator/brief linkage. | Bind approval to an immutable output revision and resolve creator identity from every asset path; exception workflow. Missing legacy rights/linkage can now block creator launches until corrected. |
| 11 — Stalled queue | Exhausted expired leases become failed; stale failure writes guarded by attempt; cron slots recover after expiration; worker dispatch checks elapsed time. | Full job-level lease ownership and hard per-job time budgets; throughput tuning. |
| 12 — Variant identity | No schema/behavior change in this release. | Separate media from creative-copy/placement/experiment identity and migrate downstream analytics safely. |
| 13 — Email recovery | Journaled send receipt and idempotent outreach record; post-send bookkeeping can reuse the provider result instead of sending again. | Provider delivery/bounce events, automatic uncertain-send reconciliation, deduplicated activity log, and operator recovery UI. |
| 14 — Concurrent editing | Atomic optimistic-revision saves; preserve server-owned render metadata; serialize frontend saves; display HTTP save failures. | Server-backed cross-device launch drafts, per-user local-cache migration, immutable approval versions, unsaved-navigation handling. |
| 15 — Source import | Validate DNS/IP/protocol/port, pin validated addresses, revalidate redirects, bound response bytes and total time, reject unsuitable content types. | Apply the utility to all other scraping paths and broaden adversarial integration coverage. |
| 16 — Invitations | Expired invitations no longer grant workspace membership. | Atomic invite consumption/provisioning and concurrent acceptance tests. |
| 17 — Dependencies | Coordinated Remotion update to 4.0.521, compatible lockfile security fixes, Vite 6.4.3; npm reported zero vulnerabilities after install. | Continue advisory monitoring; validate every provider-specific production code path over time. |

## Infrastructure included

- GitHub Actions checks: install, API syntax, regression tests, frontend build,
  and high-severity dependency audit.
- Isolated PostgreSQL tests cover an empty schema, role boundaries, invitations,
  queues, operation replay/uncertainty, atomic seeding budgets, editor revisions,
  stale render completion, resumable analytics, and creator-rights preflight.
- Additive versioned release migration; runtime schema helpers remain for
  compatibility. Eliminating runtime DDL and restricting the DB role is a later
  migration, not claimed complete here.
- Admin panels for uncertain/stalled external operations and sync freshness.
- Hourly per-user limits on inspected generation, transcription, render, and
  analysis routes; render source/output-duration bounds. These are request limits,
  not a dollar-denominated cost ledger or comprehensive provider concurrency limits.
- Tool-level React error boundary and corrected local environment/redirect handling.

## Still required from the broader infrastructure roadmap

Verified backup/restore exercises and recovery objectives; proactive alert delivery;
private-media/access and retention policy; orphan media cleanup across Blob/Drive/S3;
cross-device launch drafts; experiment protocols and statistical evidence thresholds;
asset-version approval packets; full external-operation reconciliation and operational
runbooks; isolated preview credentials and authenticated browser workflow tests.

## Release verification

`npm run check` passes locally, including 13 PostgreSQL/security regression tests.
The versioned Remotion 4.0.521 function/site passed a 105-frame synthetic render with no fatal errors. Database migration and deployment results are recorded in the
task's final release report; passing local tests is not a substitute for those steps.

## Shared media retention and submission retries

Record deletion for callout images/layouts and UGC sessions now retains physical
media. Creator upload validation and database failures also preserve source files:
a lost acknowledgement can follow a committed submission. An exact retry using
the completed submission token and its stored video URL returns success without
creating another session. A different video remains rejected.

A PostgreSQL regression injects a failure after the submission commits, verifies
the source is retained, and retries the same request. The Blob SDK deletion mock
is checked with a canary and blocks real network access. Reference-aware garbage
collection and private media access remain unfinished; retention can accumulate
unreferenced files until that lifecycle is implemented.

## Recovery account binding

Meta ad receipt recovery now requires the provider account, configured account,
and journaled request account to agree. Invalid attempt timestamps fail closed.
A real PostgreSQL regression verifies successful receipt/audit persistence and
that a concurrent journal update preserves the winning result without recording
a false recovery audit. Rejected provider evidence leaves the attempt uncertain.

## Shopify seed completion preflight

Immediately before sending a new completion mutation, the server reads the saved
draft and checks its store, ID, open status, single variant/quantity, and strict
zero total. A read or validation failure sends no completion mutation and can be
retried safely. Journaled successful completions still replay without new calls.
The endpoint regression uses PostgreSQL and a mocked Shopify boundary to prove
nonzero drafts are rejected, corrected drafts retry, and completed retries do not
repeat the order or activity event. Shopify calls now have a 20-second deadline.

This read is not an atomic Shopify lock: concurrent merchant edits between the
read and completion remain possible. The 2026-04 completion mutation exposes no
expected-version or expected-total argument. Unknown completion receipts still
require reconciliation; this change does not reset those attempts.

## Known Shopify draft completion recovery

A saved draft with a pending/uncertain completion older than ten minutes can now
recover its receipt through a read of that exact Shopify draft. Recovery requires
a completed order, matching store, variant/quantity, zero total, and compatible
completion time. A compare-and-swap journal update and its audit commit together.
No new completion mutation is sent to resolve uncertainty. Unknown draft creation
and fulfillment synchronization are still open.

Seed status and activity now commit in one SQL statement. The endpoint regression
injects an activity-write failure after Shopify success, verifies local rollback,
and retries without another provider mutation. It also simulates a lost Shopify
response, refuses a fresh retry and conflicting provider evidence, then recovers
the verified order after the uncertainty window without duplicating it.

## Creator email receipt integrity

New email request hashes bind creator identity and follow-up date as well as the
recipient, subject, body and agreement. A provider success without a message ID
remains uncertain instead of recording a sent email. Gmail sends have a 30-second
deadline. Outreach, agreement status and activity records commit atomically.
The endpoint regression proves rollback after activity failure, receipt replay
without another send, cross-creator rejection, and missing-receipt quarantine.

Old email journal payloads lack the new bindings, so retrying those exact request
keys returns a conflict and needs receipt review; the server never silently
rekeys or resends them. Email delivery/bounce ingestion and provider-specific
uncertain-send reconciliation remain open.

## Browser seeding retry identity

The creator workspace no longer generates a fresh order key on every retry. A
per-user/per-creator pending fingerprint and request ID survive browser reloads;
Web Locks coordinate tabs. Different unresolved order details are refused. No
address or notes are persisted by this helper. The key is cleared only when the
server confirms ordered status, and the form resets before workspace refresh, so
a failed refresh cannot leave the submitted form ready for an accidental repeat.
Storage/lock failures stop before sending the order request. Tests cover reuse,
concurrent callers, changed pending inputs, user isolation and stale completion.
Cross-device pending-intent discovery and an explicit cancel/reconcile flow for
changed unresolved orders remain necessary; clearing browser storage is not a
safe way to resolve provider uncertainty.

## Agreement email replay after acceptance

Agreement eligibility is now checked inside the journaled send callback, before
a new external send. A completed send receipt can replay its local bookkeeping
after the agreement is accepted or revoked, preserving the current agreement
status. Pre-send validation failures are known not to have sent email and remain
safely retryable. The endpoint regression simulates activity failure, subsequent
acceptance, and successful replay with one provider call; a new send for the
accepted agreement is still denied.

## Gmail reply ownership and replay

Reply sync now selects outbound messages created by the current workspace member
before using that member's Google token. Sender matching compares the exact email
address, including display-name forms, rather than accepting address substrings.
New replies use a mailbox/creator/message request key and commit their activity
atomically; concurrent syncs cannot insert duplicates. Legacy unkeyed replies
from the same member are not re-imported. Network calls share a 45-second deadline.
A PostgreSQL regression verifies concurrent deduplication, exact sender matching,
replay and preservation of another member's outbound message.

Production environment inspection on September 7 found Google OAuth configured,
no RESEND_API_KEY, and no Shopify seeding enable switch or separate seeding token.
Resend delivery/bounce ingestion requires provisioning if that provider is chosen;
creator email currently uses each member's Gmail connection. Shopify recovery code
is deployed behind the disabled seeding switch. Neither service was enabled.
Browser verification is additionally unavailable while the Mac is locked.

## Integration setup guidance

The admin Gmail health panel now directs operators to the V2 migration runbook
and warns against replacing the legacy key in place. Configuring V2 is explicitly
distinguished from proving existing-token migration. Shopify health distinguishes
a disabled switch, missing seeding token, missing catalog credentials, and fully
configured credentials whose permissions still require verification. Regression
coverage verifies those configurations without calling external services.

## Uncertain Gmail send recovery

New Gmail sends carry a stable RFC Message-ID and journaled provider binding.
After ten minutes, an unchanged retry can recover one matching Sent-folder message
only after checking its original ID, recipient, subject, plain-text body and
attempt time. A conditional journal update and audit commit together; local
bookkeeping then replays without another send. Missing/conflicting evidence
remains uncertain. Legacy unbound sends and non-plain-text transformations still
require review; recipient delivery and bounce ingestion are not claimed here.

The endpoint regression exercises encrypted Google connection lookup, OAuth token
refresh, generated MIME, lost send response, delayed search, verified receipt
recovery and local replay with mocked provider responses. It makes one simulated
send and records one outreach/audit. No live message was sent.

## Meta campaign receipt recovery

Admin Operations now supports the paused campaign requests emitted by Howl, using
an existing provider ID and review note. It verifies the original account, name,
objective, paused status, special-ad categories, budget sharing and attempt time;
unsupported payload fields fail closed. Receipt/audit persistence uses the same
conditional atomic recovery path as ads. A read-only production query returned
all required fields through the configured Meta API. PostgreSQL tests verify
recovery and rejection of mismatched evidence. No campaign was created, modified
or activated. Ad-set and creative creation recovery remain open.

## Upload purpose and size boundaries

Browser upload tokens now enforce known pathname purposes: creator footage and
contracts require creators.write; editor, callout, studio and draft media require
assets.write. Contract/image tokens allow 20 MB with purpose-specific MIME types;
video and public creator-submission tokens allow 2 GB, matching transcription's
source limit. Unknown and traversal-like destinations are rejected. The browser
checks returned limits before sending file bytes; signed Blob tokens enforce them
independently. Tests decode a real SDK-generated token to verify path, MIME and
size constraints and confirm session credentials are excluded.

This is not private media storage. Existing direct URLs, server-side mirrors,
render outputs, authenticated download gateways, ownership registration and safe
reference-aware cleanup still require the coordinated storage migration.

## Trusted browser-upload ownership

New browser upload tokens carry compact server-issued owner/scope metadata, never
Clerk session credentials. Signature-verified Blob completion callbacks record
URL, path, owner, purpose and content type in app_media_objects. The configured
store and purpose must match. Replays update last-seen time; an existing URL cannot
change owners. Signed callback processing is independent of token-request rate
limits, and registration failures return 503 for retry. Legacy tokens without
ownership metadata are ignored rather than assigning an invented owner.

All 93 regressions passed, including real SDK callback signature verification,
forged callbacks, replay, ownership conflicts and database failure/retry. A fresh
owner-only local backup restored 79 tables and 17,700 rows in 6.94 seconds and
passed the expanded migrations. Production and isolated preview migrations passed.
This does not prove offsite recovery or register old/server-side media; private
access, existing-object attribution, downstream consumers and cleanup remain open.

## Private contract storage — September 7

Created the separate `howl-private-media` Blob store in `iad1`, connected only to
Howl production as `HOWL_PRIVATE_READ_WRITE_TOKEN`. The existing public store
credential was preserved. A live synthetic PDF upload returned 403 anonymously,
was read successfully with the private credential, and was deleted after checking.

New `creator-contracts/` browser uploads now receive a private-store token and
server-selected access mode. Missing private configuration fails closed. The SDK
verifies callbacks against the selected store credential before recording immutable
ownership; intake requires that verified PDF to belong to the current member before
making business-record writes. If the provider callback has not arrived, intake
returns a retryable verification error without creating records.

The existing permission-gated contract endpoint reads registered private contracts
through the Blob SDK. Reads are streamed, capped at 20 MB and bounded by a deadline;
credentials are never sent to a caller-controlled host. Legacy public contract reads
now use pinned public DNS and checked redirects with PDF-type, byte and time limits.
Unicode filenames use an encoded Content-Disposition parameter. Responses disable
caching and content sniffing. Regression checks cover forged and replayed callbacks,
cross-member attachment, missing-registration/no-write behavior, real SDK private
reads against a mock provider, authenticated streaming, unauthenticated denial,
byte limits and browser access headers. All 95 tests and the build passed locally.

This release does not migrate or retire existing public contracts. Other source,
rendered and published media still need coordinated private access and migration.
Real member browser verification, old deployment retirement, runtime database roles,
Google encryption cutover and offsite backup permissions remain external prerequisites.

## Existing contract migration — September 7

The four pre-existing uploaded contract PDFs (agreement IDs 14–17) were copied to
private storage and their agreement/upload-activity references moved atomically.
The migration registered each original owner and recorded one audit event per
agreement. Source and destination hashes matched; private anonymous reads returned
403. Independent production reads through `getPrivateContract` verified the four
PDF hashes and preserved all agreement fields other than the URL, the URL embedded
in the intake record's description, and its update timestamp. Contract status,
version, owners and PDF contents were preserved. Owner-only manifests, original
record snapshots and PDF recovery copies are stored outside the repository.

`scripts/migrate-contract-media.mjs` provides plan, apply and separate public-copy
retirement stages. It snapshots references, compares complete records before an
atomic update, validates private copies and checks all public-table references before
retirement. The regression test injects registration failures and concurrent activity
and agreement edits, proving rollback and preventing duplicate migration events.
All 96 regression tests passed.

**Public-copy retirement is not complete.** Automatic approval review rejected
removing the four existing public objects because the user must explicitly authorize
their retirement. No deletion ran; all four original public URLs still returned 200
after migration. The private copies and recovery copies remain intact. This requires
approval before the `--retire-public` stage, not another copy or database migration.

## Source-bound playback grants — September 7

Playback grants now bind the session ID and a SHA-256 fingerprint of its stored
source URL, with versioned claims, issued-at time and a maximum ten-minute lifetime.
The source endpoint verifies the stored URL again before making a provider request,
so replacing a session's video invalidates old links. Malformed framing, extra token
segments, invalid IDs, future issuance and excessive lifetimes are rejected.

Production, preview and development each received a distinct generated
`UGC_SOURCE_TOKEN_SECRET`; production and preview values are sensitive Vercel
variables. Signing requires that dedicated key. Clerk/database credentials and a
static production fallback are no longer used. Missing signing configuration returns
503 at issuance; grant responses disable caching. Existing playback links require a
refresh after rollout. This does not sign users out of Clerk.

Regression tests exercise the actual source endpoint: a valid HEAD request succeeds,
then replacing its stored source causes the old grant to return 401 without another
provider fetch. Unicode video filenames are encoded safely in Content-Disposition
instead of producing invalid response headers. All 98 tests passed. This is a playback-access prerequisite; the one
existing source video and eleven callout images remain public, and private processing,
long-edit-session playback renewal and migration still need completion.

## Playback renewal during editing — September 7

The editor renews playback grants before expiry and when a suspended tab returns.
A temporary renewal failure retains the current grant until its expiry; expired or
access-denied grants are cleared rather than retried as unauthenticated media URLs.
Requests have a twenty-second deadline, deduplicate concurrent refreshes, and ignore
late responses after timeout or disposal. A returned source URL must match the
editor's selected source. Changed sources and 401/403 responses stop automatic
renewal until the session is reloaded. Playback errors clear on successful recovery
without clearing unrelated editing errors.

The source video preserves its seek position and paused/playing state when the URL
changes. Remotion retains its frame during normal renewal and saves/restores the
frame and playing state if an outage expires the grant and unmounts the preview.
Restoration is scoped to the same session/source and cannot carry an old video's
position into a newly selected session. The token endpoint includes its source URL
for the client's consistency check; signed access remains limited to ten minutes.

All 102 tests passed, including deterministic expiry/outage/focus simulations,
permission denial, source mismatch, a late response that ignores abort, and scoped
source/preview position restoration. Real member browser verification remains
pending: the Mac was rechecked and is locked. This release does not migrate the
remaining public source video or images, or retire the four public contract copies
that still require explicit approval.

## Private editor source uploads and processing — September 7

New `ugc-source/` uploads use the configured private Blob store. The verified Blob
callback records ownership before a member can attach a private upload to a session;
a delayed callback returns a recoverable 409. Playback issues native Blob grants
restricted to the exact registered pathname, operation and expiry. The browser
checks the returned destination and renews ten-minute grants. Proxy compatibility
uses separate GET and HEAD grants. FFmpeg transcription/rendering and Remotion
receive scoped read URLs; delegation signing material and store credentials stay
server-side. Remotion's render grant lasts thirty minutes. Errors redact private
media URLs so signatures are not stored in session error messages.

Extracted audio from private sources stays private and is registered to the member.
Whisper receives audio bytes. Legacy public sources retain their current behavior;
this change does not migrate the existing public source, callout images, creator
footage or render outputs. Public contract retirement remains pending approval.

Verification includes actual SDK delegation/callback checks, upload ownership and
registration gates, destination validation, and real FFmpeg decoding through the
transcription handler with a mocked speech provider. A temporary synthetic object
in the production private store rejected anonymous access and pathname/operation
tampering, supported signed range reads and HEAD, and decoded through FFmpeg. Only
that newly created canary was deleted. No member data or paid render/transcription
request was used for the canary. Real member browser verification remains pending.

## Legacy FFmpeg render ownership and deadline — September 7

The local renderer validates input before changing session state and reserves the
shared render work budget. It claims the exact source/revision with a unique attempt;
rendering, uncertain-render and transcription states exclude a competing claim.
Successful publication checks the attempt, revision, source and active state, then
updates the session, eligible deliverable and activity atomically. Late failures
cannot mark another attempt as failed. Session edits cannot change active job state
or replace protected FFmpeg metadata. Lambda claims now also check source/revision
and exclude active transcription.

A four-minute processing deadline kills FFmpeg and cancels Blob upload; network
reads have a thirty-second timeout. The recovery cron marks local jobs interrupted
after six minutes, beyond the function's five-minute maximum runtime, making them
retryable without duplicating a still-running local process. Provider-start
uncertainty remains quarantined separately. Regression checks cover competing and
stale claims, guarded edits/publication/failure, interruption recovery, actual
subprocess termination, and invalid requests leaving session state unchanged.
Rendered output privacy and reference-aware orphan cleanup remain outstanding.

## Saving after transcription — September 7

Transcription returns the revision that its guarded database write committed. The
editor retains that revision for automatic upload transcription, manual transcription
and auto-edit transcription, so the next edit uses the correct optimistic-lock
version. The handler regression now follows real FFmpeg extraction and a mocked
speech response with a session edit using the returned revision, proving the next
save succeeds. This does not substitute for real member browser verification.

## Render failure privacy — September 7

Lambda status polling and background render recovery redact private media URLs
from provider errors before returning or persisting them. The browser status route
no longer returns the raw provider progress object on a fatal error, because nested
provider diagnostics can contain signed source capabilities. Recovery regressions
exercise both fatal render errors and thrown polling errors and verify that neither
the returned result nor the stored session error retains the signed URL.

## Existing source migration preparation — September 7

A fresh production inventory confirms one remaining public editor source (session 1,
51,370,969 bytes), with an owner and no references outside its session. Private-video
migration tooling now verifies a recovery copy, source hashes, exact destination,
anonymous denial, unchanged row state and registry ownership. A single database
statement updates the session and registration or rolls back both; tests cover
concurrent edits, registration failure and replay. The tooling never deletes the
public original. Execution was rejected before starting by automatic approval review
pending explicit approval of this production video and private destination. See
`../operations/private-video-migration.md`; no source video was migrated in this step.

## Terminal render state protection — September 7

Lambda completion only publishes while the matching render is active. Replaying
the same completed render/output returns its existing receipt without rewriting
session history, timestamps or deliverables; a contradictory output is rejected.
Provider failure updates likewise require the matching active render, so a late
failure response cannot regress completed output. Browser polling reports a conflict
when its response is superseded, and cron recovery does not fail/release another
attempt's work. Regression coverage compares the full saved session before/after
completion replay and rejects contradictory completion and late failure writes.

## Approval context snapshots — September 7

Deliverable approvals now capture the linked brief content and engagement terms
alongside the media fingerprint. Launch preflight compares those immutable snapshots
with the current records rather than relying only on unchanged record IDs. A changed
script or engagement restriction requires reapproval. Routine status/timestamp and
creation-metadata changes are excluded from the comparison. Legacy snapshots without
a context version require review again; a production aggregate check found zero
current approval records in approved/complete/launched deliverables at this release.

Regression coverage changes a linked script and engagement restriction independently,
checks rejection, reapproves and verifies acceptance, and confirms a routine brief
status change remains allowed. This is not approval of the full launch packet: copy,
destination, placement, paired outputs and explicit rights exceptions still need a
complete packet workflow. It also does not establish that changing engagement terms
changes any previously accepted agreement; acceptance evidence remains a separate
rights concern.

## Agreement terms and consent binding — September 7

New generated agreements persist the engagement terms and creator details used to
prepare their text. Creation compares the engagement row with that reviewed snapshot
before inserting, returning a conflict if it changed. The public agreement view uses
the stored terms and party details rather than later engagement/profile edits.
Acceptance requires the content digest returned by the viewed agreement and guards
its database write against changed text, metadata, recipient and version. Agreement
responses are private/no-store. A legacy link without verified terms requires a new
agreement; a fresh production inventory found four uploaded PDFs and no token links,
so this release does not reinterpret an existing live acceptance link.

Paid-media preflight additionally requires an accepted agreement whose stored terms
match the current engagement. Reapproving a deliverable alone does not make changed
terms accepted. Tests exercise the actual preparation/view/acceptance handlers,
changed fees/duration/party details, changed consent text, a racing preparation,
legacy rejection and launch rejection until a matching accepted agreement exists.
Tests use isolated records and do not send agreements or create production consent.
The full launch-packet approval workflow remains outstanding.

## Acceptance response recovery — September 7

An identical agreement acceptance retry returns the saved confirmation, including
its original acceptance time, without updating consent or emitting another activity.
The retry must match the accepted name/email and viewed-content digest. The same
check handles a concurrent request that loses the guarded acceptance update. Changed
consent or identity is not treated as a successful replay. Handler tests issue
concurrent acceptance requests, replay the result, compare the entire stored record
and assert a single acceptance activity; a different signer is rejected.

## Internal notes versus agreed terms — September 7

Internal engagement notes are excluded from approval and accepted-terms comparisons.
They are not part of the rendered agreement terms; changing a scheduling note must
not invalidate consent or prevent launch. Stored snapshots remain intact, including
older snapshots that contain notes. The comparison ignores only that internal field
in addition to the previously excluded workflow metadata. The launch regression now
updates internal notes and verifies continued eligibility, while changed contractual
restrictions still require review and matching acceptance.

### September 9: authenticated owner and editor verification

The production browser session reaches the workspace as Nicholas with OWNER access;
the user menu shows the approved owner email. This clears the real owner sign-in
verification prerequisite. The existing UGC session loads its transcript and source,
and the Remotion preview advances during playback with no media error.

The saved finished render was unavailable in the browser despite its public Blob
returning HTTP 200 and video/mp4. Its video element now requests anonymous CORS,
compatible with the page's require-corp isolation and Blob's allow-origin response.
The finished-render Download and Send to Launcher handlers now invoke their helpers
without passing React's click event as the media URL. Production media and launch
records were not changed during these read-only checks.

Production verification after deployment: the existing finished render reports
17.8 seconds, readyState 4, anonymous CORS, and no media error. The superseding main
deployment includes the editor fix; its earlier queued deployment was canceled.

### September 9: agreement version allocation and audit atomicity

Prepared agreements and uploaded PDF agreements now lock the same creator row in
a Read Committed transaction before allocating the next version. The following
statement sees the preceding writer's committed agreement. Both paths insert the
agreement and its activity receipt in one data-modifying CTE, so a failed activity
write cannot leave an unreported agreement behind. Prepared terms still use the
snapshot comparison and reject a changed engagement.

Isolated PostgreSQL handler regressions cover distinct prepared versions, uploaded
version allocation, and injected activity failures rolling back agreement inserts.
PGlite serializes transactions; these tests do not establish cross-connection lock
behavior on production. The wider investment intake remains a multi-step operation;
this change does not claim atomicity for its other creator, seeding, or flow records.
Validation: backend syntax checks, all 121 regressions, and the production build pass.

### September 9: bind reused creatives to their recorded content

Creating an ad from a saved creative now requires an unambiguous completed creation
receipt in the configured Meta account whose payload matches its saved hash. The
server compares supplied headline, copy, destination, attribution tags, and optional
page/Instagram identity with that receipt. It rejects changes before dispatching an
ad request and derives launch-log content from the receipt. Carousel card headlines
and descriptions participate in brand checks; the unused parent headline is not
misreported as rendered content. Media ownership lookup uses the same account-bound
receipt reader.

The actual endpoint regression rejects changed content and unknown creatives before
any provider call, then verifies lost-bookkeeping-response recovery still creates
one ad and records the original creative content. Format tests cover video,
carousel, foreign-account receipts, identity mismatches, and altered stored payloads.
This is one part of launch-packet integrity: paired deliverable approval, placement
snapshots, explicit rights exceptions, and a unified review artifact remain open.
Provider edits made outside HOWL are not detected by a creation receipt alone.

### September 9: restore Launcher dispatch after product-claim checks

Both the Drive and cart launch callbacks referenced an undefined `issues` array.
Valid copy could therefore fail before the first launch request, potentially after
the batch wrapper had created an ad set. Each callback now evaluates its own claim
conflicts and displays the first conflict; the shared preflight checks remain.
Regressions execute the actual component callbacks with a stopped request boundary:
valid copy reaches the expected Drive or media-upload request, while conflicting
product weight claims produce no request. No production upload or launch was used.

### September 9: immutable pre-dispatch launch snapshots

Every new ad request through the shared Meta dispatcher now captures a versioned
snapshot before the provider mutation. It contains the submitted ad payload,
verified account-bound creative creation receipt, observed ad-set targeting and
configuration, actor, media/Drive upload receipts, attribution context, and exact
creator approval and accepted-agreement references. Approval evidence is checked
again after uploads and must still match the evidence checked at launch entry.

Snapshots are append-only journal entries with a hash checked on reads. The pending
ad operation links its snapshot before dispatch; successful responses and manual
uncertain-ad recovery preserve that link. A failed snapshot write or unverified
ad-set read prevents the ad request. Completed legacy retries retain their original
receipt without inventing a historical snapshot. The authenticated Launch Log has
an on-demand, read-only snapshot view; older launches explicitly show no snapshot.
No schema migration or new production credential is required.

Validation: all 129 regressions, backend syntax checks, and the production build
pass. Tests exercise ordering before dispatch, receipt/date serialization, replay,
snapshot-write failure, foreign-account targeting, approval changes, uncertain
recovery, integrity failure, and unauthenticated reads. A read-only production Meta
request returned HTTP 200 with matching account and targeting for the requested
ad-set fields. Field reference: [Meta's Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi).

This records configuration and preflight evidence, not a claim of human approval
of every field. Full pre-dispatch packet review, paired-deliverable approval and
explicit rights exceptions remain open. Creative creation receipts do not prove
the absence of subsequent provider edits, and targeting snapshots do not establish
actual placement delivery. Snapshot capture is tested with injected provider
responses; no paid ad was created for verification.

## Launcher confirmation binds reviewed intent — September 9, 2026

The unified Launcher now prepares an authenticated review before confirmation.
It displays effective copy, destination, tags, account identities, media references
and fingerprints, targeting/budget configuration, paired placement rules, and
current creator approval/agreement evidence. The selection and settings are
compared again at confirmation. Cancelled or stale preparations cannot dispatch.
The final server snapshot compares the confirmed plan with the creative receipt,
media upload receipts, fresh approval evidence, and current ad-set configuration
before sending the paused ad to Meta. Comparison failures do not send the ad.

Remote media hashes stream with byte/time limits and bounded concurrent review
leases; inline assets use SHA-256 and Drive assets use their content checksum.
New ad-set creation and review share one secret-free request builder. The resulting
configuration must match that request; if Meta supplies different targeting or
optimization defaults, the operator must select the created paused ad set and
review its observed configuration before retrying. No ad is dispatched on drift.

Validation includes stream overflow and exact-byte checks, malformed/duplicate
media rejection, copy/rights/placement/targeting changes, creation-receipt binding,
endpoint authorization and lease cleanup, actual Launcher preparation/confirmation
callbacks, and the real journal wrapper rejecting drift before provider mutation.
No real ad or ad set was created for these checks. Legacy publishing tools still
lack this human-review UI; their snapshots explicitly contain no confirmed review.
Paired external deliverables and rights-exception workflows remain outstanding.

## Deliverable counts reflect one linked output — September 9, 2026

Approving the current output previously credited the entire expected asset count.
For a three-asset deliverable, one reviewed file therefore appeared as three
approved files. Approval now establishes a minimum count of one. Re-reviewing the
same output does not add another asset. Completion and launch status updates no
longer increase approval counts or silently credit all expected outputs as
complete/shipped. Explicitly entered totals are preserved, and the UI explains
that operational totals can include manual entries rather than exact-output
approval evidence. Count inputs refresh when an approval or status response
changes the server value.

A PostgreSQL regression exercises the actual workflow endpoint with three expected
outputs, completion without approval, exact-output approval, repeated review, and
manual counts followed by status changes. Existing historical totals are not
reconstructed from insufficient evidence. Paired deliverables still require
per-asset approval and launch bookkeeping before their current rejection can be
safely removed; this release does not relax that gate.

Overdue production summaries, creator guidance, and admin health also compare
completed against expected counts even when the linked output has a terminal
status. Cancelling a deliverable remains an explicit exclusion. The regression
verifies that two of three expected assets remain overdue after the first is
marked launched.

## Independently approved Drive pairs — September 9, 2026

The Drive pair path can now launch two separately approved outputs from the same
creator. Each registered file resolves to one unambiguous deliverable and must
pass its own current agreement, brief/terms snapshot, output approval, and Drive
checksum checks. A selected deliverable must belong to the pair; an explicitly
selected brief must match both. Additional media references, mixed creators,
ambiguous ownership and unsupported non-Drive bundles remain rejected. Evidence
is rechecked before dispatch, and the confirmed review contains both approvals.

Post-dispatch bookkeeping binds the feed and story assets to their respective
approved deliverables and updates only those flow cards. Each deliverable receives
credit for one output; retries preserve those counts. Missing workspace records or
changed approval identities cause a visible bookkeeping error while the known ad
receipt and captured packet remain available for reconciliation. The pair gate
requires both files in the workspace before any upload or ad creation.

Regression coverage uses isolated PostgreSQL and injected Drive checksums to
exercise two approvals, rights revocation, checksum drift, changed approvals,
wrong/ambiguous ownership, selected-deliverable mismatch, independent placement
attribution and replayed bookkeeping. No production ad was created. Non-Drive
paired deliverables, mixed-creator packets and explicit rights exceptions still
require separate work; this release does not relax those gates.

## Independently approved cart image pairs — September 9, 2026

Cart image pairs now bind feed and story to two distinct, independently approved
outputs from one creator. Review preparation uses the exact two image URLs;
provider dispatch resolves both upload IDs from the account-scoped registry and
checks their bytes against the corresponding approval fingerprints. Additional
media references, unknown uploads, mismatched creator/deliverable selection,
ambiguous outputs and revoked rights remain rejected. Approval evidence remains
identical across preparation and upload, so the confirmed review can be verified
before dispatch.

Successful pairs retain one launch-history row and two placement-specific asset
receipts, each linked to its own deliverable. Progress updates compare approval
identity and credit only one output per deliverable. A local write failure reports
the known ad ID; replay resumes bookkeeping using the existing provider receipts.
The actual Meta handler regression forces the story receipt to fail, then confirms
that retry produces two correct asset records with exactly one ad and creative.
It also exercises the confirmed review through dispatch, changed upload bytes,
missing receipts, extra sources, mismatched selections and agreement revocation.
No production ad was created. Mixed-creator packets, arbitrary multi-asset bundles,
legacy publisher review UI and explicit rights exceptions remain open.

The complete confirmed-review regression also exposed two shared gaps: paired
Meta image IDs use `hash` inside `asset_feed_spec`, and blank tracking inputs
receive server defaults. The resolver now includes both paired image receipts;
Launcher and server share tracking-tag normalization so the reviewed tags match
actual dispatch. Review preparation also compares freshly fetched media hashes
against approval evidence before presenting a launch-ready review. Existing source
provenance remains in validation; additional unapproved references are not removed
to make a pair pass.

## Legacy manual publishing review and ordered carousels — September 9, 2026

The legacy Publish screen's manual single-ad and Push All actions now prepare a
frozen review before uploading. Operators see effective copy, destination,
tracking tags, Page identity, targeting/budget, media fingerprints and approval
evidence. Confirmation rejects changed queue contents or settings, and the actual
publishing callback refuses unconfirmed work. Remote Blob videos use the URL upload
path; creator/deliverable/source metadata is retained through creative and ad
creation.

Carousel review supports two to ten ordered cards. Server comparison binds each
card's image bytes, headline, description, destination and action, and rejects
provider order optimization. Remote fingerprint preparation has an overall time
budget. The actual Meta handler test rejects a reordered review before any ad
request and captures a successful two-card reviewed launch with both media
receipts. Component callback tests verify confirmation gating, plan propagation
and stale-queue rejection. No production ad was created.

Creative-test batch publishing still needs review integration, including its new
campaign/ad-set intent. Multi-creator and arbitrary multi-deliverable carousels
remain rejected; this release does not introduce rights exceptions or relax those
approval requirements.

Ad-set capture and review comparison now include `bid_amount`, so changing a
cost cap while retaining the same bid strategy invalidates the review. The actual
carousel dispatch regression checks this failure before any provider ad request.

### Creative-test validation and identity follow-up

Creative-test settings now use a shared secret-free campaign/ad-set intent builder.
Invalid budgets, bid caps, IDs, destinations and incomplete uploaded assets are rejected
before campaign creation. Batch results use stable cart item IDs, preserving attribution
and avoiding duplicate-name status mix-ups. Remote videos use URL uploads. Legacy
publishing rejects paired feed/story assets and directs them to the paired Launcher.
Validation: full API/test/build check passed; an additional actual dispatch regression
proves invalid requests make no provider call. No production ad was created.
Full creative-test human review and per-item immutable review binding remain open.

### Creative-test review and dispatch binding

Creative-test batches now prepare and display each item's media fingerprints,
approval evidence, copy, destination and campaign/ad-set intent before uploads.
The dialog shows per-creative and total daily budgets and the cost cap in dollars.
Queue, selection or settings changes invalidate confirmation. The API requires
confirmed batch reviews before campaign creation; each fresh ad dispatch rechecks
its own current approval evidence, uploaded bytes, creative content, account-bound
campaign/ad-set creation receipts and live campaign/ad-set configuration. Snapshot
packets now retain the campaign and per-item review. Card copy receives brand checks.

Validation: 146 tests plus API syntax and build passed. Actual handler regressions
cover missing reviews, changed caps, swapped media, unexpected campaign budgets,
duplicate creative names, separate ad sets/snapshots and completed-request replay.
A callback regression proves changed test settings prevent upload. Final campaign
budget checks passed focused regressions and API checks; dialog build passed.
No production campaign or ad was created for testing. Provider-added targeting
defaults that differ from reviewed intent fail closed and require review of the
created ad set in Launcher; this recovery path still needs a live operator trial.

### Mandatory review for fresh ad dispatch

The shared Meta/Drive dispatch boundary now rejects fresh ad requests without a
confirmed version-1 review before provider reads or writes. The review verifier
also rejects absent plans. Completed operation receipts still replay without a
new review or a new ad mutation; historical snapshots are not rewritten.
The unused legacy UGC inbox import now aliases the reviewed unified Launcher,
removing its separate unreviewed dispatch implementation. Creative-test guidance
no longer presents a cost cap as a guarantee of achieved acquisition cost.

Validation: 146 tests, API syntax and production build passed. Regression coverage
rejects absent/unconfirmed/unsupported reviews with zero provider calls, verifies
completed receipt replay without a plan, and retains the real handler's injected
post-ad bookkeeping failure test (one provider ad, one recovered local launch).

### Recoverable UGC session creation

Session creation now uses an actor-scoped creation identity and an atomic unique
insert. The retained upload URL identifies retries from existing clients; explicit
stable creation keys allow intentional additional sessions for the same source.
An identical retry returns the current session without overwriting later edits.
Changed original details under the same identity return a 409 conflict. Private
media ownership is still checked on every request, including retries.

Validation: 147 tests, API checks and build passed, including actual private-upload
handler replay and permission checks. Eight concurrent real preview requests
returned one session; only the uniquely scoped test records were removed and
cleanup was verified. Additive migration `2026-09-09-session-creation` applied to
preview and production; both columns and the valid unique index were verified.
Production retained its one existing session. Historical rows are not merged or
backfilled with inferred creation identities. No production test session was made.
