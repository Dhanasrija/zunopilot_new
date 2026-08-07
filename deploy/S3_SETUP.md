# S3 for customer media

Inbound WhatsApp media — the photos, videos and documents customers send — is stored in S3
rather than on the server's disk. This is the AWS side of that, which has to be done by hand
because it needs console access.

## What to create

**One private bucket**, in `ap-south-1` — the same region as the EC2 instance, so transfers
stay inside the region and cost nothing.

```
Name        zunopilot-media          (or anything; the app reads it from S3_BUCKET)
Region      ap-south-1
Public access   Block all public access — leave every box ticked
Versioning      off is fine
Encryption      SSE-S3 (the default) is enough
```

**The bucket must stay private.** It holds photographs customers have sent a business —
a damaged delivery, an ID document, a prescription. Objects are read through short-lived
presigned URLs generated per request, so nothing is reachable without going through the API and
its permission checks. A public bucket with UUID keys is not "private enough": a key that leaks
once, in a browser history or a support email, is public forever.

Keys are laid out per workspace:

```
tenants/<tenantId>/inbound/2026/08/<uuid>.jpg
tenants/<tenantId>/upload/2026/08/<uuid>.pdf
```

so a workspace's media can be listed, counted or deleted with one prefix — which is what makes
"delete everything belonging to this customer" a possible request to answer later.

## How the app authenticates

**Attach an IAM role to the EC2 instance.** There is none today — I checked. This is worth
doing properly rather than putting access keys in `.env`: a role issues short-lived credentials
that rotate themselves, there is nothing to leak in a file, and nothing to remember to rotate.

1. IAM → Roles → Create role → AWS service → EC2
2. Attach a policy with only what the app needs (below)
3. EC2 → the instance → Actions → Security → Modify IAM role → attach it

The policy — deliberately not `s3:*`, and scoped to the one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectsInThisBucketOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::zunopilot-media/*"
    }
  ]
}
```

No `s3:ListBucket`: the app addresses objects by key and never enumerates, so granting it would
widen the blast radius of a mistake for no benefit.

If a role is genuinely not an option, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in
`/srv/zunopilot/shared/.env` also work — the SDK's default credential chain finds either, and
the application code is identical. The role is better.

## Environment

In `/srv/zunopilot/shared/.env`:

```
S3_BUCKET=zunopilot-media
AWS_REGION=ap-south-1
```

**`S3_BUCKET` is required in production.** Falling back to local disk when it is unset is
exactly the failure this codebase has had five times: an absent variable reading as a working
configuration, and nobody noticing until the disk fills or a deploy replaces the release
directory and the files are gone.

Without it, the API **starts, logs the problem as an error, and refuses every media
operation with a 503** naming the variable. Uploads, sending a file from the Inbox, campaign
header media and storing an inbound photograph all fail; messaging, billing, workflows and the
console are untouched.

It used to `process.exit(1)` instead. That cost an outage on 2026-08-07: the variable was
missing on a deploy, the API crash-looped, the health gate failed after 80 seconds and the
release rolled back — the whole product down over a file-storage setting. The data is still
protected either way, because `storage.ts` refuses rather than writing somewhere temporary;
what changed is that the refusal is scoped to the thing that is broken.

Locally, with `S3_BUCKET` unset, media goes to `MEDIA_DIR` on disk as before — so nothing needs
AWS to run the app.

## Checking it works

After attaching the role and restarting the API:

```bash
pm2 restart zunopilot-api
curl -s https://api.zunopilot.com/health
```

Then send a photo to the business number and open the conversation in the Inbox. The image
should render. If it does not, `/var/log/zunopilot/api.out.log` will carry the reason —
`AccessDenied` means the policy or the role, `NoSuchBucket` means the name or the region.

## Worth knowing

**Meta's media ids expire.** The file is fetched from the Graph API the moment the webhook
arrives, not lazily when somebody opens the Inbox. Any photo sent before this ships was never
downloaded and is already unrecoverable.

**Campaign header media** uses the same store. Meta fetches that file from us when a template
is sent, so its URL is presigned at send time with a window long enough for Meta to collect it.
