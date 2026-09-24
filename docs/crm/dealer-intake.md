# Campfire dealer intake

Public form: https://welcometothecampfire.io/dealer-intake. Linked from the owner-only CRM toolbar. The Shopify wholesale form is unchanged.

Submissions create a New lead assigned to Nicholas, with contact information, business details, and follow-up on the next weekday (America/Chicago). This does not send email or grant access to the CRM.

Release: run database migrations before deploying. `crm_intake_submissions` provides atomic deduplication alongside the opportunity and activity. Identical normalized submissions remain deduplicated even after the opportunity moves or is archived. A changed inquiry creates a new lead. Requests have bounded fields, a honeypot, and database-backed IP, email, and global rate limits. Only the production Campfire origin is accepted; origin checks are not bot authentication.

Set DEALER_INTAKE_ENABLED=false to pause new submissions. Existing leads remain intact. Review CRM using its refresh control to load new inquiries.

Validation: database-backed tests cover validation, duplicate/concurrent requests, retry conflicts, rate limits, and transaction rollback. `node scripts/preview-crm.mjs` runs an isolated local preview on port 5190 with synthetic data, simulated email, and a public intake endpoint.
