# Preview environment isolation

As of September 6, 2026, new Howl previews use the separate `howl_preview`
database in the existing Neon project. The `howl_preview_owner` login has no
superuser, role-creation, or database-creation privileges. It can create application
objects inside the preview database. A production privilege check found no
SELECT, INSERT, UPDATE, or DELETE access across all 75 public production tables.

The database was initialized from application migrations, not a production data
copy. Only the two existing authorized members were provisioned with their current
roles and existing development Clerk identities. No production ad, creator,
customer, order, or Google connection records were copied.

Fifteen database connection variables now have separate Preview values. Their
Production and Development values were retained; all 65 original Production
variable values and targets were compared after the split and remained unchanged.
Preview uses the existing development Clerk application and a preview-specific
`VITE_CLERK_PUBLISHABLE_KEY`.

Production credentials for Anthropic, Blob, ClickUp, Klaviyo, Shopify dealer
access, Google OAuth, and Google Ads were removed from Preview targets. Features
requiring those services need separate sandbox credentials before they can be
exercised in preview. Never copy production credentials back to make a preview
feature pass a smoke test.

## Remaining boundaries

- Existing deployments retain their previous environment snapshots. Inventory and
  retire or rebuild legacy previews before claiming all deployed previews are
  isolated. Changing project variables does not revoke old credentials.
- Production and preview databases currently share a Neon branch and compute.
  Database privileges separate data access; they do not isolate capacity or
  branch-level operations. A dedicated branch or project remains preferable for
  independent capacity and recovery.
- Development still retains its prior configuration. Local development isolation,
  provider sandbox provisioning, and production credential rotation remain work.
- Keep `GOOGLE_TOKEN_ENCRYPTION_KEY_V2` inactive until every deployment allowed to
  access production has compatible readers, as described in `recovery.md`.

Use Vercel's authenticated CLI or dashboard to manage targets. Preserve the
Production variable record and value when removing Preview from a shared target
list, then add the Preview-only value. Verify both target sets and database
permissions after a change. Secrets belong in the environment manager and ignored,
owner-only provisioning files, never in this repository.
