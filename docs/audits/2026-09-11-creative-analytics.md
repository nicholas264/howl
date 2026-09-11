# Campfire creative analytics review

Inspected the live Creative Analytics page, the creator directory and Dominique Ritchie's profile, and the open Motion Top creatives report on September 11, 2026.

## Observed problems

- The entry page starts with a 500-variant technical report, above the creative dashboard itself. Shared-media IDs and repeated evidence disclaimers dominate the first screen.
- The actual asset browser appears below quality meters, evidence tasks, recovery forms, activity, batch intake, attribution counts, and worker queues. Each asset repeats source forms and long generated narratives.
- The variant report defaults to 30 days while the media view defaults to 14 days.
- Playback is reported as 100% ready while Facebook embeds visibly refuse to connect.
- Recommendations are detached from current card metrics: Worlds Hottest Callout says zero purchases and recommends pausing while its displayed metrics show 11 purchases and 4.29x ROAS.
- The creator picker shows the operations roster, while suggested matches use the whole creator database, so some suggested records are absent from the picker.
- Strong-performing creatives are classified as Promising, but the automatic concept handoff looks for Winner, which the classifier never returns.
- Analysis jobs show Anthropic credit exhaustion. UI changes do not resolve this provider issue.

## Implemented on codex/creative-analytics-workspace

- Creatives are the primary view: compact previews, selected metrics, explicit sorting, search, creator/status filters, cards/table, 12 results per page.
- Creator performance aggregates linked assets with ratio-of-total ROAS and CPA. Profiles open directly at Results.
- A native modal provides source assignment, current metrics, and a manual iteration hypothesis. Source saves use the existing API that updates assignments, assets, launches, and creator activity.
- Iterations persist to the existing creative board, carrying the confirmed creator ID, source group key, reporting window, and observed metric snapshot. They start ready to brief; they are not automatically generated or sent briefs. The source is a reference, not the new iteration's launched asset.
- Operational queues and full variant comparison remain available in separate views. Launch activity is collapsed. Variants and creative browsing share the selected day count.
- Matching and assignment use the same database roster; archived records are labeled in the source picker.
- Embedded links alone no longer qualify as direct playback readiness. Card browsing uses thumbnails, direct video opens on demand, and Meta-only sources have an external preview link.
- Old analysis is labeled as a saved snapshot and removed from summary cards. The concept handoff recognizes Promising and requires source/evidence readiness.
- A timezone regression that could exclude the latest insight date was fixed; rapid date changes cannot replace newer results with an older response.

## Validation and limits

Production build and backend syntax check passed. Isolated PostgreSQL tests cover creator aggregation, archived roster inclusion, source assignment persistence, iteration provenance, and the reporting-date regression in America/Denver. The full application checks and dependency audit passed locally and in the production build (zero vulnerabilities). No campaign changes, provider purchases, or outbound creator messages were made.

Browser verification also completed source assignment and saved an iteration; the creative board displayed the correct creator, source name, and hypothesis. Card pagination, search, and creator rollups are reviewed separately.

Local review uses synthetic records and an ephemeral database. Run `node scripts/preview-creative-analytics.mjs`, then open `http://127.0.0.1:5184/__creative-review`. This review does not prove production media availability or AI provider health. Actual transcripts, complete source videos, refreshed analyses, and ambiguous creator matches still require attention. The workspace was deployed to https://welcometothecampfire.io on September 11, 2026 (deployment dpl_HEVNRLVdiV26n7CZcQ4E6ffFetwV). Production verification saved the exact-name Conner Scalbom association, confirmed it after a fresh session, and opened the correct creator Results profile showing both attributed ads. Source coverage increased from 39 to 40 of 128 groups. A real draft, “Bryce WL-1 — controlled opening test,” saved with creator, source, hypothesis, and reporting metrics. Live verification found the app navigation omitted the creative board route; a follow-up fix exposes that route. Three batch playback recoveries returned no accessible source. Anthropic credit exhaustion and missing source evidence remain unresolved. Production credentials were not downloaded; automatic approval review required explicit authorization, which remains pending. No database schema changes or migrations were part of this release, and no new production database backup was taken.
