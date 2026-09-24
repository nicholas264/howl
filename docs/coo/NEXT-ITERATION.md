# Proposed operating workflow refinement

The owner asked for a simple view of performance against forecasts and goals, with owned constraints and progress logging. This is the proposed next iteration, not implemented functionality. The owner-only rollout restriction is implemented separately.

## One connected workflow

Goal → time-phased plan → actuals and current forecast → gap → constraint → owned actions → progress check-in.

Each measure should retain the agreed goal and original period plan while showing the latest expected finish separately. Status must distinguish actual performance versus plan to date from projected performance versus the final goal. Weekly/monthly schedules should reflect seasonality, production batches, and supplier timing rather than assuming a straight line. Missing or stale data should remain explicit.

The primary operating view should show department, measure, owner, goal, planned-to-date, actual-to-date, variance, current end-period forecast, projected gap, health, last update, and linked constraints. A compact default view should expose detail on expansion rather than requiring every column on a small screen.

## Constraints as records

A constraint should contain: description, affected goals/measures/departments, accountable resolution owner, impact, required decision, next action, due date, status, and dated updates. One constraint can affect multiple departments. Creating a constraint should not create duplicate copies for each affected measure. Initiatives, milestones, and actions should link directly to it.

Example: a missing component threatens production and sales. Sourcing owns the constraint, manufacturing owns its production measure, and an assigned action covers sample approval or expedited ordering. These are different accountabilities attached to one shared problem.

## A short weekly check-in

From a metric or constraint, record actual to date, expected period finish, what changed, constraint changes, and next action. That update should refresh the operating view, linked records, history, and review agenda. The weekly review then focuses on exceptions and required decisions. Record owners are accountable names; while this is private, the authenticated owner enters updates on their behalf. Assignment does not grant application access or send notifications.

## Navigation

Retain the existing data relationships, but organize the main experience around:

1. Operating view: performance, forecast gaps, and urgent constraints.
2. Plan: company goals, department measures, time-phased targets, and initiatives.
3. Constraints and actions: cross-department issues and resolution work.
4. Weekly review: quick updates, exceptions, decisions, and history.

Department/cycle configuration belongs in setup. Detailed OKR terminology can remain available without being required to perform a weekly update.

## Existing implementation and gaps

Already implemented: configurable departments and cycles; linked objectives and key results; metrics with thresholds and linear KR pacing; initiatives, milestones and dependencies; dated check-ins; preserved review snapshots and follow-ups.

Not yet implemented: time-phased forecast comparisons, independent current forecasts, structured constraint records and links, and a combined quick-update workflow. These require schema/API changes as well as interface changes.

Campfire's existing `/api/forecast` exposes cached monthly financial forecasts. Reuse supported fields only after matching each metric's definition, period, currency and aggregation. Do not sum ratios or percentages. Keep manual planning available for manufacturing and sourcing until their data sources are defined. Freeze original plans and retain forecast revisions so changing expectations does not erase prior commitments.
