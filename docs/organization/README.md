# Organization chart

Open **Company → Organization chart** (`?tab=organization`). Access requires the authenticated owner role and admin permission in the API; navigation and direct rendering also require owner. Non-owner admins with wildcard permissions are rejected before any organization query.

The owner supplied 11 names and titles on September 23, 2026. The empty directory offers a one-time **Add the 11 supplied team members** command. It rejects nonempty directories, avoiding duplicates. No reporting lines, departments, responsibilities, employment dates, or assembly technician names are inferred. The supplied roster lives in `api/_lib/organization-roster.js`; import remains an explicit owner action after deployment.

Drag a person onto a manager's card to change their reporting line; their team moves with them. Drop onto **Not placed yet** to clear it. The profile's manager selector supports keyboard and mobile assignment. Changes save immediately. Self-reporting, descendant-reporting loops, archived managers, and hierarchies beyond 30 levels are rejected. Filtered charts retain managers for context. The chart is a top-down tree with connecting lines, zoom controls, and collapsible branches. Unassigned people sit in a separate tray. The supplied CEO role anchors the initial canvas; this does not assign anyone to that person. Other reporting groups appear as you assign managers. Search responsibilities or switch to the team directory.

Profiles store roles, responsibilities, department, reporting manager, work email, location, employment type, and employment start/end dates. Tenure uses completed calendar months and stops at the end date. Missing dates stay unknown. Chart membership is controlled by archiving; recording an end date alone does not remove someone from the chart. Reassign direct reports before archiving. Archived people can be restored, and an archived former manager is cleared on restoration.

This directory is independent of application accounts and COO free-text owners. Adding people or assigning managers does not invite anyone, notify anyone, or change permissions. There is no automatic payroll/HR synchronization or inferred responsibility assignment.

The additive migration `ensureOrganization` creates `organization_workspace` using the existing release migration/grant workflow. Profiles and immutable before/after edit snapshots share a bounded document: 2,000 people, 10,000 changes, 2.5 MB serialized cap. SQL revision comparisons prevent lost updates, with individual profile versions protecting stale forms. No production migration or deployment has been performed.

## Verification

`npm run check` passed: 250 tests, zero failures, API syntax checks, and production build. Nine organization tests cover tenure boundaries, filtered hierarchy, loop rejection, validation, history, archive/restore, owner-only access, actual PostgreSQL persistence and revision conflicts, supplied roster import, and manager assignment.

Browser verification used the real organization handler and isolated PGlite database: imported the supplied roster, dragged people from the tray onto managers and observed a saved three-level hierarchy with sibling branches and connector lines, cleared the assignment via the manager selector, edited responsibilities and employment date, and reloaded to verify persisted profile and calculated tenure. Temporary test edits were removed by restarting the isolated preview and importing only the supplied names/titles again. At a requested 390px mobile viewport, document client and scroll widths were both 384px.

The localhost preview uses a mocked owner identity, never production credentials. Organization names are the owner's supplied roster; COO examples are illustrative. Local preview changes are temporary and reset when its process stops. Hosted authentication and production database grants must be checked during release.

## Chart navigation and QuickBooks roster

Drag blank chart space to pan horizontally or vertically; dragging a person still
assigns their manager. Scrollbars, trackpad scrolling, zoom, and arrow keys remain
available. Panning does not write to the directory.

**Add from QuickBooks** uses the existing owner-only accounting connection. It
paginates active Employee and Vendor records, identifies 1099 contractors, and
lets the owner include other vendors individually. Review the selection and set
an optional shared role, department, and manager (for example, select assembly
techs, enter “Assembly technician,” then select their actual manager).

The server re-reads QuickBooks on import, validates selections, and saves the
entire batch with the workspace revision and current connection version checked.
Existing names/emails or hashed source IDs are skipped; ambiguous matches stop
an import. Imported source IDs survive profile edits and archival. Only employees are automatically selected. Contractor and supplier records
require individual review because QuickBooks contractor flags may include suppliers. Job titles, full-time status, managers, and dates are not inferred.
Tax/payroll/banking fields never leave the provider adapter or enter storage.

Run `node scripts/preview-organization.mjs` for an isolated synthetic roster and
in-memory PostgreSQL preview at `http://127.0.0.1:5193/org-preview`.
