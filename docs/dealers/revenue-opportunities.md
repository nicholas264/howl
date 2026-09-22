# Dealer revenue opportunities

The dealer dashboard now starts with potential reorder revenue and a ranked list of the dealers behind it. Each account contributes one estimated next order; missed cycles never multiply the total. The three open stages are no contact logged, contacted/replied, and order expected. Closed opportunities are excluded.

## Estimate rules

- Median of up to three latest positive Shopify order subtotals. Fewer than three orders is visibly marked limited history.
- With three distinct positive order dates, use the average historical order gap, with a 30-day minimum. Other accounts enter after 60 days.
- No cancelled/test orders (existing import rules), nonpositive orders, future orders, duplicate account IDs, or anonymous order-only identities.
- Revenue and timing use the imported history as of the displayed Shopify sync date, independently of the dashboard period selector.
- Contact follow-ups use the current store-local date, so an older Shopify snapshot cannot hide a follow-up due today.
- Potential revenue is an estimate, not booked revenue, promised order size, or a probability-weighted forecast.
- A new positive order creates a new reorder cycle. Previous contact records remain stored but cannot mark the new cycle as already contacted.

## Shared contact tracking

PostgreSQL records are keyed by configured dealer store, stable customer key, and latest positive order ID. Status, owner, last contact, next follow-up, notes, update actor, and revision persist across browsers. analytics.read permits viewing; analytics.write permits updates. Contacted/replied/expected require a contact date. Conditional writes reject stale revisions rather than overwriting another user's work. This feature does not send messages.

Storage failures hide totals/statuses rather than implying that every dealer is uncontacted. CSV export includes all dealers in the selected view with saved contact fields and neutralizes spreadsheet formulas.

## Verification

- `npm run check`: all 214 tests, API syntax, and production bundle passed.
- After the follow-up date correction, all 8 dealer opportunity tests and the production bundle passed again.
- New regression tests exercise calculations, duplicate handling, thresholds, new-order resets, stage sums, exports, actual PostgreSQL persistence, shop/cycle isolation, invalid input, permissions, and stale-write conflicts.
- `node scripts/verify-dealer-opportunities.mjs` runs a localhost fixture dashboard backed by isolated PGlite and the actual outreach handler. No production credentials or live writes are used.
- Browser verified save, reload persistence, follow-up filter, new-order removal, and outage/recovery. Fixtures initially show $11,800; an Alpine reorder removes $4,000 and leaves $7,800.

## Release

Production has not been changed. Automatic approval review blocked pulling production configuration because it contains credentials and needs explicit authorization.

After authorization:
1. Pull the existing project's production configuration into a protected, untracked temporary file.
2. Apply only this additive table migration with `node --env-file=<selected-env-file> scripts/migrate-dealer-outreach.mjs`. Use the migration connection when runtime credentials cannot create schema. The standard migration runner also includes this table for future environments.
3. Publish the reviewed commit through the project's existing Git/Vercel release process.
4. Verify deployment readiness and authenticated dashboard/API reads. Avoid fabricated contact entries in production.
5. Remove the temporary configuration file.

Rollback the frontend/API release if necessary; the additive table can remain without affecting older code. No existing customer/order data is modified by the migration.
