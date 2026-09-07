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
2. Complete production authentication deployment and real member sign-in verification;
   isolate preview databases/provider credentials; re-encrypt legacy Google OAuth
   records under a dedicated key before retiring the old Clerk secret.
3. Finish reconciliation for uncertain uploads, Meta creative/campaign/ad-set creation,
   Shopify draft/order outcomes, email sends, and unknown Remotion starts. Add render
   cancellation, email delivery/bounce ingestion, and seeding fulfillment synchronization.
4. Bind an entire launch packet (copy, destination, placement, paired deliverables,
   approval and rights exceptions), and preserve historical ad/variant assignments
   at ingestion rather than applying current creative identity to past observations.
5. Establish private media access, lifecycle/retention policy, reference-aware orphan
   cleanup, proactive operational alert delivery, and provider completeness checks.
6. Instrument remaining paid provider paths, configure a complete price book and
   dollar budget reservations, remove runtime DDL, and restrict the runtime DB role.

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
