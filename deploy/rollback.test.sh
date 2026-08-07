#!/usr/bin/env bash
#
# Does a failed deploy put *everything* back?
#
# The rollback is the one path in deploy.sh that only ever runs when something has already gone
# wrong, so it is the one path nobody watches succeed. It shipped reverting the backend alone:
# a health failure rolled the API back and left the new frontend live, and production served a
# UI built against an API one release behind it. Nothing failed loudly — the deploy said
# UNHEALTHY and exited 1, exactly as designed, while leaving a state nobody had tested.
#
# This runs the real deploy.sh against a fake box: a temp directory for /srv/zunopilot and a
# stub on PATH standing in for ssh, which runs the commands locally with the paths rewritten.
# No network, no production.
#
#   bash deploy/rollback.test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOX="$(mktemp -d)"
BIN="$(mktemp -d)"
trap 'rm -rf "${BOX}" "${BIN}"' EXIT

OLD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
NEW=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

fail=0
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
  else
    printf '  FAIL %s\n       expected %s\n       got      %s\n' "$1" "$3" "$2"
    fail=1
  fi
}

# ── The fake box ──────────────────────────────────────────────────────────────

for app in frontend ops backend; do
  mkdir -p "${BOX}/srv/zunopilot/${app}/releases/${OLD}" "${BOX}/srv/zunopilot/${app}/releases/${NEW}"
  ln -sfn "${BOX}/srv/zunopilot/${app}/releases/${OLD}" "${BOX}/srv/zunopilot/${app}/current"
done
mkdir -p "${BOX}/srv/zunopilot/shared/deps"
touch "${BOX}/srv/zunopilot/shared/.env"
# Pre-seeding the dependency tree makes step 3 skip its upload — the content-addressed cache
# doing exactly what it does on a real repeat deploy.
mkdir -p "${BOX}/srv/zunopilot/shared/deps/deadbeef/node_modules/.bin"
# Step 6 runs migrations through the release's own prisma. A no-op stands in: what this test
# is about is what happens *after* a successful migration, when the health gate says no.
printf '#!/usr/bin/env bash\nexit 0\n' > "${BOX}/srv/zunopilot/shared/deps/deadbeef/node_modules/.bin/prisma"
chmod +x "${BOX}/srv/zunopilot/shared/deps/deadbeef/node_modules/.bin/prisma"

# deploy.sh runs from the pipeline's working directory and reads its artifacts from there.
# The fake one holds the smallest set that gets it past steps 1-3 and on to the swap.
WORK="${BOX}/work"
mkdir -p "${WORK}/frontend/dist" "${WORK}/superadmin/dist"
echo '<!doctype html>' > "${WORK}/frontend/dist/index.html"
echo '<!doctype html>' > "${WORK}/superadmin/dist/index.html"
echo deadbeef > "${WORK}/deps.sha"
# A real archive, not an empty file: step 2 untars it with --strip-components=1, so it needs a
# top-level directory to strip.
mkdir -p "${BOX}/stage/backend"
echo 'export {}' > "${BOX}/stage/backend/index.ts"
tar -czf "${WORK}/backend-src.tgz" -C "${BOX}/stage" backend

# `ssh` runs the command here instead. No path rewriting is needed because DEPLOY_ROOT already
# points deploy.sh at the sandbox — an earlier version of this harness rewrote /srv/zunopilot
# in both directions with string substitution and mangled every path it touched.
cat > "${BIN}/ssh" <<'EOF'
#!/usr/bin/env bash
# Ignore the ssh flags and the user@host; the last argument is the command.
exec bash -c "${@: -1}"
EOF
chmod +x "${BIN}/ssh"

# Stubs for the things a real box has and this one does not. `pm2` and `curl` both succeed;
# what makes the deploy fail is `node`, which the health gate uses to read pm2's process list.
for stub in pm2 curl; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${BIN}/${stub}"
  chmod +x "${BIN}/${stub}"
done

# `mv -T` is GNU. macOS ships BSD mv, which has no such flag — and worse, plain `mv src dst`
# where dst is a symlink to a directory moves src *into* it, which is the precise failure
# `-T` exists to prevent. The stub gives deploy.sh the rename(2) it is asking for, so this
# runs on a laptop as well as in CI. Anything that is not `-Tf` goes to the real mv.
cat > "${BIN}/mv" <<'MV'
#!/usr/bin/env bash
if [ "$1" = "-Tf" ] || [ "$1" = "-T" ]; then
  python3 -c 'import os,sys; os.rename(sys.argv[1], sys.argv[2])' "$2" "$3"
  exit $?
fi
exec /bin/mv "$@"
MV
chmod +x "${BIN}/mv"

# scp really does have to move the file — step 2 untars what it delivers.
cat > "${BIN}/scp" <<'SCP'
#!/usr/bin/env bash
# `${@: -1}`, not `${args[-1]}` — macOS ships bash 3.2, which has no negative subscripts.
dest="${@: -1}"; src="${@: -2:1}"
cp "${src}" "${dest#*:}"
SCP
chmod +x "${BIN}/scp"
# The health gate's process check never passes, so the deploy fails and rolls back. That is the
# whole point of the fixture.
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 1\n' > "${BIN}/node"
chmod +x "${BIN}/node"

# ── Run it ────────────────────────────────────────────────────────────────────

echo "a deploy whose health gate never passes"
set +e
(
  cd "${WORK}"
  PATH="${BIN}:${PATH}" \
  DEPLOY_HOST=fake DEPLOY_USER=fake BITBUCKET_COMMIT="${NEW}" \
  DEPLOY_ROOT="${BOX}/srv/zunopilot" \
    bash "${HERE}/deploy.sh"
) > "${BOX}/log" 2>&1
rc=$?
set -e

check 'exits non-zero' "${rc}" '1'
grep -q 'UNHEALTHY' "${BOX}/log" || { echo '  FAIL never reached the health gate'; sed -n '1,40p' "${BOX}/log"; exit 1; }

for app in frontend ops backend; do
  check "${app} is back on the previous release" \
    "$(basename "$(readlink "${BOX}/srv/zunopilot/${app}/current")")" "${OLD}"
done

echo
if [ "${fail}" = 0 ]; then
  echo 'rollback restores every pointer'
else
  echo '--- deploy log ---'
  cat "${BOX}/log"
  exit 1
fi
