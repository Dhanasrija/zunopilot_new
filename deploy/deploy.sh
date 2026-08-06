#!/usr/bin/env bash
#
# Ship the artifacts built by bitbucket-pipelines.yml to the production box.
#
# Runs inside the manual `deploy` step and drives the server over SSH. It needs no sudo:
# everything it touches lives under /srv/zunopilot, owned by the deploy user, and pm2 runs as
# that same user. nginx and certbot stay hand-operated — keep it that way, so a compromised
# pipeline cannot rewrite the web server's config.
#
# Layout on the box:
#   /srv/zunopilot/shared/{.env, MAINTENANCE, node_modules/<hash>/}
#   /srv/zunopilot/{backend,frontend,ops}/releases/<sha>/  +  current -> releases/<sha>
#
# Required environment (Bitbucket repository variables, scoped to the production deployment):
#   DEPLOY_HOST, DEPLOY_USER
#
# The production secrets are NOT here. /srv/zunopilot/shared/.env is placed by hand, once,
# and symlinked into each release — so the Meta app secret, the Razorpay live key and
# ENCRYPTION_KEY never enter Bitbucket at all.

set -euo pipefail

HOST="${DEPLOY_HOST:?DEPLOY_HOST is not set}"
USER="${DEPLOY_USER:?DEPLOY_USER is not set}"
REL="${BITBUCKET_COMMIT:?BITBUCKET_COMMIT is not set}"
DEPS="$(cat deps.sha)"
ROOT=/srv/zunopilot

# StrictHostKeyChecking=yes, not `accept-new`: the fingerprint is pinned in Bitbucket via
# Repository settings -> SSH keys -> Known hosts. A changed host key should stop the deploy,
# not be silently trusted.
SSH=(ssh -o StrictHostKeyChecking=yes -o BatchMode=yes "${USER}@${HOST}")

# Optional: restrict pm2 to one app. Set DEPLOY_ONLY=zunopilot-sa in the Bitbucket deployment
# variables for the canary.
#
# The canary exists because port 4000 is not free until the cutover — the pre-TypeScript root
# pm2 `server` still owns it. Starting `zunopilot-api` before then can only EADDRINUSE. Port
# 4001 has never been used, so the superadmin process can be deployed against production for
# real, and it proves the parts that are genuinely unproven: tsx under pm2, signal handling,
# the shared .env, RDS reachability, the /sa proxy, and this script end to end.
#
# Static files are unaffected either way — they are swapped by symlink and nginx does not point
# at them yet.
ONLY="${DEPLOY_ONLY:-}"
case "${ONLY}" in
  '')             PM2_ONLY='';                HEALTH_PORTS='4000 4001'; HEALTH_APPS='zunopilot-api zunopilot-sa' ;;
  zunopilot-sa)   PM2_ONLY='--only zunopilot-sa';  HEALTH_PORTS='4001';      HEALTH_APPS='zunopilot-sa' ;;
  zunopilot-api)  PM2_ONLY='--only zunopilot-api'; HEALTH_PORTS='4000';      HEALTH_APPS='zunopilot-api' ;;
  *) echo "DEPLOY_ONLY must be empty, zunopilot-sa or zunopilot-api (got '${ONLY}')"; exit 1 ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "1/9  static bundles -> releases/${REL}"
for pair in "frontend:frontend/dist" "ops:superadmin/dist"; do
  app="${pair%%:*}"; src="${pair##*:}"
  "${SSH[@]}" "mkdir -p ${ROOT}/${app}/releases/${REL}"
  rsync -az --delete -e "ssh -o StrictHostKeyChecking=yes -o BatchMode=yes" \
    "${src}/" "${USER}@${HOST}:${ROOT}/${app}/releases/${REL}/"
done

say "2/9  backend source"
scp -q -o StrictHostKeyChecking=yes backend-src.tgz "${USER}@${HOST}:/tmp/src-${REL}.tgz"
"${SSH[@]}" "set -e
  mkdir -p ${ROOT}/backend/releases/${REL}
  tar -xzf /tmp/src-${REL}.tgz -C ${ROOT}/backend/releases/${REL} --strip-components=1
  rm -f /tmp/src-${REL}.tgz"

say "3/9  runtime dependencies (${DEPS})"
if "${SSH[@]}" "test -d ${ROOT}/shared/node_modules/${DEPS}"; then
  echo "    already present — skipping the upload"
else
  scp -q -o StrictHostKeyChecking=yes backend-node_modules.tgz "${USER}@${HOST}:/tmp/nm-${DEPS}.tgz"
  # Unpack to a temp name and rename into place, so an interrupted upload can never leave a
  # half-populated tree that a later deploy would mistake for a complete one.
  "${SSH[@]}" "set -e
    rm -rf ${ROOT}/shared/node_modules/.incoming-${DEPS}
    mkdir -p ${ROOT}/shared/node_modules/.incoming-${DEPS}
    tar -xzf /tmp/nm-${DEPS}.tgz -C ${ROOT}/shared/node_modules/.incoming-${DEPS} --strip-components=1
    mv -T ${ROOT}/shared/node_modules/.incoming-${DEPS} ${ROOT}/shared/node_modules/${DEPS}
    rm -f /tmp/nm-${DEPS}.tgz"
fi

say "4/9  wiring the release"
"${SSH[@]}" "set -e
  ln -sfn ${ROOT}/shared/node_modules/${DEPS} ${ROOT}/backend/releases/${REL}/node_modules
  ln -sfn ${ROOT}/shared/.env                 ${ROOT}/backend/releases/${REL}/.env
  test -f ${ROOT}/shared/.env || { echo 'shared/.env is missing — place it by hand first'; exit 1; }"

# A browser tab open across a deploy still holds the old index.html, and will try to lazily
# import chunks by their old hashed names. Copying the previous release's assets forward
# (without overwriting) keeps those requests resolving instead of throwing.
say "5/9  carrying previous assets forward"
"${SSH[@]}" "prev=\$(readlink -f ${ROOT}/frontend/current 2>/dev/null || true)
  if [ -n \"\$prev\" ] && [ -d \"\$prev/assets\" ]; then
    cp -rn \"\$prev/assets/.\" ${ROOT}/frontend/releases/${REL}/assets/ 2>/dev/null || true
  fi"

# Before the swap, not after. Migrations are additive by contract (see docs/production.md),
# so the still-running old code tolerates a schema one release ahead. The reverse — new code
# against an un-migrated schema — is not survivable.
say "6/9  prisma migrate deploy"
"${SSH[@]}" "cd ${ROOT}/backend/releases/${REL} && ./node_modules/.bin/prisma migrate deploy"

PREV="$("${SSH[@]}" "readlink -f ${ROOT}/backend/current 2>/dev/null || true")"

# `mv -Tf` is rename(2) and atomic. `ln -sfn` over an existing symlink is unlink-then-symlink,
# which leaves a window where `current` does not exist — nginx 404s into it.
say "7/9  atomic swap"
"${SSH[@]}" "set -e
  for app in frontend ops backend; do
    ln -sfn ${ROOT}/\$app/releases/${REL} ${ROOT}/\$app/current.new
    mv -Tf  ${ROOT}/\$app/current.new     ${ROOT}/\$app/current
  done"

say "8/9  restart and health gate${ONLY:+  (only ${ONLY})}"
"${SSH[@]}" "cd ${ROOT}/backend/current && pm2 startOrReload ecosystem.config.cjs --update-env ${PM2_ONLY} && pm2 save"

# Two independent checks, because either one alone can lie.
#
# `/health` runs SELECT 1 and 503s on a dead pool, so it proves the app reached the database
# rather than merely bound a port. But it CANNOT prove *which* process answered. Until the
# cutover, the pre-TypeScript root pm2 `server` still owns 4000 — so a new API that dies on
# EADDRINUSE leaves the old one answering 200 and the deploy goes green over a corpse.
#
# So also ask pm2 whether the processes this deploy started are actually online. A crash loop
# shows as `errored`, or as `online` with restart_time climbing between the two samples.
if ! "${SSH[@]}" "
    healthy() {
      for p in ${HEALTH_PORTS}; do
        curl -fsS -m 3 localhost:\$p/health >/dev/null 2>&1 || return 1
      done
      for a in ${HEALTH_APPS}; do
        pm2 jlist 2>/dev/null | node -e '
          let s=\"\"; process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{
            const app=(JSON.parse(s||\"[]\")).find(x=>x.name===process.argv[1]);
            process.exit(app && app.pm2_env.status===\"online\" ? 0 : 1);
          });' \$a || return 1
      done
      return 0
    }
    for i in \$(seq 1 40); do healthy && exit 0; sleep 2; done
    exit 1"; then
  echo
  echo "UNHEALTHY after 80s — reverting to ${PREV:-<none>}"
  echo "NOTE: the migration is NOT reverted. Additive migrations are safe to leave applied."
  if [ -n "${PREV}" ]; then
    "${SSH[@]}" "set -e
      ln -sfn ${PREV} ${ROOT}/backend/current.new
      mv -Tf  ${ROOT}/backend/current.new ${ROOT}/backend/current
      cd ${ROOT}/backend/current && pm2 startOrReload ecosystem.config.cjs --update-env ${PM2_ONLY}"
  fi
  "${SSH[@]}" "pm2 logs --nostream --lines 40 --raw ${ONLY}" || true
  exit 1
fi

say "9/9  pruning"
# Never delete the tree the live release points at, whatever its age.
"${SSH[@]}" "set -e
  for app in frontend ops backend; do
    ls -1dt ${ROOT}/\$app/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
  done
  keep=\$(readlink -f ${ROOT}/backend/current/node_modules)
  find ${ROOT}/shared/node_modules -mindepth 1 -maxdepth 1 -type d \
    ! -path \"\$keep\" -mtime +7 -exec rm -rf {} + 2>/dev/null || true"

echo
echo "deployed ${REL} — https://zunopilot.com  https://ops.zunopilot.com  https://api.zunopilot.com"
