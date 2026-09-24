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
- Verify hosting/data residency before completing Geolocation.
- Run connect, disconnect, reconnect and report retrieval against a real Intuit
  sandbox company. Production use additionally needs owner authorization of the
  intended live company and matching-date/basis report reconciliation.
- Error logs currently contain generic failure codes, not complete provider
  payloads. `intuit_tid` is not currently captured. Do not claim otherwise in
  the assessment; avoid logging tokens or financial payloads when improving it.
- Confirm the in-app support contact, app logo, profile/email verification and
  any additional production requirements shown by Intuit.

Only after production credentials are available: install the matching client ID
and secret securely, redeploy, complete owner consent, sync, reconcile, classify
cost accounts and enter the owner's revenue targets. See
[the operating guide](quickbooks-financials.md) for definitions and safeguards.
