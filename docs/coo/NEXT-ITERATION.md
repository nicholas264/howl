# Connected operating workflow — implemented locally

Goal → agreed checkpoints → actual and expected finish → gap → shared constraint → owned action → progress update.

The refinement is implemented in the local COO workspace. Operating view separates pace against the agreed plan from expected finish against the original goal. Plans stay fixed after saving; forecast revisions remain dated history. Missing and stale data are explicit.

Constraints link multiple measures and goals across departments, with one resolution owner, impact, current decision, due date, and progress history. A single progress form can update a measure, create or update a constraint, and assign an action atomically. Actions follow the constraint's resolution department. Resolving a constraint clears its pending decision without rewriting metric forecasts.

The four main views are Operating view, Plan, Constraints & actions, and Weekly review. Setup is secondary. Reviews retain immutable snapshots of measurements and constraints.

Monthly financial forecast import copies supported additive fields from the cached forecast into a draft for whole-month cycles. Actuals and latest expected finishes remain manual. Manufacturing and sourcing plans can use manual checkpoints. Assignment records accountability; it does not grant access or send notifications.

Access remains restricted to the authenticated owner role in both UI and API. Production migration and deployment have not been performed. See README.md and VERIFICATION.md for operation and validation details.
