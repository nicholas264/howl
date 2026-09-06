# Static Studio

Static Studio adds a photographic creative-production workflow to the existing HOWL ad engine. Open **Creative → Static Studio** or `?tab=static-studio`.

The user story is: Drive folder (including subfolders) → original asset library → product confirmation → art direction → separate feed/story compositions → production checks → visual critique and bounded revision → human approval → existing launcher.

## What ships

- Original JPEG, PNG and WebP uploads, plus authenticated Drive browsing, paginated subfolders, selected import, and folder-tree import. Source files are never resized or recompressed for storage. The importer verifies byte count, raster signature and Drive MD5 checksum before storage, rejecting changed or truncated downloads. A separate JPEG preview is used for visual analysis.
- An explicit product identity and advertising-suitability confirmation for each source. R1, R3 and R4 MKii remain separate. Reference ads cannot become product-photo sources.
- A reference library with visual analysis and art-direction notes.
- Immersive In the moment layouts with a confirmed protected product region, plus four framed compositions: headline-first Expedition, photograph-first Field study, split-column Signal fire, and verified-feature Anatomy.
- Original AI copy with a separate premise, visual idea and verified-fact citations. Numerical, offer, regulatory and common absolute claims are rejected before rendering. Semantic claim accuracy still requires independent review. Legacy copy remains available only in explicitly labeled manual layout samples.
- An AI art director that develops original, asset-led premises and copy, selects approved sources and composition, and explains its choices. It receives previous concepts; validation rejects identical and closely overlapping headlines/premises. This heuristic is not a substitute for a human originality assessment. Incomplete or invalid AI batches fail explicitly instead of silently becoming house concepts. Each selected product gets a visual sample before extra photographs fill the nine-image budget. A clearly labeled house-layout mode works without an AI call; it does not pretend to interpret a creative brief.
- 1080×1350 feed and 1080×1920 story canvases composed independently. The previews are the actual exported PNGs. Contact-sheet cards explicitly label unrendered drafts.
- Quality checks for identity, source fingerprint, proportional full-photo rendering, text fit, minimum text sizes, photo/text separation, source resolution, locator approval and conservative safe margins.
- Independent visual critique of both rendered placements. **Render, review & refine** makes at most one revision per concept and then reviews again. Failed or weak work remains unapproved. Completed items survive interruption.
- Optimistically versioned PostgreSQL persistence, autosave, explicit save, conflicts surfaced rather than overwritten, recovery JSON download and reload controls.
- Paired launcher handoff retaining product ID, source provenance, design, approval snapshot and copy. No Meta publication happens in Static Studio.
- ZIP export with both PNGs and an editable design/source manifest for each concept.

## Product fidelity boundary

The renderer downloads the original and verifies its SHA-256 against the imported asset before drawing. Framed layouts draw the complete photo. Immersive layouts fill the canvas with one proportional draw of unchanged original pixels and may clip only surroundings outside an explicitly confirmed protected region. Cropping any part of that region, overlapping it with type, inadequate sampled text contrast, source upscaling and product intrusion into placement UI margins block export. No mirroring, rotation, generative editing, color adjustment or stretching is used. The original source remains available for review. Normal image resampling happens when drawing at export size.

In framed layouts, the only annotation over a source photo is the locator dot and leader for an explicitly reviewed feature anchor. Immersive layouts allow typography in real negative space outside the protected region; no darkening gradient is applied to the source. Product identity and feature anchors are human-confirmed once per photograph. The source filename or an AI suggestion is never enough to approve identity.

Any editable design change, source fingerprint change, product assignment, approval state or anchor change invalidates the render/review/approval snapshot. Changes to studio concepts do not modify already-sent launcher drafts.

The legacy callout batch path also now fails closed: a failed vision request cannot reuse another image's callout positions; features omitted by vision are omitted rather than guessed.

## Runtime integration

This extends the established React/Vite, Vercel functions, Neon, Blob and Anthropic stack; it introduces no new hosted framework or dependency.

Existing server configuration used:

- `DATABASE_URL`: studio records and existing access/work limits.
- `BLOB_READ_WRITE_TOKEN`: originals, analysis previews and finished PNGs.
- `ANTHROPIC_API_KEY`: existing `claude-sonnet-4-6` integration for art direction, analysis and critique.
- Existing Clerk/workspace access configuration: every studio API operation requires `assets.write`.
- `GCP_WIF_AUDIENCE`, `GCP_SERVICE_ACCOUNT_EMAIL` and Vercel OIDC: existing Drive connection, requesting `drive.readonly` for intake. Share the supplied folders with that connection.

`static_studios` is created idempotently on first access. Studio work is private to the authenticated user; launcher drafts follow the engine's existing shared-workspace semantics. Schema reads and writes are tested against isolated PostgreSQL. No existing data migrations are rewritten.

The studio function has a 300-second Vercel duration. Provider calls retain the existing paid-work limits and metered fetch wrapper. Individual steps are saved; browser batch orchestration can be stopped between items. Rendering does **not** continue after closing the browser. Reopen and resume unfinished work from the contact sheet.

Limits: 240 assets, 120 concepts, up to five concepts per selected product per generation, 30 MB/80 megapixels per original, 60 folders per folder-tree import. AI visual inputs are capped at nine product photos and two references plus descriptions. Analysis of very large legacy originals without a preview asks for a smaller analysis reference; it does not replace the rendering original.

## Verification

Run:

```sh
npm run check
```

The static studio tests cover product separation, model-output constraints, unapproved/reference sources, anchor validation, source geometry, Drive byte preservation and failures, balanced visual sampling, complete AI-plan validation, approval invalidation, capacity bounds, external URL validation, user isolation, stale revisions and repair constraints.

The browser smoke test uses the actual studio, renderer, database handlers, PostgreSQL and launcher. It explicitly replaces external provider boundaries with local fixtures so it cannot create live ads or transmit images to providers.

```sh
STUDIO_QA_RUNTIME=/path/to/bundled/node_modules \
STUDIO_QA_ASSETS=/path/to/test-originals \
node scripts/verify-static-studio.mjs
```

The runtime needs `playwright` and `sharp`. The asset directory needs real original files named `r1.jpg`, `r3.jpg`, `r4mkii.jpg` (the verifier inspects their bytes). Chrome defaults to the local macOS installation; set `STUDIO_QA_CHROME` to another installed executable.

The smoke test verifies all four directions × three products × two ratios, the full import-to-launcher flow, persistence through reload, approval invalidation after editing, a fixture-driven critique/repair/review loop, R3 copy and destination despite the launcher's R1 default, mobile overflow, and browser exceptions. It writes screenshots, a render matrix and a verification report into the asset directory.

## Acceptance before scaling

Functional correctness is not proof of designer-level creative quality. Calibrate with the user's actual Drive assets and a curated set of their best finished ads. Run a blinded designer comparison with identical assets and briefs; measure product/claim errors, required corrections, correction time and preference. Keep human approval until the evidence supports changing that workflow.

Live provider and Drive authorization must be verified in the intended environment. The renderer bench and fixture tests are not evidence of designer-level creative quality.

Personal Drive connection uses the existing Google OAuth flow with a Static Studio purpose requesting drive.readonly and account identity. Existing grants are preserved. The server prefers a personal connection with the required scope; a failed refresh does not silently switch to the shared service account.
