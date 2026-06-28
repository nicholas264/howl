# Remotion Lambda setup for HOWL UGC renders

This is the one-time setup needed before the UGC Editor's "Render polished ad" button can render the Remotion composition in AWS Lambda.

## What Codex already wired

- Remotion composition entrypoint: `src/remotion/index.jsx`
- Composition ID: `UgcAd`
- Lambda start API: `/api/render-ugc-remotion`
- Lambda status API: `/api/render-ugc-remotion-status`
- UGC Editor button: `Render polished ad`

Until the environment variables below exist, the button returns a setup-needed message instead of starting a render.

## AWS values we need

Choose one AWS region and keep it consistent. Use `us-east-1` unless there is a reason not to.

Vercel environment variables needed:

```txt
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
REMOTION_AWS_REGION=us-east-1
REMOTION_LAMBDA_FUNCTION_NAME=
REMOTION_LAMBDA_SERVE_URL=
```

## 1. Install policies in AWS

Run these locally from the repo and copy the JSON into AWS IAM when prompted:

```bash
npm run remotion:policy:role
npm run remotion:policy:user
```

In AWS IAM:

1. Create a policy named exactly `remotion-lambda-policy` using the role policy JSON.
2. Create a role named exactly `remotion-lambda-role`.
3. Use Lambda as the trusted service for the role.
4. Attach `remotion-lambda-policy` to that role.
5. Create an IAM user for Remotion, for example `remotion-user`.
6. Add an inline policy to that user using the user policy JSON.
7. Create an access key for that user.

## 2. Validate permissions

After adding the AWS keys to your local shell or env file:

```bash
npm run remotion:policy:validate
```

## 3. Deploy the Lambda function

```bash
npm run remotion:lambda:deploy -- --region=us-east-1
```

Copy the printed function name into Vercel as:

```txt
REMOTION_LAMBDA_FUNCTION_NAME=...
```

## 4. Deploy the Remotion site

```bash
npm run remotion:site:deploy -- --region=us-east-1
```

Copy the printed serve URL into Vercel as:

```txt
REMOTION_LAMBDA_SERVE_URL=...
```

## 5. Add variables to Vercel

Add the variables to Production and Preview, then redeploy:

```bash
vercel env add AWS_ACCESS_KEY_ID production
vercel env add AWS_SECRET_ACCESS_KEY production
vercel env add REMOTION_AWS_REGION production
vercel env add REMOTION_LAMBDA_FUNCTION_NAME production
vercel env add REMOTION_LAMBDA_SERVE_URL production
vercel --prod --yes
```

## 6. Test in HOWL

1. Open UGC Editor.
2. Upload a short test clip.
3. Transcribe or Auto edit it.
4. Click `Render polished ad`.
5. Wait for the Lambda render progress message.
6. The finished S3 output URL should appear as the rendered asset.

## Notes

- Remotion Lambda uses AWS Lambda plus S3. The Lambda function renders chunks of the video and stitches them into a final S3 output.
- The Remotion package versions in this repo are pinned to `4.0.457` because Lambda functions are tied to Remotion versions.
- When Remotion code changes, redeploy the Remotion site with `npm run remotion:site:deploy -- --region=us-east-1`.
- When Remotion package versions change, redeploy the Lambda function too.
