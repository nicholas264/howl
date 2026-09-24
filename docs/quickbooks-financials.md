# Campfire Financials: activation and operating model

Financials appears under Company for the owner only. Both the navigation and the
API enforce owner access; admins and analysts cannot read financial settings,
reports, or initiate connections. The OAuth callback rechecks active owner status.

## Activate the connection

1. Create a QuickBooks Online accounting app in the [Intuit developer portal](https://developer.intuit.com).
   Start with its sandbox company. Complete Intuit's production requirements before
   requesting production credentials. Campfire's implementation reads reports only;
   Intuit's accounting OAuth scope itself is not a read-only scope.
2. Configure these **server-only** deployment environment variables:

   | Variable | Value |
   | --- | --- |
   | `QUICKBOOKS_CLIENT_ID` | Intuit app client ID for the selected environment |
   | `QUICKBOOKS_CLIENT_SECRET` | Matching client secret |
   | `QUICKBOOKS_ENVIRONMENT` | `sandbox` or `production` |
   | `QUICKBOOKS_REDIRECT_URI` | `https://welcometothecampfire.io/api/quickbooks-callback` for production |
   | `QUICKBOOKS_TOKEN_ENCRYPTION_KEY` | At least 32 randomly generated characters; store in the deployment secret manager |

   Register the exact redirect URI in Intuit's app settings. Local development can
   use HTTP localhost. Production requires HTTPS. Do not use `VITE_` variables for
   secrets. Changing the encryption key requires reconnecting; keep the existing
   key until any intended rotation/reconnection is complete.
3. Run the existing migration (`npm run db:migrate`) with the authorized migration
   identity. It adds `finance_workspace`, `finance_connection`, and `finance_oauth`.
   Deploy the application with these variables. Financials shows configuration
   presence, never secret values.
4. As the owner, open Company → Financials → Connection setup. Authorize the exact
   QuickBooks company you intend. Save fiscal start, currency, and accounting basis
   under Annual plan, then Sync reports. Reconnecting clears cached reports and cost
   classifications so another company's account IDs cannot reuse old rules.
5. Compare the first sync against QuickBooks' own P&L and Balance Sheet for identical
   dates and basis. Provider fixtures are covered by tests; **a live Intuit consent
   and real company report reconciliation still require the owner's credentials**.
   Unsupported/mismatched report layouts fail without replacing the saved snapshot.
6. Classify every nonzero operating cost account and enter monthly revenue targets.
   Review these with the person responsible for the books. Sync manually after
   month-end adjustments; there is no background accounting sync in this version.

## Financial definitions

- Booked revenue: QuickBooks P&L Income section, excluding Other Income.
- Gross margin: (Income − COGS) / Income.
- Net margin: QuickBooks Net Income / Income, including non-operating results in the numerator.
- Contribution: Income − variable portions of COGS and operating expenses.
- Fixed operating costs: remaining portions of those same accounts.
- Operating break-even sales: fixed operating costs / contribution margin. A zero
  or negative contribution margin has no calculated break-even. This is a
  period operating model, not cash break-even; excludes debt principal, capex,
  and non-operating costs. Stable mix/cost behavior is an assumption.
- Current ratio: current assets / current liabilities.
- Quick ratio: (bank accounts + accounts receivable) / current liabilities.
- Liabilities to equity: total liabilities / equity (not interest-bearing debt only).
  Missing groups or nonpositive denominators display unavailable.

Each account's variable percentage is a management assumption applied across the
synced fiscal months. Offset credits do not excuse unclassified activity. Mixed
accounts can be split. Cost rows must reconcile to the P&L totals before the
snapshot can be saved; summary rows are never added to account rows.

Annual pacing uses complete calendar months through the prior UTC month, capped
at the selected fiscal year. This does not certify that books are closed. Missing
actuals or targets stay missing. Targets are manually maintained, allowing seasonal
plans. Actual plus remaining plan is labeled as a scenario, not a predictive model.
The existing Shopify dashboard and spreadsheet forecast remain independent; this
version does not import their targets or combine their revenue with accounting data.

## Connection security and recovery

Tokens use AES-256-GCM with a dedicated server key. OAuth states are hashed,
one-time, ten-minute records bound to an HttpOnly SameSite=Lax browser cookie.
Report/refresh operations use a database lease and connection version to prevent
concurrent refreshes and stale snapshot writes. Settings use revision checks.
Failed report syncs retain the last complete snapshot and its original timestamp.

Disconnect removes locally stored tokens, snapshots, mappings, and pending consent.
It keeps revenue targets. The owner can additionally revoke the app in QuickBooks
Connected Apps. Logs contain failure codes only, never provider token responses.

## Local verification

- `node --test tests/finance.test.mjs`: ratios, seasonal plans, parser reconciliation,
  owner-only guards, authenticated encryption, OAuth cookie binding/replay/owner
  recheck, real SQL revision checks, atomic sync, lease, and disconnect.
- `npm run check`: all project checks and production build.
- `node scripts/preview-finance.mjs`: isolated empty-state preview, port 5195.
- `node scripts/preview-finance.mjs --example`: isolated illustrative reports and
  editable plan/classifications, same port. Does not access production or Intuit.

Protocol references: [Intuit OAuth client](https://github.com/intuit/oauth-jsclient),
[OAuth discovery](https://developer.intuit.com/.well-known/openid_configuration/),
[Reports API](https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports).
