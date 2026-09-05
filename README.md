# HOWL Ad Engine

React/Vite frontend with Vercel API functions, Clerk workspace access, Neon
PostgreSQL, Meta, Shopify, Google, Vercel Blob, and Remotion Lambda integrations.

## Development and verification

Use Node 22. Install with `npm ci`, copy `.env.example` to `.env.local`, and add
development credentials. Never use production credentials for automated tests.
Run `npm run dev` for the Vite API adapter or `npm run dev:vercel` for the Vercel
runtime. The local adapter loads server environment variables and supports the
redirect responses used by OAuth. Authentication bypass is development-only.

Run `npm run check` before release: backend syntax, isolated PostgreSQL regression
tests, and the production frontend build. `npm test` uses in-memory PGlite and
mocked providers, with no production records or messages. The separate
`verify:ugc-infra` script writes and deletes real remote data; only use it against
an explicitly selected test environment.

## Releases

1. Run `npm ci`, `npm run check`, and `npm audit`.
2. Select the intended database explicitly with `DATABASE_URL` and run
   `npm run db:migrate` before deploying application code. Existing databases
   receive additive changes. Serialize migration runs in the release process.
3. When updating Remotion, deploy a matching Lambda function and a new versioned
   site, verify a synthetic render, and update both Vercel render variables.
   Retain the old site/function for rollback and in-flight render completion.
4. Deploy to Vercel, verify public-page loading and unauthorized API rejection,
   then exercise authenticated workflows with test assets.

The legacy `/api/shopify-install` and `/api/shopify-callback` credential-display
endpoints are intentionally retired (HTTP 410). Existing Shopify integrations
use server-configured credentials through `api/_lib/shopify-content.js`.
Never restore a public token exchange/display endpoint.

Meta and email operations record external steps before execution. A duplicate
request replays recorded provider results; uncertain outcomes are held for
operator review in Admin rather than automatically sent again. A caller that
intentionally repeats an identical action must use a new `Idempotency-Key` or
`request_key`; retries must preserve that key. Full automated reconciliation is
still on the remediation backlog.

See `docs/audits/2026-09-05-remediation.md` for release coverage and remaining work.
