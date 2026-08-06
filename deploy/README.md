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

## One-time server setup

```bash
sudo mkdir -p /srv/zunopilot/{shared/node_modules,backend/releases,frontend/releases,ops/releases}
sudo mkdir -p /var/lib/zunopilot/media /var/log/zunopilot /var/www/certbot
sudo chown -R ubuntu:ubuntu /srv/zunopilot /var/lib/zunopilot /var/log/zunopilot
```

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
3. **Canary: deploy the superadmin process only.** Port 4001 is free, so this cannot touch the
   live API — and it proves tsx-under-pm2 signal handling, the shared `.env`, RDS
   reachability, the `/sa` proxy and the whole deploy script, for free.
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

- **`client_max_body_size` is 16m, not the 100m the API allows.** `multer.memoryStorage()`
  plus a 100 MB document ceiling means one upload is 100 MB+ of heap in the process that also
  runs the pg-boss workers. Raise it only after uploads stream to disk.
- **No backups exist yet.** Set RDS retention ≥ 7 days, confirm PITR, and the acceptance test
  is a **restore**, not a snapshot.
- `/home/ubuntu/zuno-pilot-server` (the pre-TypeScript deploy) is archived, not deleted, until
  the new stack has run a week.
