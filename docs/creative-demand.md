# Creative demand

The Creative Demand workspace opens with a simple monthly recommendation at exactly 4.5× aMER: new ads to produce, weekly launch and brief dates, the DTC goal, Meta spending limit, and first-30-day testing commitment. A month selector and monthly schedule download are visible. Detailed forecasts, assumptions and historical tables are collapsed by default. The advanced view retains 4.0×, 4.55× and 5.0× comparisons alongside 4.5×; changing that comparison does not change the headline’s 4.5× target. It separates diagnostic creative demand from a funded calibration schedule. Launch counts are not revenue guarantees or approved production quotas.

## Sources and permissions

The private `dashboard_settings.creative_demand_history` baseline is served behind `analytics.read`. Saved assumptions require `analytics.write` and live in a separate key. Raw provider records and private financial figures must never enter Git or public assets. The API uses private/no-store caching. No ad settings or financial targets are changed by this workspace.

Monthly launch identity begins in September 2023; standardized daily seven-day-click performance begins in January 2025. The displayed cutoff and stale warning are authoritative. Refresh is manual. Do not mix the existing daily insights table into the baseline without verifying attribution compatibility.

To refresh, retrieve paginated Meta metadata including paused/archived ads, monthly insights for launch identity, and daily insights for measurement. Reconcile ad-level spend to account totals, update Shopify classifications and the DTC-specific targets, preserve the previous private baseline, then run:

`node --env-file=/secure/path/.env scripts/import-creative-demand.mjs /secure/path/demand-inputs.json`

The importer validates and verifies row counts and cutoff; it preserves saved assumptions. Editing the target sheet does not automatically refresh this snapshot.

## Creative identity and performance

- A unique asset is an exact set of Meta media IDs, including all carousel/dynamic media. Repeated ad IDs do not imply new production. Reuploads and ratio exports may still count separately. These are not concept counts.
- Launch means first observed delivery, not creation time. The first historical month may include older assets. Unmapped ads stay in launch counts but do not enter lifecycle benchmarks.
- A launch window is mature only after 30 delivery days plus seven attribution days. Below-minimum delivery is unresolved, not evidence of creative failure.
- A first-month winner meets configurable spend, purchase and Meta ROAS thresholds during days 1–30. Meta ROAS is independent of aMER and does not establish product profitability.
- Launch-to-winner yield includes all mature mapped launches. Tested hit rate uses only assets meeting the test-spend threshold.

## Lifecycle model

`src/lib/creative-lifecycle.js` aggregates duplicate asset/day rows and uses prefix sums for point-in-time windows. Age windows are days 1–30, 31–60, and 61–90. Each uses only launches with that complete window and seven-day attribution lag. Zero delivery stays in the denominator.

The 30/60/90-day cumulative spend comparison uses the same fully observed first-month winners. The separate age-window curve has a different eligible sample at each age, explicitly displayed. Qualified spend in later windows includes only first-month winners that also meet the threshold in that later window. Total spend includes every outcome. Unsuccessful spend includes assets that were not first-month winners, including unresolved tests. Later cumulative threshold crossings are reported separately, not silently promoted into the first-month-winner curve.

Spend curves use means per launch, retaining zeros and skew, rather than median winner spend multiplied by a hit rate. Calendar planning prorates the age-window means by overlap days. Uniform within-window pacing is an assumption. No spend beyond day 90 is projected. Continued spend is observed delivery, not proven incremental capacity; disappearance is not proof of permanent fatigue.

## Existing-library forecast and validation

The current library contains mapped assets qualifying over the latest mature 30 days, ending seven days before the snapshot cutoff. The model takes historical monthly snapshots using the same gap between the baseline end and first target-month start as the live forecast. It measures total and qualified spend by those same assets over each of the next three calendar months.

For each horizon, predicted spend is current baseline spend multiplied by pooled future spend / pooled historical baseline spend. Newly launched historical assets cannot enter a snapshot after selection. Each historical training outcome must be fully observed plus seven attribution days by the decision date. Repeated assets and overlapping windows are not independent observations.

Rolling holdouts compare both total and qualified spend with outcomes; a persistence comparison repeats baseline qualified spend unchanged. Error is sum of absolute error / sum of actual spend. Forecasts need at least three training windows, ten asset observations, three holdouts and errors ≤50% for both spend measures to pass the planning check. An inadequate or inaccurate model remains visibly provisional; the threshold is an internal heuristic, not a statistical guarantee.

A separate launch-cohort holdout predicts qualified spend over 90 days using only age windows mature before that launch month. The evaluated month's entire cohort must be mature through day 90 plus attribution. The previous first-month holdout remains as a historical diagnostic, labeled separately.

Product and prospecting/retargeting segments are not inferred from ambiguous ad names. Verified metadata or manual labels are needed before publishing those splits. Other existing assets and reactivations remain unmodeled opportunities.

## Funded production schedule

For each month:

1. DTC target × (1 − returns allowance) × new-customer revenue share / aMER determines total allowable advertising spend. Subtract other-channel spend for Meta's limit.
2. Forecast today's qualifying library, capped to Meta's budget with the qualified fraction preserved. Reserve a percentage for unsuccessful new-asset spend.
3. Create continuous weekly launch slots starting no earlier than the planning date plus production lead time. Weekly slots continue across month boundaries. An optional integer weekly production cap limits assets; zero means capacity is unset.
4. Allocate earlier slots first, dividing available current-month funding over remaining weekly slots. Fund a full first-30-day expected media cost at launch, at least the minimum test allocation. Also commit the full expected unsuccessful portion against that launch month's reserve. This prevents late-month launches from claiming large counts with only one day's funding.
5. Carry projected total, qualified, and unsuccessful spend into all future target months using 90-day curves. Cap each new batch against every affected month's remaining total budget and unsuccessful-test reserve. A lower future budget can constrain an earlier batch.
6. Keep commitment checks separate from calendar spend; do not add them together. Report spend beyond the target horizon separately for future funding, not as already budgeted.

This is a transparent earlier-first allocation rule, not an optimization claiming the best possible schedule. First-slot diagnostic demand assumes all required assets launch in the earliest slot, ignoring team capacity; it is not the funded schedule. Expected first-30-day winners can mature after the launch month. Zero funded launches means a constraint binds; it does not erase the spend gap.

The schedule gives brief, launch and mature-review dates, expected media cost, minimum test allocation, and a downloadable CSV. Production cost is excluded. Creative owns delivery, media buying owns launch and adequate testing, and growth owns budget release and actual aMER. Thresholds, budget shares, other-channel budgets, returns and production capacity remain provisional until reviewed. The legacy retention input remains API-compatible but no longer drives the lifecycle forecast.

## Validation

Tests cover duplicate aggregation, exact day boundaries and attribution lag, censoring, zero delivery, late qualifiers, month-length allocation, 90-day cutoff, holdout leakage, cross-month carry, full-test commitments, future budget limits, weekly capacity across month boundaries, unavailable evidence, and lead times outside the planning horizon. Existing endpoint authorization and assumption validation tests remain in place.

`CREATIVE_DEMAND_INPUT=/secure/path/demand-inputs.json node scripts/preview-creative-demand.mjs` starts a localhost-only read-only preview. Never expose it publicly. Live production continues to read the protected stored baseline.
