# Creative demand

The Creative Demand workspace connects the DTC revenue plan to three aMER scenarios (4.0, 4.55, 5.0). It is an evidence-backed scenario tool, not an automatic creative quota or a claim that an ad count causes revenue.

## Sources and refresh

Historical input lives in `dashboard_settings.creative_demand_history`, behind `analytics.read`. Raw provider records and private revenue baselines are not committed or put in public assets. Saved assumptions live in a separate key and require `analytics.write`. No existing forecast, financial target, or ad account setting is changed.

The first baseline contains monthly first-observed delivery history from September 2023 and daily standardized seven-day-click performance from January 2026. Display the source cutoff, import date and a stale warning after seven days. The baseline is a snapshot, not an automatically scheduled sync. Do not mix the existing daily insights table into it: that table does not identify the attribution window of every row.

To refresh: retrieve complete paginated Meta metadata (including archived/paused ads), month-level ad insights for historical launch identity, and daily insights for evaluation windows; reconcile ad-level spend against account-level spend; update Shopify classifications and the DTC-specific revenue plan; normalize into the baseline schema. Preserve an old baseline locally before replacing it. Then run `node --env-file=/secure/path/.env scripts/import-creative-demand.mjs /secure/path/demand-inputs.json`. Never commit the input or credential file. The importer verifies the stored row counts and cutoff. Existing scenario assumptions are preserved.

## Definitions

- Unique asset: exact media-ID set across an ad, including all carousel/dynamic media. A repeated ad ID using the same set is not new production. Reuploads and ratio exports can still count separately. Not a concept count.
- Unmapped ad: retained separately in launch counts; excluded from hit-rate and capacity benchmarks.
- Launch: first observed delivery, not creation timestamp or launch-tool log. The first historical month may be left-censored. Daily launch dates are established for the daily-history period only.
- Mature: first 30 days fully observed plus seven days to mature attribution. Later spend never leaks into the launch outcome.
- Tested: minimum spend reached in that window. Below-threshold assets are unresolved tests, not automatically creative failures; they still reduce the end-to-end launch-to-winner yield.
- Winner: meets independent configurable spend, purchase and Meta ROAS thresholds. A Meta ROAS threshold is not an aMER threshold or verified product profitability.
- Launch-to-winner yield: winners / all mature mapped launches. Tested hit rate: winners / tested mapped launches.
- New winner capacity: median observed spend in the first 30 days among winners. Quartile sensitivity is not a statistical confidence interval. Spend is observed delivery, not proven incremental capacity.
- Existing qualified spend: assets meeting the same thresholds across the latest mature 30-day period. Editable monthly retention reduces the baseline for later targets.

## Budget and demand

DTC target after the returns allowance × assumed new-customer revenue share / target aMER = total allowable ad spend. Subtract planned other-channel spend for Meta. Reserve a percentage for unsuccessful tests and subtract retained existing creative spend; the remainder is the new-winner spend gap. Divide by median first-month winning spend, round up winners, then divide by launch-to-winner yield and round up launches. Winner spend already includes the winner's testing phase.

The reserve-supported launch count divides the reserve by expected unsuccessful spend per launch. It is a budget envelope at historical costs, not a guaranteed number of conclusive tests. Required spend per winner at that volume makes the remaining scale gap visible.

Separately estimate unsuccessful-asset spend from the historical nonwinner mean. If it exceeds the testing reserve, flag the scenario as not ready for a production quota. Also flag inadequate winner samples, other-channel overspend, and high holdout error. Four-week production rates require all assets to launch at the beginning of the target month; do not imply that mid-month launches earn a full month's capacity. Future months are standalone stress tests against the current library, excluding wins not yet produced.

Revenue-share, retention, lead-time, channel budget and returns assumptions are editable and explicitly labeled. Targets derive from the updated Q4 build/sell sheet as total revenue less dealer revenue, not the older cached combined-channel forecast. Editing that source sheet does not automatically update this baseline.

## Validation and limitations

Historical revenue correlations exclude the current partial month and visibly incomplete early Shopify history. Only sufficiently classified, completed periods receive observed aMER; missing classification is not replaced by customer-count ratios. Correlation does not control seasonality, offers, prices or product launches.

Rolling holdouts train only on launch windows that had closed before the test month. The evaluated month must have every mapped cohort asset mature. They estimate qualified first-month creative spend using prior yield × prior median winner spend. The displayed weighted absolute error is sum(abs(predicted−actual))/sum(actual), not a revenue forecast error. High error prevents presentation as an approved production quota.

Tests cover asset/day deduplication, fixed window boundaries, immature and unmapped assets, zero winners, channel budget arithmetic, unsuccessful-test costs, input validation, permission boundaries, and holdout leakage. A localhost preview serves only a supplied local baseline with no credentials or live writes.
