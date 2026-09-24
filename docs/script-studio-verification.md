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

Temporary browser fixtures and private model response files are excluded from the release. No schema migration is required. Signed-in production UI verification depends on an available user session; production deployment and HTTP checks are recorded at release time.
