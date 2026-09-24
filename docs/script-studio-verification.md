# Script Studio verification

Story: choose a product and starting point in one studio, generate a speaker-appropriate script through the shared HOWL method, edit it, and keep or hand off the result.

## Evidence

- Full app regression suite: 219 tests passed; API syntax and production Vite build passed.
- Isolated database tests exercise the real generation handler for founder, creator and voiceover; all products and starting points; real creator lookup; malformed response handling; brand-rule rejection; creator brief persistence and Creative Board creation.
- Browser fixture checks: R3 selection and rendering; spoken-copy edits; local save and reload; winner selection with creator delivery; creator-save success; failed generation preserves prior output; creator preselection; unified app navigation.
- Desktop and narrow screenshots reviewed. At a 571px viewport, document width was 565px with no horizontal overflow.
- Real Anthropic requests for R1 founder and R3 voiceover returned the structured script, three complete alternate hooks and 6–7 shots. These are functional checks; generated claims still require editorial review.
- A malformed hook response found in live testing led to server-controlled structured output, with named first/second/third openings normalized to the UI array. See the [provider structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). No browser-supplied output schema is accepted.
- Dependency audit: zero vulnerabilities.

Temporary browser fixtures and private model response files are excluded from the release. The initial release required no schema migration. Signed-in production UI verification depends on an available user session; production deployment and HTTP checks are recorded at release time.


## Follow-up verification: labeled output, saves, Docs and results
- 221 isolated regression tests passed, API syntax and production build passed; dependency audit found zero vulnerabilities.
- Real R1 founder and R3 voiceover model calls returned all eight breakdown fields with exact source excerpts, three openings and valid shot lists.
- Real handlers with isolated PostgreSQL verify immutable revisions, idempotent saves, stale-breakdown rejection, ad uniqueness, weighted metrics, date windows, missing-data nulls and duplicate launch records without inflated spend.
- Google provider mocks verify native-document conversion, escaped content, returned-link validation, read-back on every export, repeated export without duplicate creation, and an uncertain upload held on retry. Production authentication rejects unauthenticated save requests.
- Browser fixtures exercise labeled display, shared save, Google Doc link, ad linking, metrics and stale-edit refresh. These are fixture-backed UI checks, not evidence that a live Google account created a document.
- Production database identity was verified and the scoped additive migration applied before deployment. Existing Google connection tables and the canonical OAuth callback were verified.
- A signed-in production browser session is unavailable. Live Google consent and document creation must therefore be exercised by a connected user; no user credentials were impersonated and no production test scripts or ads were inserted.


## Opus 5.5 revision verification
- The configured account's Models API confirms access to `claude-opus-5-5`.
- Live R1 packing, R3 warmth and R4 MKii stargazing requests exercised structured output, exact-excerpt breakdowns and editorial rewrites. Editorial review identified and tightened specification dumping, invented packing fit, blanket competitor claims and arbitrary time gains. These are original synthetic briefs, not customer testimonials or performance evidence.
- A real standalone breakdown request returned eight validated fields with Opus 5.5.
- Integration checks assert the server-selected model and high effort, ignore attempted browser downgrades, omit incompatible temperature settings, accept thinking blocks before text, return the editorial rewrite, regenerate its exact breakdown, reject truncated output and preserve provider failures without fallback.
- Full regression suite: 221 tests passed; API checks and production build passed. Dependency audit: zero vulnerabilities. Signed-in production generation remains unverified without a user session; direct live provider checks and authenticated-handler fixtures cover the model path.
