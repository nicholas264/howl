# HOWL Ad Engine — code and architecture audit

Reviewed September 5, 2026. Repository: `/Users/nicholaskirchner/howl-ad-engine`.
Baseline: `fe27b75dc239b708e0569273e70b9726917ab3c5` — “Improve copy library editing and mobile launch UX.” Working tree was clean at the start.

The app has substantial functionality: creator acquisition and agreements, seeding, briefs and deliverables, static/video creation, Meta publishing, creative analytics, planning, content publishing, and MAP monitoring. It also has useful foundations: server-side workspace membership, role permissions, hashed public submission tokens, atomic agreement acceptance, public-route rate limiting, paused Meta launches, an analysis queue, integration checks, and frontend code splitting.

The main issue is uneven enforcement and incomplete recovery around those features. The public Shopify OAuth callback is an urgent security defect. Several workflows can lose the connection between an external action and its local record. Analytics and job state can become incomplete while the interface still appears operational. Fix these foundations before expanding the feature surface.

## Scope and evidence

This is a repository-wide architecture and critical-path source review, with focused examination of authentication, permissions, publishing, seeding, creator submissions, rendering, analytics ingestion, queue handling, data persistence, and frontend state. It is not a claim that every line or every UI flow was exhaustively exercised.

- `npm run build`: passed; 177 frontend modules transformed. Heavy tools are already lazy-loaded. The initial JS chunk was approximately 266 kB uncompressed / 80 kB gzip.
- `node --check`: passed for all 107 backend JavaScript files. Syntax checks do not validate SQL or provider behavior.
- Four offline reproductions passed: Shopify secret forwarding, cross-origin Clerk-token attachment, suspended-user Blob permission behavior, and viewer access to winner dismissal. See [reproductions](/Users/nicholaskirchner/howl-ad-engine/docs/audits/2026-09-05-reproductions.mjs).
- `npm audit --json`: completed against the npm advisory service; 18 affected-package findings, 17 high and 1 low. See [raw result](/Users/nicholaskirchner/howl-ad-engine/docs/audits/2026-09-05-dependency-audit.json).
- No live ads, orders, messages, database records, or provider settings were changed. The existing UGC infrastructure script was inspected but not run because it creates and deletes remote records/files and would not substitute for an isolated test environment.
- Production deployment parity, database contents, real provider credentials/scopes, provider quotas, backups, monitoring settings, and browser behavior behind production authentication were not verified. Absence of their configuration in this repository does not prove their absence in provider consoles.

Priority: P0 = contain immediately if deployed; P1 = fix before relying on broader production use; P2 = planned reliability/product correction.

## Confirmed defects and implementation gaps

### 1. P0 — Public Shopify callback can disclose the Shopify app secret

Evidence: [shopify-callback.js:6](/Users/nicholaskirchner/howl-ad-engine/api/shopify-callback.js:6), [shopify-callback.js:29](/Users/nicholaskirchner/howl-ad-engine/api/shopify-callback.js:29), [shopify-install.js:4](/Users/nicholaskirchner/howl-ad-engine/api/shopify-install.js:4).

The unauthenticated callback accepts a caller-supplied `shop` and POSTs `client_secret` to `https://${shop}/admin/oauth/access_token`. It reads but never validates `hmac`; the OAuth state is neither stored nor verified. An arbitrary hostname and arbitrary code are enough to cause the outgoing secret-bearing request. This was reproduced with dummy credentials and a mock fetch.

**Fix:** disable or restrict this setup endpoint immediately if deployed. Strictly validate the canonical Shopify hostname and allowed store, validate Shopify's signature, bind a cryptographically random expiring single-use state to an authorized admin session, and reject unsafe redirects. Store tokens server-side instead of rendering them into HTML. Assess deployed access logs and rotate potentially exposed primary/dealer app secrets after containment; this audit does not establish that exploitation occurred.

**Acceptance:** arbitrary hosts, invalid signatures, missing/expired/replayed states cause rejection before any token exchange; legitimate admin setup works without returning permanent tokens in a page.

### 2. P1 — Global fetch interceptor can attach Clerk tokens to another origin

Evidence: [main.jsx:29](/Users/nicholaskirchner/howl-ad-engine/src/main.jsx:29).

The interceptor authenticates any URL containing `/api/`, including `https://another-origin.example/api/image`. The exact interceptor was exercised with a mocked fetch and attached the Clerk bearer token. This creates a token disclosure path whenever app code fetches an external URL matching that pattern; actual browser delivery depends on the request and remote CORS policy. No existing exploitation was established.

**Fix:** resolve URLs against `window.location.origin`, require exact same origin and an `/api/` pathname, and use a scoped API client instead of replacing `window.fetch`. Preserve `Request` and `Headers` objects correctly.

**Acceptance:** external, protocol-relative, URL-object, and Request-object inputs never receive a workspace token; same-origin API calls still work.

### 3. P1 — Read permissions allow mutations and paid background work

Evidence: [meta.js:406](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:406), [meta.js:2238](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:2238), [content-shopify.js:28](/Users/nicholaskirchner/howl-ad-engine/api/content-shopify.js:28).

Meta distinguishes a list of launch actions from everything else. The latter accepts `analytics.read` or `launch.read`, including for winner dismissal, manual analysis, queue processing/retries, evidence-task changes, and asset normalization. A viewer can dispatch winner dismissal; the actual handler was tested with mocked dependencies. Separately, `briefs.write` permits `publishLive` blog publishing, so producer/strategist access also grants a public publishing capability without a distinct permission.

**Fix:** explicit deny-by-default action-to-permission map, with separate analytics writes, job execution, and content publishing permissions. Align the UI with server enforcement. If broad publishing access is intentional, name and document that capability explicitly.

**Acceptance:** a role/action matrix tests every mutating action; viewer/analyst accounts cannot modify shared records or start chargeable work.

### 4. P1 — Suspended users can still request Blob upload tokens

Evidence: [upload-token.js:49](/Users/nicholaskirchner/howl-ad-engine/api/blob/upload-token.js:49), [app-access.js:190](/Users/nicholaskirchner/howl-ad-engine/api/_lib/app-access.js:190).

The special Blob callback verifies a Clerk token, calls `getAppAccess`, and checks permission bits, but never requires an active user. `getAppAccess` returns permissions based on role even for a suspended user. A suspended producer therefore passes this callback while ordinary API routes correctly reject them. The helper behavior was reproduced with mocked SQL. This matters while the user still holds a valid Clerk session.

**Fix:** share one active-membership check between normal routes and upload-token callbacks. Also use the same email resolution logic so invitations/bootstrap access do not depend on the session token containing an email claim.

**Acceptance:** suspension blocks new upload-token issuance for a still-valid Clerk JWT; invited active users can upload consistently.

### 5. P1 — Refreshing the analysis queue deletes newly queued launches

Evidence: [creative-analysis-queue.js:35](/Users/nicholaskirchner/howl-ad-engine/api/_lib/creative-analysis-queue.js:35), [creative-analysis-queue.js:86](/Users/nicholaskirchner/howl-ad-engine/api/_lib/creative-analysis-queue.js:86), [creative-analysis.js:607](/Users/nicholaskirchner/howl-ad-engine/api/_lib/meta/creative-analysis.js:607).

Launches enqueue pending analysis jobs immediately. `enqueueCreativeAnalyses` then deletes every unattempted pending job and rebuilds only from `creative_performance`. A freshly launched asset not yet ingested into that table loses its job. Both the worker and queue-status request invoke this rebuilding logic, so even opening queue status can trigger the deletion. It may return after a later metadata sync, but immediate launch-to-analysis processing is unreliable.

**Fix:** use additive upserts; reconcile stale jobs explicitly without deleting launch-origin jobs. Queue status should be read-only. Include durable assets as a source when rebuilding candidates.

**Acceptance:** enqueue a launch absent from `creative_performance`, refresh status and run the worker, and verify that the job remains claimable.

### 6. P1 — Meta publishing lacks durable request identity and recovery

Evidence: [meta.js:926](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:926), [meta.js:92](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:92), [drive/ugc.js:1030](/Users/nicholaskirchner/howl-ad-engine/api/drive/ugc.js:1030), [meta.js:1148](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:1148).

Publishing creates upstream objects before durable local completion. There is no launch request key or persisted step state shared by retries. The Drive path creates the ad, moves/renames the source, and only then writes launch history; a move error can leave an existing ad with no completed local launch record. Other launch paths swallow logging errors. Retrying can create another creative/ad/campaign. Creative-test batches also return top-level `success: true` even if every individual item failed.

Ads are created paused, which limits immediate spend exposure, but duplicate ads, missing attribution, and misleading completion status remain real problems.

**Fix:** create a durable launch operation before calling Meta; persist external IDs as steps complete, reuse them on retry, and reconcile uncertain responses. Treat Drive movement and analytics bookkeeping as separately retryable steps. Return complete/partial/failed status based on results.

**Acceptance:** simulate a dropped response after ad creation, a Drive failure, and a DB failure. Retry must converge on one launch and one auditable result.

### 7. P1 — Shopify seeding deduplication and daily limits are not atomic

Evidence: [creator-seeding.js:62](/Users/nicholaskirchner/howl-ad-engine/api/creator-seeding.js:62), [creator-seeding.js:118](/Users/nicholaskirchner/howl-ad-engine/api/creator-seeding.js:118), [creator-seeding.js:153](/Users/nicholaskirchner/howl-ad-engine/api/creator-seeding.js:153).

The route checks `request_key` and today's count, creates an external draft, then inserts the request record. Concurrent identical requests can both create drafts before one loses the database uniqueness race. Concurrent distinct requests can both pass the remaining daily allowance. Once a `draft_created` row exists, retry returns it as a duplicate without resuming `draftOrderComplete`; a completion failure or uncertain response can leave the local record stranded.

**Fix:** atomically reserve the request key and daily allowance before external work, persist draft/order IDs, and implement resumable/reconcilable operation states. Retain the existing zero-total check, quantity limits, separate token, and safety switch.

**Acceptance:** parallel identical requests produce one draft; parallel requests cannot exceed the daily reservation limit; retries recover interrupted completion without creating new drafts.

### 8. P1 — Old or unrelated render polling can overwrite current session output

Evidence: [render-ugc-remotion.js:80](/Users/nicholaskirchner/howl-ad-engine/api/render-ugc-remotion.js:80), [render-ugc-remotion-status.js:61](/Users/nicholaskirchner/howl-ad-engine/api/render-ugc-remotion-status.js:61), [render-ugc-remotion-status.js:86](/Users/nicholaskirchner/howl-ad-engine/api/render-ugc-remotion-status.js:86).

The status route allows query parameters to override the render ID, bucket, function, and region stored on a session. It then writes the resulting output into that session and labels history using the stored render state. A stale poll for render A after render B starts can attach A's output with B's metadata. There is no compare-and-set check that the finishing render is current. The settings write also replaces the complete JSON object read earlier, potentially losing concurrent editor changes. Completion unconditionally moves a linked deliverable back to `edited`, including after approval/launch.

**Fix:** dedicated render-job records bound to session IDs, server-owned provider coordinates, conditional current-output updates, atomic history appends, and guarded deliverable transitions. Finalize renders in a background callback/reconciler so leaving the browser does not leave completed renders marked as processing.

**Acceptance:** overlapping renders, stale polls, and concurrent editor saves preserve all versions and cannot regress a launched deliverable.

### 9. P1 — Analytics sync can be incomplete while appearing fresh

Evidence: [meta.js:1401](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:1401), [meta.js:1469](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:1469), [vercel.json:22](/Users/nicholaskirchner/howl-ad-engine/vercel.json:22).

Metadata rows are timestamped individually before insights ingestion. Throttling uses the maximum metadata timestamp; an interrupted sync can therefore suppress the next ordinary retry despite incomplete daily insights. Metadata and insight loops have hard page caps but do not report truncation when more pages remain. Sequential per-row DB writes make the single-request sync increasingly expensive as the account grows. The checked-in crons process creative analysis and MAP monitoring, not creative performance ingestion.

**Fix:** durable sync runs with page/window checkpoints, batched upserts, bounded resumable work, explicit incomplete status, and a completion watermark set only after every required page succeeds. Schedule ingestion independently of an operator visiting the dashboard.

**Acceptance:** failures on intermediate metadata/insight pages resume correctly; a page-cap hit is never reported as a complete sync; dashboard freshness reflects complete insight coverage.

### 10. P1 — Usage rights and approval records do not gate ad creation

Evidence: [creator-ops.js:239](/Users/nicholaskirchner/howl-ad-engine/api/_lib/creator-ops.js:239), [drive/ugc.js:525](/Users/nicholaskirchner/howl-ad-engine/api/drive/ugc.js:525), [meta.js:426](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:426).

The app stores paid-media inclusion, usage terms, agreements, and deliverable approval counts, but the publishing paths do not check them. Creator, brief, and deliverable IDs are optional client metadata. The existing brand guardrail checks supplied copy strings; it does not establish creator rights, approval of the specific output revision, or whether embedded video/image copy was approved.

**Fix:** one server-side launch preflight covering asset identity, creator linkage, accepted paid-media rights and expiry, approved revision, destination, attribution, and required disclosures. Explicitly support internal/tool-generated assets that do not require creator agreements. Store an actor-attributed exception if an authorized override is needed.

**Acceptance:** external-creator content with missing/expired rights or an unapproved revision fails preflight; a valid approved asset succeeds.

### 11. P2 — Analysis jobs can become permanently pending after repeated hard timeouts

Evidence: [creative-analysis-queue.js:114](/Users/nicholaskirchner/howl-ad-engine/api/_lib/creative-analysis-queue.js:114), [creative-analysis.js:578](/Users/nicholaskirchner/howl-ad-engine/api/_lib/meta/creative-analysis.js:578), [creative-analysis-worker.js:43](/Users/nicholaskirchner/howl-ad-engine/api/creative-analysis-worker.js:43).

A claim increments attempts. Lease recovery moves expired processing jobs to pending without checking exhaustion, while claiming requires `attempts < max_attempts`. After the last allowed attempt is killed rather than caught, the recovered job is permanently pending and the retry-failed action does not select it. The worker also runs up to eight sequential jobs without checking its remaining request time. Its hourly cron slot is permanently claimed even if the invocation fails, preventing a retry in that slot.

**Fix:** exhausted leases become failed; add lease ownership and conditional completion, time-budget-aware dispatch, and recoverable cron-run state. Use a durable worker for long video work. The default six jobs at three scheduled runs permits at most 18 scheduled attempts/day before manual processing, so monitor backlog age against actual arrival volume.

**Acceptance:** kill the final attempt, recover the lease, and verify a visible retryable failure rather than an unclaimable pending job.

### 12. P2 — Reused media collapses materially different creative variants

Evidence: [meta.js:1431](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:1431), [meta.js:1469](/Users/nicholaskirchner/howl-ad-engine/api/meta.js:1469).

The primary creative group uses `videoId || imageHash || ad.id`. Carousels and dynamic creatives select the first matching media asset. Ads sharing an image/video but differing in hook, copy, destination, or remaining carousel cards can therefore share one analysis/group. Media-level rollups are useful, but they do not independently measure those creative variants; winner-based generation and planning can inherit a blended signal.

**Fix:** preserve separate media, creative revision, concept, ad, and placement identities. Offer both media and full-variant reporting and label which one drives any recommendation.

**Acceptance:** two ads with the same image and different hooks remain distinguishable while still rolling up to the shared image.

### 13. P2 — Creator email sends can succeed externally and fail locally

Evidence: [creator-email.js:181](/Users/nicholaskirchner/howl-ad-engine/api/creator-email.js:181), [creator-email.js:224](/Users/nicholaskirchner/howl-ad-engine/api/creator-email.js:224).

The provider sends before outreach/activity rows and agreement state are saved. A subsequent DB error returns failure even though the creator received the email. Retry can send duplicates. When this happens to an agreement email, the recipient may receive a link whose agreement still has draft status.

**Fix:** persist a send intent, bind an idempotency key where supported, record provider receipt immediately, and retry bookkeeping separately. For an uncertain send result, reconcile or flag for operator review rather than blindly resending.

**Acceptance:** a forced DB failure after provider acceptance never causes a duplicate email and eventually produces consistent outreach/agreement state.

### 14. P2 — Shared editor updates can silently overwrite each other

Evidence: [ugc-sessions.js:132](/Users/nicholaskirchner/howl-ad-engine/api/db/ugc-sessions.js:132), [App.jsx:72](/Users/nicholaskirchner/howl-ad-engine/src/App.jsx:72), [cartDb.js:1](/Users/nicholaskirchner/howl-ad-engine/src/utils/cartDb.js:1).

Session PATCH performs separate SQL writes per field and replaces settings with no version check. Concurrent saves can lose changes and failed requests can partially apply. The launch cart is browser-local IndexedDB with no user namespace or shared persistence; saves can fail with only a console message. That prevents reliable cross-device/team handoff and leaves local cart contents across account switches on the same browser.

**Fix:** atomic updates with revision/ETag conflict detection, explicit saving/saved/failed UI, revision history for approvals, and server-backed launch drafts. Namespace any remaining local cache by user/workspace.

**Acceptance:** two editors receive an explicit conflict instead of losing changes; a failed save is visible; a saved draft can be reopened on another device.

### 15. P2 — Arbitrary URL import lacks outbound-network and resource limits

Evidence: [content-studio.js:491](/Users/nicholaskirchner/howl-ad-engine/api/_lib/content-studio.js:491).

Source import permits any HTTP(S) URL and follows fetch redirects. There is no private/loopback/link-local address rejection or redirect revalidation. The byte limit is applied after reading the entire response into memory. An authorized importer can request internal addresses or cause a large/slow response to consume the function. Actual reachable internal services depend on deployment networking and were not probed.

**Fix:** centralized safe fetch with hostname/IP and redirect checks, enforced streaming byte limits, deadline, and allowed response types. Apply the same utility to other user-supplied scraping URLs.

**Acceptance:** localhost, private IPs, redirects to them, oversized bodies, and stalled responses are rejected within a bounded budget.

### 16. P2 — Expired workspace invitations remain acceptable in app authorization

Evidence: [app-access.js:152](/Users/nicholaskirchner/howl-ad-engine/api/_lib/app-access.js:152).

The schema stores invitation expiry, but the pending-invitation lookup never filters `expires_at`. An otherwise authenticated user with the matching email can be provisioned from an expired pending app invitation. Clerk-side invitation behavior may limit entry, but the app's authorization check does not enforce its own expiry.

**Fix:** require unexpired invitation state and atomically consume it while provisioning the workspace user.

**Acceptance:** an expired app invitation cannot provision membership even with a valid Clerk session.

### 17. P2 — The locked dependency graph has known advisory findings

Evidence: [dependency audit](/Users/nicholaskirchner/howl-ad-engine/docs/audits/2026-09-05-dependency-audit.json), [package.json:20](/Users/nicholaskirchner/howl-ad-engine/package.json:20).

The current npm audit reports 18 affected packages: 17 high and 1 low. Chains include Remotion tooling, Vite, Clerk's shared dependency chain, and HTTP/build utilities. These are affected-package counts, not distinct vulnerabilities or proof that every advisory is reachable in production. For example, several Vite findings concern the development server; see the [Vite advisory](https://github.com/advisories/GHSA-p9ff-h696-f583). Remotion-related findings include [extract-zip path traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv).

**Fix:** triage runtime versus build/dev exposure, update the lockfile, and upgrade the pinned Remotion packages together with their deployed renderer/site. Rebuild and verify actual rendering after updating. Avoid a blind force upgrade that leaves local and deployed render components inconsistent.

**Acceptance:** rerun the advisory audit with any remaining accepted findings documented by reachable code path and owner.

## Critical infrastructure and product improvements

These are recommendations grounded in the repository, not claims that every external service lacks corresponding controls.

| Area | Current evidence and gap | Improvement and completion criterion |
|---|---|---|
| Release verification | `package.json` has build and one UGC infrastructure verification script; no tracked general test suite or CI workflow was found. The build does not compile or execute API handlers. | CI for frontend build, backend import/lint checks, role matrix, database migrations, and isolated critical-flow integration tests. Block release on failed auth, duplicate-operation, or migration tests. |
| Database lifecycle | `api/_lib/creator-ops.js` runs a large series of CREATE/ALTER statements on first use in each process; `api/db/schema.js` separately initializes foundational tables. Application credentials must perform schema changes. | Versioned, ordered release-time migrations; clean-database bootstrap test; rollback/forward-fix procedure; runtime DB identity without DDL where practical. Verify preview and production isolation. |
| Recovery and observability | Admin workflow health, integration probes, activity logs, and an analysis queue exist. Request correlation, comprehensive job recovery, proactive failure alerts, and backup/restore configuration were not established. | Persist operation/run IDs, provider IDs, timing, retries, freshness, and failure category; alert on stale ingestion, stalled jobs, or uncertain publishes. Verify database restore and media recovery against an agreed recovery objective. |
| Cost and resource controls | Public uploads have rate limits, and generation caps output tokens, but inspected paid generation/render/analysis endpoints lack per-user/workspace rate, concurrency, and total-cost limits. | Provider usage ledger, input/duration limits, request deduplication, per-role quotas, daily budget controls, and render cancellation. Test concurrent calls and budget exhaustion. |
| Asset lifecycle | Public Blob sources/audio and public Lambda outputs are used. Upload completion callbacks do no reconciliation; UGC deletion removes a few URLs but not the full Blob/S3 render-history lifecycle. | Decide which raw footage/agreements should be private, issue scoped media access, track ownership/reference counts, reconcile orphan uploads, and implement retention across Blob, Drive, and S3. Test deletion without breaking other referenced assets. |
| Experiment validity | Creative-test launching exists; group-level performance exists. The launch flow has no persisted experiment protocol covering hypothesis, primary metric, observation window, minimum evidence, and decision history. | Connect each creative variant to an experiment; label inconclusive results; separate paid-attributed performance from causal claims; preserve the reason a winner was selected. |
| Operational handoff | Creator/brief/deliverable relationships and workflow guidance exist, but launch and render revisions are not a reliable shared approval artifact. | One launch packet showing exact approved output, copy, rights, placement, destination, attribution, actor, and external IDs; deterministic preflight with actionable failures. |
| Frontend resilience | Lazy loading is already present. No React error boundary was found. Several components remain very large, including the 4,407-line dashboard and 2,635-line UGC editor. | Add tool-level error boundaries and recovery, visible save/retry state, and extract domain hooks/services from large components as they are changed. Prioritize real workflow failures over cosmetic rewrites. |
| Local setup | README describes an early Anthropic-only tool. Vite loads env into a local object without copying server values into `process.env`; its API shim omits `res.redirect`, which OAuth callbacks use. Behavior depends on how the shell is launched. | Document all required services, use one supported local API runtime, and verify setup from a clean shell using dummy/test credentials. Keep local development isolated from production data. |

## Recommended implementation order

1. **Contain exposure:** fix/disable Shopify OAuth callback, repair origin-scoped token handling, enforce action permissions and suspension for uploads, and assess credential rotation. Add the security regressions to CI.
2. **Make external actions recoverable:** durable launch, seed, email, and render operations; duplicate prevention; provider-result reconciliation; explicit partial-failure states.
3. **Make analytics trustworthy:** additive queue ingestion, exhausted-lease handling, resumable scheduled insights sync, completion/freshness watermarks, separate creative-variant identity.
4. **Enforce the operating workflow:** approved-revision and rights preflight, shared launch drafts, safe concurrent edits, meaningful experiment decisions.
5. **Harden delivery and operations:** coordinated dependency updates, migrations, isolated staging tests, cost limits, failure alerts, verified backups, and media retention.

The next production verification pass should establish which commit is deployed, confirm the OAuth endpoint exposure, exercise every role in a test workspace, simulate interrupted launch/order/render operations, inspect actual ingestion freshness, and perform a restore exercise. Those checks are necessary before calling the system production-hardened.
