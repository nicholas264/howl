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
