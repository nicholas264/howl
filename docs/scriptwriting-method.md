# HOWL scriptwriting method

The shared server module `api/_lib/howl-scriptwriting.js` contains the runtime method distilled from the supplied Unlock Performance training and a dated HOWL product reference. It is deployed with the app and does not depend on a local Codex skill installation. Version: `2026-09-23.1`.

The method guides qualified hooks, connecting second lines, awareness-based onramps, problem and solution mechanisms, relevant sales-sequence questions, objection handling, filmable execution, and controlled creative iteration. It distinguishes R1, R3 and R4 MKii and requires evidence for testimonials and mutable claims.

## Script Studio

The unified Script Studio replaces the separate Founder Ads and Concept Studio screens. It sends a validated `script_studio` brief to `/api/generate`, loads creator context server-side, and returns a checked JSON script with three alternate openings and a shot list. Users can edit spoken copy, download the complete brief, save locally, send to Results, or save creator work to briefs and the Creative Board. Older screen URLs remain aliases. Browser-local Founder Ads saves remain readable.

## Integration

- Founder Ads: `/api/generate`, `task: founder_script`; the server builds the prompt from the structured brief and preserves HOOK/STORY/PROOF/CTA spoken output.
- Concept Studio winner iterations: `/api/generate`, `task: winner_concepts`.
- Concept Studio net-new concepts: `/api/creator-workflow`, `generate_concepts`.
- Creator briefs: `/api/creator-workflow`, `generate_brief`.
- Campaign plans: `/api/creator-campaign-planner`, `generate`.

Existing JSON schemas and persistence remain in place. Generation calls without a scriptwriting task retain their existing prompt behavior. Founder and winner responses expose the method version in `X-HOWL-Scriptwriting-Version`.

## Maintenance and verification

Edit the shared module and increment its version when updating the method or product basis. Changes to the personal Codex skill do not automatically update the deployed app. Verify current product listings before changing product facts. Raw lesson transcripts and private examples are not distributed with this implementation.

`tests/scriptwriting-integration.test.mjs` exercises all five generation paths against an isolated database with mocked model responses. It verifies that the shared method reaches the provider and the existing response/persistence contracts hold. These checks establish wiring and contracts, not model adherence or ad performance; generated drafts still need editorial review and performance testing.

Run `npm run check` and `npm audit` before release. No database migration is required for this integration.
