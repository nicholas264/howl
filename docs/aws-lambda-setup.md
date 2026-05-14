# AWS + Remotion Lambda Setup — howl-ad-engine

This is a brief for a separate Claude Code session ("co-work") that will wire Remotion Lambda into howl-ad-engine. The main session has already shipped direct-to-Blob uploads, server-side audio extraction, Whisper transcription, and persistent UGC sessions. This is the missing piece: server-side video rendering of cuts + animated captions + brand intro/outro at multi-GB scale.

## How to use this brief

Some steps require Nicholas (browser-based AWS console actions, credit card, MFA on a phone). Co-work cannot do those. Everything else is fully autonomous.

### Nicholas — do these first, by hand

1. **Create the AWS account.** Go to https://signup.aws.amazon.com/ and sign up. Account email: a HOWL inbox if you have one, else `nicholas@howlcampfires.com`. Account name: `howl-prod`. Add a credit card. Verify phone.
2. **Enable MFA on the root account immediately** (Authy / 1Password / hardware key — your call).
3. **Set a billing alert at $50/mo.** Console → Billing → Budgets → Create budget.
4. **Create an IAM user `howl-ci` with programmatic access.** Console → IAM → Users → Create user → name `howl-ci` → check "Provide user access to the AWS Management Console" off → Next → attach policy "AdministratorAccess" *temporarily* (co-work will tighten this down) → create. On the success screen, **download the .csv with the access key + secret**. Save it to 1Password / Bitwarden under "HOWL AWS — howl-ci access keys."
5. **Paste the keys into the co-work Claude session as a single message** like:

   ```
   AWS keys for the Remotion setup:
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=us-east-1
   ```

   Co-work will write them to a local `.env.aws` (gitignored) so subsequent `npx remotion lambda` commands pick them up.

That's it for manual steps. Hand the rest off.

### Co-work — start here

Read the rest of this doc and execute steps 3 through 9. Skip step 1 (Nicholas did it) and step 2 (Nicholas chose `us-east-1`).

## What you're delivering

By the end of this session, the howl-ad-engine app should be able to:

1. Take a Blob URL pointing at a multi-GB UGC source video plus a JSON job spec (`{ segments, words, intro, outro, showCaptions }`)
2. Trigger a Remotion Lambda render of the existing `UgcVideo` composition (see `src/remotion/UgcVideo.jsx`)
3. Poll for render status from the browser
4. Receive a Blob URL of the finished mp4 and store it on the corresponding `ugc_sessions` row

## Repo context

- Working dir: `/Users/nicholaskirchner/howl-ad-engine`
- Hosting: Vercel project `howl` under team `nicholas-7844s-projects`. Live alias: `howl-teal.vercel.app`
- Auth: Clerk (server routes use `requireAuth` from `api/_lib/auth.js`)
- DB: Neon Postgres, schema in `api/db/schema.js`. Session rows live in `ugc_sessions`
- Storage: Vercel Blob (`@vercel/blob`). Source videos already land here on upload
- Remotion comps already exist: `src/remotion/{UgcVideo,AnimatedCaptions,BrandCards}.jsx`. They render correctly in `<Player>` preview today
- The render path was previously stubbed in `UgcEditorTool.jsx` with a comment that said `Remotion render-to-mp4 ships once Lambda is wired`

## What Nicholas wants you to do

### 1. AWS account provisioning

Create a fresh AWS account scoped to HOWL. Treat this as production-grade.

- Account email: ask Nicholas which email to use (default: `nicholas@howlcampfires.com` or a HOWL-shared inbox if one exists). Confirm before creating.
- Account name: `howl-prod`
- Enable MFA on the root account immediately
- Set up a billing alert at $50/mo as a tripwire
- Create a non-root IAM user `howl-ci` with programmatic access for Remotion to use. Do NOT use root credentials in env vars.

The Remotion-required permissions are documented at https://www.remotion.dev/docs/lambda/setup — fetch that page and follow the IAM policy they publish (`remotion-user-policy.json`). They also require an execution role policy for the Lambda itself.

### 2. Region choice

Use `us-east-1`. It is the cheapest, most feature-complete Lambda region, and matches the `iad1` Vercel build region the project already uses, so cold-start round-trip is minimal.

### 3. Install Remotion Lambda

From the repo root:

```bash
cd /Users/nicholaskirchner/howl-ad-engine
npm install @remotion/lambda
```

Then follow https://www.remotion.dev/docs/lambda/setup step-by-step. The key commands are:

```bash
npx remotion lambda policies role
npx remotion lambda policies user
npx remotion lambda functions deploy
npx remotion lambda sites create src/remotion/index.ts --site-name=howl-ugc
```

You will need to create `src/remotion/index.ts` (or `.tsx`) that registers the `UgcVideo` composition. Use Remotion's `registerRoot` pattern. The composition is defined in `src/remotion/UgcVideo.jsx` and exports `UgcVideo` plus `calcDurationInFrames`. Frame rate is 30fps. Dimensions are 1080×1920.

### 4. Server route — kick off a render

Create `api/render-ugc.js`:

- POST handler, Clerk-auth'd via `requireAuth`
- Body: `{ sessionId }`. Look up the session row in Neon
- Use `@remotion/lambda/client`'s `renderMediaOnLambda` with:
  - `serveUrl`: the site URL from `lambda sites create`
  - `composition`: `UgcVideo`
  - `inputProps`: built from the saved session (videoSrc = blob URL, segments, words, settings)
  - `codec`: `h264`
  - `outName`: `{ key: \`renders/\${sessionId}-\${Date.now()}.mp4\`, bucketName: <remotion bucket> }`
- Save the returned `renderId` and `bucketName` to the session row (add columns `render_id`, `render_bucket`, `render_status`, `render_url`)
- Return `{ renderId }` to the client

Create `api/render-ugc-status.js`:

- GET handler, Clerk-auth'd
- Query: `?sessionId=...`
- Use `getRenderProgress` from `@remotion/lambda/client`
- When `done`, copy the rendered mp4 from S3 to Vercel Blob (so it lives next to the source video and we don't pay double egress) and update the `ugc_sessions` row with `render_url` + `render_status='done'`
- Return `{ progress, status, renderUrl? }`

### 5. Schema migration

Add to `api/db/schema.js`:

```js
await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS render_id TEXT`;
await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS render_bucket TEXT`;
await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS render_status TEXT`;
await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS render_url TEXT`;
```

Then hit the `/api/db/schema` endpoint once after deploy to apply.

### 6. Wire the UI

In `src/components/UgcEditorTool.jsx` there is currently a `render()` function that uses `renderCuts` from `ffmpegClient.js`. Replace that with:

- POST `/api/render-ugc` with `{ sessionId }`
- Poll `/api/render-ugc-status` every 3s
- Show progress bar (Remotion returns 0-1)
- On done, set `outputUrl` to the returned blob URL (existing download / send-to-cart code already handles it)

Keep the in-browser ffmpeg.wasm path as a fallback for files under 200MB (toggle via a checkbox: "Render in browser" — useful for quick iteration). Default behavior = Lambda.

### 7. Vercel env vars to set

After Remotion deploys cleanly, add these to the howl Vercel project (production at minimum):

```
REMOTION_AWS_ACCESS_KEY_ID
REMOTION_AWS_SECRET_ACCESS_KEY
REMOTION_AWS_REGION=us-east-1
REMOTION_LAMBDA_FUNCTION_NAME=<from `lambda functions deploy`>
REMOTION_LAMBDA_SERVE_URL=<from `lambda sites create`>
```

Use `vercel env add NAME production --value '<value>' --yes` so you don't get caught by the interactive prompt.

### 8. Smoke test

- Upload a small (50MB) video through the UGC Editor UI on `howl-teal.vercel.app`
- Cut a few words, enable captions + intro + outro
- Trigger render
- Verify the output mp4 plays correctly with intro, captions burned in, outro CTA
- Then test with a 1GB+ raw clip to confirm Lambda handles it

### 9. Cost guardrails

Add to `api/render-ugc.js`:
- Reject sessions whose source duration > 30 minutes (just `return 400` for now — Nicholas can lift the cap later)
- Log the render duration and estimated cost to console for the first ~10 renders so we have data

## What to NOT do

- Don't switch transcription to Deepgram or AssemblyAI — Whisper is intentionally the choice for now
- Don't refactor the existing UGC Editor UI beyond the render-button rewire
- Don't touch the Callout Ads tool
- Don't commit AWS credentials to the repo. They live only in Vercel env + a 1Password / Bitwarden entry that you'll ask Nicholas to create
- Don't bypass Clerk auth on the new routes
- Don't add a queue system. Remotion Lambda's built-in concurrency is fine for now

## Reporting back

When done, leave a short note in `docs/aws-lambda-setup.md` (this file) under a `## Status` section: AWS account ID (last 4 digits only), Remotion site URL, Lambda function name, and any gotchas hit. Then mark the task complete in the original session by replying to Nicholas with the smoke-test result.

## If something blocks you

- AWS account creation requires a credit card — stop and ask Nicholas for the card (or the billing email if a corp card is already attached)
- IAM policy errors during `lambda policies user` — the Remotion docs sometimes lag the policy schema. Fall back to attaching `AdministratorAccess` to `howl-ci` *temporarily* to unblock smoke tests, then tighten down with a least-privilege policy in a follow-up
- Region quotas — `us-east-1` Lambda concurrent execution default is 1000, more than enough. If you hit a quota wall, check Service Quotas in the AWS console
