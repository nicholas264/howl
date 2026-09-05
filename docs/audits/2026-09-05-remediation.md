# Audit remediation — first hardening release

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
