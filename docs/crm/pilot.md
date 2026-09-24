# Campfire CRM pilot

A focused sales workspace for Roy, available at `/?tab=crm`. This branch is a reviewable implementation, not a declaration of production readiness. No production migration, deployment, real Gmail authorization, or live email delivery was performed during implementation.

## Included

- New lead, Contacted, Qualified, Proposal, Won and Lost stages, drag-and-drop and a keyboard-accessible stage selector.
- Opportunities with company, multiple contacts, owner, USD value, expected close, notes and required next action/follow-up for open deals.
- Follow-up queue, search, owner filter, CSV export, archive and restore.
- Versioned changes with transactional activity history; stale edits fail instead of overwriting another writer.
- Durable private email drafts, explicit sender/message review, send-only Gmail permission. Sent messages are shared with CRM readers; unrelated inbox mail is never fetched.
- Initial rollout is owner-only. Sales, admins, and every other non-owner role are denied CRM UI, data, and Gmail actions, even with explicit CRM or wildcard permissions. The Sales role is reserved for a later rollout.

Companies and contacts currently live on each opportunity. There is no global account/contact directory, cross-opportunity deduplication, Shopify import, bulk outreach, automated follow-up, attachments, rich-text email, or reply sync. Follow-ups are visible in the app, not emailed/pushed as reminders. Owner is a display field, not an access-control boundary; authorized CRM users share the pipeline.

## Local trial

From this checkout, run `node scripts/preview-crm.mjs` and open `http://127.0.0.1:5188/?tab=crm`. The script creates a fresh temporary PostgreSQL database and clearly labeled sample records. Email sends are simulated and external server requests disabled. It never connects to the production database. Preview records are disposable and do not migrate to production. Stop the process when finished.

Try creating an opportunity, moving it, logging a call, setting its next action, saving an email draft, simulating a send, and archiving/restoring it. Use existing sample records only in this local preview.

## Gmail send semantics

A draft is claimed in PostgreSQL before calling Gmail. Only one request can claim a particular draft revision. Retries return the original attempt; sent/uncertain attempts never go back to draft. A Gmail success and its activity entry commit together. If storage fails after Gmail acceptance, the claim remains and prevents a second send.

Network errors, ambiguous provider failures, and interrupted attempts require manual review. Wait two minutes, check the correct Gmail account's Sent folder for the exact recipient/subject/body, then record “sent” or “not sent.” A recorded “not sent” does not replay the old request: compose a new email deliberately. An unresolved attempt blocks sending another draft for that opportunity. This prevents automatic duplicates, but manual incorrect verification or deliberately composing the same email twice can still duplicate it.

The sender reviewed in the composer must match the connected account at send time. Token retrieval is bound to the connection revision so a concurrent account reconnection cannot silently switch sender. Google credentials remain encrypted in the existing server-side connection table. CRM OAuth requests only OpenID, email and `gmail.send`; Google may retain scopes previously granted for other Campfire features. There is no background inbox sync or Gmail read-based reconciliation.

“Sent” means Gmail accepted the request; it is not a delivery/open guarantee. The Google connection is shared with existing Campfire Google integrations for that user.

## Release steps before Roy relies on it

1. Review/merge this branch into the actual release branch, preserving concurrent Campfire work. Run `npm run check` and the normal deployment security checks.
2. Select the intended database explicitly. Run the existing `npm run db:migrate` release step with the migration credential. It adds `crm_opportunities`, `crm_activity`, and `crm_emails`, their indexes, and runtime grants. Request handlers never perform DDL. Do not point the local preview script at a real database.
3. Verify the production database backup/PITR retention and perform a restore rehearsal into an isolated database. CSV is an operational export, not a complete backup of history or emails.
4. Verify the existing Google client/callback/encryption configuration for the production domain, Gmail API activation, and the appropriate Google internal-use/verification configuration. Roy connects his own Google account; no one enters his password or tokens into Campfire.
5. Keep CRM restricted to the owner for now. Roy must not receive access until the owner explicitly authorizes a later rollout and its access policy is updated.
6. In the deployed environment, verify the owner's access and that unrelated users are denied, confirm the sender, and send one explicitly approved test message to an internal address. Check Sent and the CRM activity. Test reconnect and uncertain-state instructions.
7. Pilot with a small set of real opportunities. Confirm save reliability, follow-up usability, exports, and archive/restore before adopting as the sole system. Assign an operational owner for errors, database capacity, and connection support.

## Verification

`tests/crm.test.mjs` exercises real PostgreSQL through the Neon driver using isolated PGlite, with injected provider responses. Coverage includes invalid input/header injection, send-only access model, idempotent save receipts, concurrent record writes, transactional audit rollback, private drafts, stale draft edits, one external call under concurrent sends, timeouts, rejected sends, token expiration, post-send storage failure, manual resolution, permission-denied paths, sender changes, CSV formula escaping, and follow-up dates.

Browser verification: create/save opportunity, reload persistence, log activity, save email draft, explicit message review, simulated send receipt, and drag-and-drop stage update were exercised against the local database. Real OAuth and delivery remain rollout checks. The full repository `npm run check` covers backend syntax, regressions and production build.

## Capacity and operations

The first release reads up to 5,000 opportunities and fails visibly beyond that bound; it does not silently truncate the pipeline. Activity loads per opportunity. Add server pagination before approaching those limits. Email is sent synchronously with a 25-second provider deadline and no automatic retry. Review stale `sending`/`uncertain` attempts in the opportunity email panel. Application errors log codes without message bodies or tokens. This release does not install a proactive alerting service.
