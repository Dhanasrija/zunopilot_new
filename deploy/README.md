# Deployment

Three apps on one EC2 box behind nginx:

| | | |
|---|---|---|
| `zunopilot.com`, `www` | customer SPA | static, plus a same-origin `/api` proxy to :4000 |
| `ops.zunopilot.com` | operator console | static, plus `/sa` → :4001 |
| `api.zunopilot.com` | API | :4000 — Meta's webhook, Razorpay's, `/media` |

**`x.zunopilot.com` and `xapi.zunopilot.com` are not part of this.** They are the separate
`zunopilot-dev` nginx site proxying an SSH reverse tunnel from a developer laptop, on their
own certbot lineage. Nothing here reads or writes that file or that lineage. Re-check both
after every nginx or certbot change:

```bash
curl -I https://x.zunopilot.com && curl -I https://xapi.zunopilot.com
```

## What is here

| Path | |
|---|---|
| `../bitbucket-pipelines.yml` | build + test on push to `main`; **deploy is a manual click** |
| `deploy.sh` | runs in the deploy step; drives the box over SSH |
| `nginx/app`, `nginx/ops` | the two site files, applied by hand |
| `sql/pre-migrate.sql`, `sql/post-migrate.sql` | the `appdb` → RDS remediation and assertions |
| `../backend/ecosystem.config.cjs` | the two pm2 processes |

## Why builds happen in CI

`vite build` peaks near a gigabyte. Even on a 2 GB box that competes with the live API, so
both SPAs are built in Pipelines and shipped as artifacts. The backend has no build step (it
runs TypeScript through `tsx`), so it ships source plus a prebuilt runtime `node_modules`,
content-addressed by `sha256(package-lock.json + schema.prisma)` — a deploy that changes no
dependency skips a ~65 MB upload.

Those trees live at `shared/deps/<hash>/node_modules/`, and the trailing `node_modules`
component is **required**. Node resolves `require` by walking up from a file's *real* path
looking for a directory of exactly that name, and the release's `node_modules` symlink is
followed to its target before the walk begins. Flatten the wrapper away and the prisma CLI
cannot find `@prisma/engines` even though the package is sitting next to it.

## One-time server setup

```bash
sudo mkdir -p /srv/zunopilot/{shared/deps,backend/releases,frontend/releases,ops/releases}
sudo mkdir -p /var/lib/zunopilot/media /var/log/zunopilot /var/www/certbot
sudo chown -R ubuntu:ubuntu /srv/zunopilot /var/lib/zunopilot /var/log/zunopilot
```

**The RDS certificate authority.** Required, not optional:

```bash
sudo mkdir -p /etc/ssl/rds
sudo curl -fsS -o /etc/ssl/rds/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

Prisma verifies RDS on its own, but pg-boss goes through node-postgres, which now treats
`sslmode=require` as *verify the chain*. Without this bundle the conversation-engine workers
die at boot with `self-signed certificate in certificate chain` — while `/health` stays green,
because the API and the queue use different drivers. Every inbound WhatsApp message would
queue and never be processed, with nothing failing loudly.

`NODE_EXTRA_CA_CERTS` in `ecosystem.config.cjs` is what loads it. Putting it in `.env` does
not work: Node reads that variable at startup, long before dotenv runs. Passing `sslrootcert`
in the connection string does not work either — pg-boss builds its own pool options and drops
it. Adding the CA is the fix; disabling verification is not.

**Secrets never enter Bitbucket.** Copy `backend/.env.prod` by hand, once:

```bash
scp -i <key>.pem backend/.env.prod ubuntu@<host>:/srv/zunopilot/shared/.env
ssh … 'chmod 600 /srv/zunopilot/shared/.env'
```

Quote `DATABASE_URL` in that file — it contains unquoted `&`, which truncates any script that
`source`s it. (systemd's `EnvironmentFile` and `dotenv` are both fine; a shell is not.)

pm2, as `ubuntu` rather than root, so deploys need no sudo:

```bash
sudo pm2 delete server; sudo pm2 save; sudo systemctl disable --now pm2-root
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu   # run what it prints
cd /srv/zunopilot/backend/current && pm2 start ecosystem.config.cjs && pm2 save
```

Log rotation via **system** logrotate, not `pm2-logrotate` (which is itself a ~40 MB Node
process). `copytruncate`, because pm2 keeps the fd open:

```
/var/log/zunopilot/*.log {
    daily rotate 7 compress delaycompress missingok notifempty copytruncate su ubuntu ubuntu
}
```

## Bitbucket setup

- **Repository settings → SSH keys → Generate.** Put the public key in the box's
  `~ubuntu/.ssh/authorized_keys`, then **Known hosts → Fetch** to pin the fingerprint.
  `deploy.sh` uses `StrictHostKeyChecking=yes` on purpose — a changed host key should stop the
  deploy, not be trusted silently.
- **Deployment variables** (environment `production`): `DEPLOY_HOST`, `DEPLOY_USER=ubuntu`.
  Optionally `DEPLOY_ONLY=zunopilot-sa` for the canary — see below. Remove it before the
  cutover, or the API will never be deployed.
- **Never define a variable named `VITE_API_BASE_URL`.** Vite reads `VITE_*` from the
  environment, so it would be baked into the bundle and silently undo the same-origin
  decision — adding a CORS preflight to every authenticated request. The frontend step fails
  loudly if it is set.
- ~15 minutes per push to `main`. The free tier's 50 min/month buys three runs.

## Routine deploy

Push to `main` → build and tests run → click **Run** on the deploy step. `deploy.sh` migrates
before swapping the symlink (additive migrations mean old code tolerates a newer schema; the
reverse does not hold), swaps atomically with `mv -Tf`, then polls `/health` on both ports and
**reverts the symlink if either fails**.

Expect **10–20 seconds of 502**. One replica, fork mode, and `tsx` transpiling at boot mean
there is no zero-downtime story — deploy off-peak rather than pretend otherwise.

## First cutover (once)

Full ordering, rollback points and the maintenance-window script are in the approved plan at
`~/.claude/plans/mighty-splashing-reddy.md`. The short version:

1. Preflight and **the first backups this system has ever had** — `pg_dump appdb`, tar
   `/etc/nginx`, `/etc/letsencrypt`, `~root/.pm2/dump.pm2`. Download them.
2. `ops.zunopilot.com` TLS (`nginx/ops`, two-phase). Re-check the tunnel.
3. **Canary: deploy the superadmin process only** — set `DEPLOY_ONLY=zunopilot-sa` and run the
   deploy step. Port 4001 is free, so this cannot touch the live API, and it proves
   tsx-under-pm2 signal handling, the shared `.env`, RDS reachability, the `/sa` proxy and the
   whole deploy script, for free.

   **Do not run a full deploy before the cutover.** Port 4000 belongs to the old root pm2
   `server` until then, so `zunopilot-api` can only `EADDRINUSE`. The health gate polls
   `/health` *and* asks pm2 whether the processes it started are `online`, precisely because
   curl alone cannot tell which process answered — the old one returns 200 on 4000 and would
   have made a crash-looping deploy look green.
4. Rehearse the `appdb` → RDS restore into a scratch RDS database. `pg_restore -e`
   (**`--exit-on-error`** — without it a partial restore exits 0 and you go live on a database
   quietly missing rows).
5. Maintenance window: `touch /srv/zunopilot/shared/MAINTENANCE` (503, **not** 200 — Meta
   retries 5xx for days but treats 200 as delivered), stop the old API, final dump, restore,
   migrate, run `sql/post-migrate.sql`, **take an RDS snapshot**, seed, start, swap nginx,
   remove the flag.

**The point of no return is the nginx swap.** Before it, rollback is `rm MAINTENANCE` +
`pm2 start server`, with no data loss — the old process still points at local `appdb`. Leave
local Postgres running and untouched for 48 hours afterwards.

Every `pg_dump` taken here contains **plaintext Meta access tokens** —
`WhatsappAccount.accessToken` is unencrypted despite the schema comment saying otherwise.
`chmod 600`, keep them off shared storage, delete them when the window closes.

## Known, deferred

- **Uploads buffer in memory, which is what keeps the ceiling at 16 MB.**

  This entry used to say media uploads were not in use, so the mismatch between a 16m nginx
  cap and a 100 MB document limit was latent. **They are in use now** — an agent can attach a
  file in the Inbox — and it was not latent: a video 413'd at the edge, with nginx's own error
  page and no message the client could read.

  The two now agree. nginx allows 20m and the app allows 16 MB per file, deliberately not
  equal: nginx weighs the whole multipart request while the app weighs the file, so equal
  numbers meant a video at exactly Meta's 16 MB limit was refused before any code could say
  why. The document ceiling came down from 100 MB to 16 MB for the same reason — it was a
  promise the edge could never keep.

  Raising either needs the upload to stream rather than buffer. `multer.memoryStorage()` plus
  `storeUpload` writing `input.buffer` means a 100 MB document is 100 MB+ of heap in the
  process that also runs the pg-boss workers, and killing it takes the job queue with it. The
  seam is `putObject` in `backend/src/modules/media/storage.ts`.

  Bytes live in S3 now, not on disk, which is why there is still **no disk alarm**: `MEDIA_DIR`
  was the only unbounded consumer on the box and it is unused in production. Deploy artifacts
  are pruned to 3 releases and 2 dependency trees (~400 MB, steady), and logs are rotated.
- **No backups exist yet.** Set RDS retention ≥ 7 days, confirm PITR, and the acceptance test
  is a **restore**, not a snapshot.
- `/home/ubuntu/zuno-pilot-server` (the pre-TypeScript deploy) is archived, not deleted, until
  the new stack has run a week.
