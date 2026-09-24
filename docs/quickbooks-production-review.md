# Intuit production activation — working review

Status checked in the signed-in Intuit portal on September 24, 2026. This is a
working record. The app assessment has now been submitted and Intuit's portal
reports Submission status Completed and Results Approved.

## Portal setup completed

- Workspace: HOWL Campfire.
- App: Howl Campfire, app ID `52063f9a-c039-4965-b4a0-72c67f12642b`.
- Production host domain: `welcometothecampfire.io`.
- Launch, connect/reconnect and disconnect landing pages:
  `https://welcometothecampfire.io/?tab=finance`. Actions require owner sign-in;
  visiting the landing page alone does not disconnect a company.
- App category: Business Insights.
- Regulated industries: None of the above. The implemented integration reads
  accounting reports; it does not offer insurance, securities/retirement advice,
  lending, or payment processing.
- App assessment submitted with explicit owner approval; Intuit reports Approved.
- Saved questionnaire draft: owner confirmed no regulatory complaints,
  lawsuits or investigative requests; legal-counsel review completed; no
  sanctions exposure; no breach requiring notification; no dedicated security
  team regularly assessing the app. Entered these answers as provided.
- Draft also records the accounting business use, broader app AI functionality,
  no QuickBooks data used for model training, server-only credential storage,
  and use of Intuit data only for the original customer's benefit.
- Further draft answers saved: private internal app; custom implementation;
  server-side web app; read-only Intuit data usage; connecting-company-admin
  access; on-demand Accounting API calls; other platforms and AI use explained;
  token refresh within two minutes of expiry on sync; no automatic auth retries;
  reconnect guidance and OAuth error handling; no OAuth Playground dependency;
  no QuickBooks webhooks or CDC; no special multicurrency/sales-tax features.
- Error-handling draft answers reflect tested error paths and the existing
  feedback widget. Trace-ID capture is Yes; complete error logs are No.
  The deployed code captures bounded Intuit trace IDs for failed token/report
  HTTP responses without logging report bodies. Support instructions are saved.
- Accounting scope saved: Simple Start, Essentials, Plus and Advanced. Intuit's
  report availability documentation lists standard P&L and Balance Sheet across
  those editions. The app avoids edition-specific transaction features, rejects
  invalid/partial imports, preserves prior snapshots on provider errors and
  leaves unavailable balance-sheet components unset. This is design scope, not
  a claim of live testing on every subscription tier.

## Live sandbox verification setup

Development credentials are available. A protected temporary configuration
outside the repository supplies the local test runner; no credentials are
committed or printed. The registered development callback is
`http://localhost:5196/api/quickbooks-callback`.

`node scripts/verify-finance-sandbox.mjs /path/to/private-config.json` runs the
real OAuth and finance handlers against Intuit's sandbox with an isolated
in-memory PostgreSQL database. It rejects production mode and unexpected
callback URLs. Local host and cross-origin-write rejection were verified.
The app is intentionally unauthenticated only in this loopback-only sandbox
harness; do not deploy the harness or give it production credentials.

Owner accepted consent for `Sandbox Company US a843`. The expired state was
replaced through the normal Connect flow, which reused the existing grant.
Live sandbox connect, disconnect and reconnect succeeded. Eight monthly P&L
reports (January–August 2026) and an August 31 balance sheet imported after fixing
Intuit's empty-month format: one account column with label-only summary rows.
The captured empty response is a regression fixture; 13 finance tests pass.
Independent aggregation of the captured sandbox report summaries reconciled
January–August revenue of $10,200.77, COGS of $405 and net income of $1,777.81
with the displayed rounded revenue, 96.0% gross margin and 17.4% net margin.
Current assets of $10,841.29 / current liabilities of $6,895.98 reconcile to the
displayed 1.57 current ratio. These are sandbox figures only.
This is real Intuit sandbox data, not HOWL production books. The runner was stopped and its temporary
credential file and captured diagnostic report directories were removed.
The empty-month fix (`5ba26a7`) deployed successfully as
`dpl_E1v1xuCDerNqRfv64PydFEBMnx29`: all 266 tests passed, production build
passed and dependency audit reported zero vulnerabilities. The live finance
endpoint still returns HTTP 401 with `private, no-store` without authentication.

Production credentials are unlocked and installed as sensitive server-only Vercel
variables. The temporary credential file was removed. The registered production callback is
`https://welcometothecampfire.io/api/quickbooks-callback`.

## Answers supported by the implementation

- Private internal application for HOWL; current financial access is owner-only.
- Custom React application with server-side JavaScript APIs on Vercel and Neon
  PostgreSQL persistence. QuickBooks requests originate from the server.
- Uses QuickBooks Online accounting Reports API: ProfitAndLoss and BalanceSheet.
  No QuickBooks Payments API or transaction writes.
- Sync is initiated manually by the owner. Reads completed fiscal months, with
  up to three report requests running concurrently. Prior saved reports survive
  failed syncs.
- OAuth authorization-code flow with browser-bound, expiring, single-use state.
  Access tokens refresh on use when less than two minutes remain before expiry.
  No automated retry loop for failed authorization or token exchange. The UI
  directs the owner to reconnect after authorization failures.
- No OAuth Playground or manually supplied access/refresh tokens are required.
- Client credentials belong in server-only environment variables. Refresh and
  access tokens are encrypted with AES-256-GCM before database storage.
- Company identifiers now use the same authenticated encryption on new
  connections. Owner reads and syncs upgrade legacy identifiers with a
  compare-and-set write; owner reads remove redundant identifiers from old
  report snapshots. New snapshots omit them. The owner-only connection response
  still identifies the connected company. Invalid ciphertext blocks reads/sync
  while disconnect remains available. Deployed as commit `b0ba4e6`, deployment
  `dpl_9c8BXBkQxGyQkgQrxFPmc28opGE1` (Ready). All 265 tests, the production
  build and dependency audit passed. Live unauthenticated `/api/finance` returns
  401 with `private, no-store`.
- Financial endpoints enforce authenticated active-owner authorization.
- Automated tests cover provider failures, malformed reports, callback state
  binding/replay, refresh, reconnect and disconnect using controlled fixtures.
  These tests are **not** an actual Intuit sandbox-company integration test.
- The broader Campfire app includes generative AI and other integrations. Do not
  answer that the entire application has no AI simply because Financials does
  not call an AI provider. The finance report path itself has no AI calls.

## Unverified facts and work still required

- Owner confirmed strictly internal use. Existing storefront privacy policy:
  https://www.howlcampfires.com/policies/privacy-policy. Its stated scope names
  the storefront and related interactions; it does not specifically describe
  Campfire's QuickBooks integration. Owner has no app terms.
- Internal-use terms and a Financials privacy supplement are maintained in
  `campfire-internal-terms.md` and `campfire-financials-privacy.md`.
  Owner approved publication on September 24, 2026. Public routes are
  `/legal/terms` and `/legal/privacy`. Both were deployed, returned HTTP 200
  without sign-in, and were saved in Intuit App terms of service settings.
  The unauthenticated financial API continues to return HTTP 401.
- Reviewed Intuit's security requirements. The owner completed the compliance
  commitment and explicitly authorized submission. Verified the Clerk
  production instance is for `welcometothecampfire.io`: all MFA methods and
  required MFA are off; Cloudflare Turnstile bot sign-up protection is enabled.
  Saved MFA No, CAPTCHA Yes, WebSocket No, trace-ID capture Yes, and sandbox
  connect/disconnect/reconnect testing Yes in the questionnaire.
- Geolocation saved as United States with no fixed outbound IP. Verified the
  linked Vercel project's `serverlessFunctionRegion` and default function region
  are both `iad1` (US). Intuit explicitly permits serverless platforms to omit
  the IP address. This records app hosting, not a blanket data-residency claim.
- Connect, disconnect, reconnect and report retrieval passed against a real Intuit
  sandbox company. Production use still needs owner authorization of the
  intended live company and matching-date/basis report reconciliation.
- Deployed provider diagnostics now capture operation, HTTP status and a validated
  `intuit_tid` for failed HTTP responses. Regression tests verify that credentials,
  report bodies and company identifiers are excluded and malformed trace IDs
  are discarded. All 265 deployment tests pass, including 12 finance tests;
  production build and dependency audit passed (zero vulnerabilities). Deployment
  `dpl_HRxCNnBvwqvupVr3SDWhphwRqBP9`, commit `47b5558`, reached Ready.
  The portal's trace-ID answer is now updated; complete provider payload logging
  remains intentionally absent. The local sandbox harness is excluded from deployments.
- Confirm the in-app support contact, app logo, profile/email verification and
  any additional production requirements shown by Intuit.

Remaining:
classify cost accounts and enter the owner's revenue targets. See
[the operating guide](quickbooks-financials.md) for definitions and safeguards.

## Current handoff

Intuit profile and assessment are complete; the assessment is Approved. Production
client ID and secret are installed and the callback is registered. Deployment
`dpl_D48Duu5EnhYqQZCZRXpLADz4uYwp` is READY with production credentials, tests
and build passing, and zero dependency vulnerabilities.

The owner approved the Neon Launch upgrade, and Vercel now confirms Launch active
at $0.106/CU-hour and $0.35/GB-month plus applicable taxes/fees. Live Campfire owner
access is restored. All five QuickBooks server settings show configured.

Owner approved the production grant for Howl Campfires LLC. The expired OAuth
request was renewed through normal Connect, reusing the granted authorization.
Eight monthly P&Ls (January–August 2026) and the August 31 balance sheet imported
successfully using calendar-year, USD, accrual reporting settings. Revenue, COGS,
operating expenses and net income were reconciled exactly against the same-period
QuickBooks UI P&L. All balance-sheet inputs to the displayed ratios were likewise
reconciled against the source report. Private financial amounts are not recorded
in this public repository.

A later CRM deployment had omitted the newer finance hardening. Merged current
production main into this branch, passed all 281 checks and published the merged
commit `ee73d0c` to main while preserving CRM. Production deployment
`dpl_2YhtDZ2RWPn7QNRVByvD9qU23kLJ` is Ready on welcometothecampfire.io.
A live owner read migrated the company identifier to encrypted storage and removed
the redundant snapshot identifier; verified via boolean-only database queries.
All eight months survived, a subsequent live sync succeeded, and unauthenticated
finance access returned 401.

Cost classifications and revenue targets remain unset. The owner has been asked
for annual/monthly targets and how production hourly labor and advertising should
behave in the break-even model. No invented targets or classification percentages
have been saved.
