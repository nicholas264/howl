# Intuit production activation — working review

Status checked in the signed-in Intuit portal on September 24, 2026. This is a
preparation record, not a submitted assessment or a statement of approval.

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
- App assessment opened, not submitted.
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
  feedback widget. Trace-ID capture and complete error logs are honestly marked
  absent in the saved questionnaire draft. The deployed code now captures bounded
  Intuit trace IDs for failed token/report HTTP responses; the portal trace-ID
  answer still needs updating. Support instructions are saved.

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

The OAuth flow reached consent for `Sandbox Company US a843`. Owner consent is
pending; no real sandbox report sync or connect/disconnect/reconnect result is
claimed yet. Stop the runner after verification and remove its temporary
configuration. Production server configuration remains unchanged.

Production credentials are locked pending Intuit's requirements. The portal also
blocks editing production redirect URIs until those requirements are complete.
The callback to register is
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
- Review the actual Intuit security requirements before making any compliance
  commitment. Clerk authentication alone does not establish that MFA or CAPTCHA
  is enabled for this deployment.
- Geolocation saved as United States with no fixed outbound IP. Verified the
  linked Vercel project's `serverlessFunctionRegion` and default function region
  are both `iad1` (US). Intuit explicitly permits serverless platforms to omit
  the IP address. This records app hosting, not a blanket data-residency claim.
- Run connect, disconnect, reconnect and report retrieval against a real Intuit
  sandbox company. Production use additionally needs owner authorization of the
  intended live company and matching-date/basis report reconciliation.
- Deployed provider diagnostics now capture operation, HTTP status and a validated
  `intuit_tid` for failed HTTP responses. Regression tests verify that credentials,
  report bodies and company identifiers are excluded and malformed trace IDs
  are discarded. All 265 deployment tests pass, including 12 finance tests;
  production build and dependency audit passed (zero vulnerabilities). Deployment
  `dpl_HRxCNnBvwqvupVr3SDWhphwRqBP9`, commit `47b5558`, reached Ready.
  Update the portal's trace-ID answer; complete provider payload logging remains
  intentionally absent. The local sandbox harness is excluded from deployments.
- Confirm the in-app support contact, app logo, profile/email verification and
  any additional production requirements shown by Intuit.

Only after production credentials are available: install the matching client ID
and secret securely, redeploy, complete owner consent, sync, reconcile, classify
cost accounts and enter the owner's revenue targets. See
[the operating guide](quickbooks-financials.md) for definitions and safeguards.
