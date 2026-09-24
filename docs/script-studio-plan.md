# Unified Script Studio

## Outcome
One writing workspace replaces Founder Ads and Concept Studio. Product, starting point (fresh idea, winning ad, supplied brief), delivery (founder, creator, voiceover), and duration define the request. One server-owned method produces a script, compatible alternate openings, filming notes, and a short strategy explanation.

## Design
Stay within Campfire's existing identity: paper #f7f6f2, white #ffffff, ink #171717, rule #dedbd3, muted #77746f, flame #d84a17. Instrument Serif titles and Helvetica controls/body. Use a 320px brief column alongside a spacious script manuscript, collapsing to one column on mobile. Left align all working content. The spoken script is the visual focus; production detail is progressively disclosed. No new decorative card system or new typefaces.

[Product / starting point / speaker] | [Title / editable spoken script]
[Context / duration / Generate]      | [Hooks / filming notes / rationale]
[Saved on this browser]              | [Copy / download / save creator brief]

Reviewed against the brief: this uses the established Campfire palette, not a separate aesthetic. Replace separate generator modes with one consistent output. Winning-ad selection appears only when relevant. A creator profile launches the same studio with that creator selected.

## Implementation and release
1. Add a validated structured Script Studio request to the shared server generator; load real creator context server-side and enforce brand guidelines.
2. Build the unified UI, output editing/export, browser saves, and explicit creator-brief saving using existing persistence and Creative Board integration.
3. Replace navigation entries and profile generation form; retain legacy route aliases and access to locally saved Founder Ads.
4. Exercise request validation, all delivery/starting-point combinations, creator persistence, existing regressions, and responsive UI. Deploy from latest production source and verify the production alias.

The initial release required no schema changes. Campaign planning remains a separate portfolio workflow using the existing shared method. Local saved drafts remain clearly labeled as browser-local.


## Labeled output, shared versions, Docs and measurement
- Show exact spoken excerpts and a plain-language job for hook, onramp, problem mechanism, product introduction, solution mechanism, proof, objection handling and CTA. Intentionally absent beats explain why. Editing spoken copy invalidates the breakdown until refreshed.
- Save complete, immutable versions to `script_studio_scripts`. Edits save a child version; identical saves by one user are idempotent. Retain local drafts and creator brief handoff.
- Export the saved version as a native Google Doc using the current user's Google connection and Drive HTML conversion. Include the spoken script, labeled breakdown, alternate openings, strategy, shots and guardrails. Read back the created file before returning its link. External operation journaling prevents duplicate creation after retries; uncertain writes require operator review. Documents are copies, not a two-way sync.
- Link known Meta ad IDs explicitly to a saved version and the opening actually filmed. `script_studio_ads` permits one version per ad to prevent double attribution. Aggregate existing daily insights over 7, 30 or 90 days; calculate weighted rates from sums. No data remains null. Show spend, purchases, CPA, ROAS, CTR, hook and hold rates, with opening-level comparisons and last-sync status.
- Respect `briefs.read/write` for scripts and `analytics.read/write` for results/links. Google Docs consent requests only identity and `drive.file`, with no email scope added by this flow.

Deploy the additive tables before application code with `node scripts/migrate-script-studio.mjs` using the explicitly selected production migration connection. Set `HOWL_RUNTIME_DB_ROLE` when runtime uses a separate restricted role. The full migration also includes these tables. No existing script or ad data is rewritten.


## Opus copywriting revision
New Script Studio generations and breakdown refreshes use server-selected `claude-opus-5-5` at high effort. Browser model, sampling and token settings cannot downgrade this route. See Anthropic's [model reference](https://platform.claude.com/docs/en/models/opus-5-5/overview) and [migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

Generation now has two calls: draft, then an explicit editorial rewrite using the original brief and product evidence. Both use Opus 5.5; final labels and shots refer to the rewritten spoken copy. The editor treats the draft as unverified and addresses buying relevance, spoken rhythm, unnecessary specs, unsupported claims, hook/body continuity and credible proof. Examples calibrate the distinction between a supported product benefit and a sweeping comparison. No model fallback or automatic provider retry is used.

Each call has a server-owned 16,000-token total budget to accommodate adaptive thinking and structured output. Studio provider calls allow 180 seconds each within a shared 240-second deadline; the function allows 300 seconds. Other metered callers retain their 55-second timeout. Both calls are usage-metered under the same generation work lease. Expect higher latency and usage than one Sonnet call. The response contains only the final copy, never reasoning blocks or a rejected first draft.

Existing saved scripts are unchanged. Regenerate to use the upgraded writer. This is a copywriting workflow improvement, not evidence of better ad performance; evaluate market outcomes using linked ads.
