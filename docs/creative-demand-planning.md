# Creative Supply and Demand Planning

## Product Goal

Build a monthly planning function that connects creator commitments, content
deadlines, shipped assets, Meta performance, and company spend and CPA goals.

## Supply Forecast

- Classify creators as retainer or one-off.
- Track retainer commitments and one-off approval dates.
- Track expected asset quantity, content deadlines, approvals, and completion.
- Forecast assets expected by week and month.
- Separate committed, likely, at-risk, completed, and overdue supply.
- Prevent revisions or multiple source files from inflating asset counts.
- Show the contribution from retainer and one-off creators separately.

## Historical Asset Productivity

Attribute every shipped asset to its creator, brief, deliverable, launch date,
and Meta ad. Report:

- Average and median revenue per asset shipped.
- Spend, purchases, CPA, and ROAS per asset.
- Asset win rate and useful lifespan.
- Performance cohorts by creator type, creator, product, format, concept, and
  launch month.

Median and cohort-level metrics should appear alongside averages so breakout
ads do not distort planning assumptions.

## Demand Model

Given a monthly spend target and CPA target:

1. Purchases required = spend target / CPA target.
2. Estimate the number of active assets needed using historical spend capacity
   and useful lifespan.
3. Estimate new assets required using historical win rate, fatigue, and
   revenue or spend capacity per shipped asset.
4. Compare required new assets with forecasted creator output.
5. Report the expected asset surplus or shortfall.

The model should allow editable scenarios for:

- Spend target.
- CPA target.
- Revenue target.
- Revenue or spend capacity per asset.
- Asset win rate.
- Useful asset lifespan.

## Planning View

Create one focused monthly view showing:

- Weekly and monthly creative supply.
- Creative demand and its assumptions.
- Asset surplus or shortfall.
- Retainer versus one-off contribution.
- Deadlines and creators creating forecast risk.
- Forecast versus actual output and performance.

## Implementation Status

- Monthly creator supply, retainer versus one-off contribution, weekly deadlines,
  unscheduled commitments, and delivery risk are live in Creative Plan.
- Creator, deliverable, asset, ad, and Meta performance attribution is live.
- Historical average and median asset productivity, editable spend and CPA
  scenarios, required new assets, and supply surplus or shortfall are live.
- Historical defaults remain disabled until at least 10 spending assets are
  available; manual assumptions stay authoritative while the sample is small.

## Data Foundations

Likely additions:

- Creator engagement type.
- Creator approval date.
- Retainer start and end dates.
- Contracted asset commitment and cadence.
- Deliverable expected asset count.
- Content deadline, approval date, completion date, and shipped date.
- Explicit relationships among creator, brief, deliverable, asset, and ad.

## Guardrails

- Clearly distinguish forecasts from actuals.
- Keep assumptions visible and editable.
- Preserve HOWL's direct navigation and focused interface.
- Do not present a single average as a reliable forecast without cohort and
  distribution context.
