# Campfire Financials — Privacy Notice

Effective September 26, 2026.

## Scope

This notice describes the QuickBooks Online integration in HOWL's internal
Campfire application at welcometothecampfire.io. It supplements HOWL's
[website privacy policy](https://www.howlcampfires.com/policies/privacy-policy).
For the QuickBooks data described here, this notice governs its use within
Campfire. Storefront advertising and marketing practices do not describe the
use of QuickBooks financial reports in Campfire.

## Information and purpose

After the authorized owner connects HOWL's QuickBooks company, Campfire stores
the company identifier, encrypted authorization tokens, and a snapshot derived
from Profit and Loss and Balance Sheet reports. That snapshot contains account
identifiers and names, item identifiers, names, SKUs and product mappings, monthly item revenue and COGS, monthly income and operating costs, and balance-sheet
amounts. Account names may contain personal information entered in the books.
Campfire also stores the owner's financial targets, cost classifications,
accounting settings, and connection/sync metadata.

This information supports HOWL's internal financial reporting and planning.
QuickBooks report data is not used for advertising, sold, shared with other
businesses for their own purposes, or sent to generative AI systems for
inference or model training by this integration.

The owner may also import active employee and contractor names and work emails
into the organizational chart. Campfire reads employee/vendor records and keeps
only roster fields and a hashed source reference for duplicate detection. It
does not retain tax identifiers, pay rates, bank details, or payroll records in
the chart. Imported profiles and their edit history remain until separately
removed; disconnecting QuickBooks does not remove organizational profiles.

## Access and service providers

Financials is currently available only to the authorized workspace owner.
Campfire uses Clerk for authentication, Vercel for application hosting and
server execution, and Neon for database storage. These services process
information needed to operate the application; Intuit provides the connected
accounting service. This notice does not assert that all data remains in a
particular country.

Campfire encrypts QuickBooks authorization tokens before database storage and
enforces owner authorization on financial API requests. Credentials are kept
on the server. These measures reduce risk but cannot guarantee absolute
security.

## Connection control and retention

The owner initiates report syncs manually. Campfire retains the latest
successfully saved snapshot until it is replaced by a successful sync or
cleared by disconnecting or reconnecting the company.

Disconnecting in Campfire deletes the active connection credentials, saved
snapshot, cost classifications, and pending connection requests from the
application database. It keeps manually entered targets and other plan
settings. Intuit authorization can also be revoked through QuickBooks Connected
Apps. Disconnecting does not change or delete HOWL's original QuickBooks books.

Deletion from active application records does not represent immediate erasure
of infrastructure backups or operational logs. Their retention and deletion
are governed by HOWL's configured service-provider arrangements.

## Questions and requests

Contact the Campfire workspace owner for access, correction, deletion, or
security concerns relating to this internal integration. Material changes to
its data use will be reflected in this notice before they are introduced.
