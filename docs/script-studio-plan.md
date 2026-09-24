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

No new database schema. Campaign planning remains a separate portfolio workflow using the existing shared method. Local saved drafts remain clearly labeled as browser-local.
