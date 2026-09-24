# COO workspace

Campfire's `?tab=coo` workspace connects company planning, department scorecards, execution, and operating reviews. Open it from **Company → COO Workspace** or the performance workspace.

## Operating flow

The four primary views are **Operating view**, **Plan**, **Constraints & actions**, and **Weekly review**. Department and cycle configuration lives in **Setup**.

1. Set up Manufacturing, Sales & Marketing, and Sourcing & Parts, or create your own departments. Finance, People, and other teams can be added and renamed. Set an accountable owner and description.
2. Create an annual planning cycle and quarterly cycles inside it. Cycles use explicit dates rather than hard-coded fiscal quarters.
3. Define company objectives. Align department objectives to company objectives in the same cycle or its annual parent.
4. Add KPIs for operating health and key results for improvement goals. Every metric has an owner, department, cycle, baseline, target, unit, target direction, definition, source reference, and update cadence. Key results must link to an objective. Suggested templates contain definitions, not targets or actuals.
5. Add dated plan checkpoints ending at the original goal. Record actuals and the latest expected finish with **Update progress**. In the same form, update a shared constraint and assign a next action. Same-date corrections preserve earlier entries and supersede their value.
6. Create shared constraints linked to affected measures or goals across departments. Give each a resolution owner, impact, decision needed, due date, and dated progress. Create initiatives, milestones, and follow-up actions linked to those constraints. Connect them to objectives, assign owners and due dates, and link dependencies. Record status through check-ins. Dependency loops and cross-cycle dependencies are rejected.
7. Use the review agenda to inspect exceptions. Save a dated operating review with discussion, decisions, and lessons. Its scorecard snapshot is immutable. Assign follow-up actions from the review.
8. Select earlier cycles to review their results. Use **Plan in another cycle** on a metric, objective, or initiative to reuse its definition with a new cycle and fresh actuals. Relink objectives and dependencies explicitly. Export the filtered scorecard as CSV.

## Calculation rules

- Pace compares the actual with the most recent agreed checkpoint at its reporting date. Expected finish compares the latest forecast with the original goal. Keep definitions consistent: cumulative totals for flows, point-in-time values for rates. Actuals are not automatically summed.
- Key result progress is `(actual − baseline) / (target − baseline)`, clamped to 0–100%. Decreasing targets work the same way. Targets must improve from baseline.
- Checkpoints are explicit steps; no linear interpolation is assumed. Favorable comparisons are on track; adverse gaps within the configured absolute-unit tolerance are at risk, and larger gaps are off track. Missing plans and forecasts are explicit. At cycle end the actual is compared with the goal. Stale updates remain visible independently of these comparisons.
- An update older than its cadence is marked **Update due**. No actual is **No update**, never zero. Future cycles are **Not started**. Ended cycles are assessed at their end date, so historical results do not degrade with today's date.
- Objective progress averages its direct key results equally, including unreported results as zero and showing the reported count. Linked department objectives are not automatically rolled up. Archived objectives retain archived key results for historical inspection.
- Initiative status comes from its latest dated check-in; unfinished commitments past their due date are overdue. Milestones and dependencies are explicit links, not automatic completion rules.

## Sharing and data sources

The initial rollout is restricted to the authenticated `owner` role. The sidebar, performance hub, and direct-tab rendering hide the workspace from every other role, and the API rejects both reads and writes before querying COO data. Admin, strategist, analyst, and viewer roles have no access, even with analytics permissions. Existing `analytics.read` / `analytics.write` checks also remain in place. Owners are free-text accountable names; assignment does not send notifications or create accounts.

Actuals and expected finishes are manual. Supported additive monthly financial forecast fields can be copied from the cached `/api/forecast` response into a draft plan for whole-month cycles. Import does not sum ratios, modify the source forecast, or continuously synchronize. Missing months are rejected. The overview links to Campfire's business dashboard, dealer reporting, and SKU media pacing as report sources. These links do not automatically synchronize measurements. There are no supplier, manufacturing, inventory, or HR data connectors in this release.

## Storage and release

`api/coo-workspace.js` provides GET and POST commands. The additive migration creates `coo_workspace`, containing the single company's shared state and an optimistic concurrency revision. The database is Campfire's existing single-company boundary; there is no client-selectable tenant identifier.

Writes use compare-and-swap SQL to prevent concurrent changes from being lost. Individual record versions also prevent an old edit form from overwriting the same record after refreshing the workspace. Saved nonempty plans, goals, and tolerances are locked; forecast revisions belong in progress updates. Reviews freeze metric and constraint snapshots. Check-ins preserve history; measurement definitions with observations cannot change target, baseline, unit, direction, department, kind, or cycle. Create a new metric instead.

This first storage implementation loads one bounded company document. It limits each collection to 2,000 records, check-ins to 20,000, and serialized state to 2.5 MB to stay below hosted response limits. A rejected capacity write does not alter data. Larger installations should move history to paginated tables before reaching this limit. Archive hides records without deleting their history or reducing storage size. Parent records with active children cannot be archived.

Before deployment:

1. Run `npm run check` with the repository's isolated test runner.
2. Select the intended database explicitly and run the existing `npm run db:migrate` migration workflow. It includes `ensureCooWorkspace` and runtime grants.
3. Deploy through the normal Campfire release process, then verify owner access and rejection of all non-owner roles against the selected environment.

No production migration or deployment has been run for this feature.

## Isolated preview

Run `node scripts/preview-coo.mjs`, then open `http://127.0.0.1:5194/?tab=coo`.

The preview uses the real COO HTTP handler and an in-memory PostgreSQL database via PGlite. Only authentication is replaced for local testing. The financial forecast endpoint returns a labeled demo fixture; other API routes return inert responses; no business-provider calls or production database credentials are used. Demo data is visibly labeled. Changes survive browser reloads but disappear when the preview process exits. The preview binds only to localhost and is not a production server.
