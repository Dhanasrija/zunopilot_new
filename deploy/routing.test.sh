#!/usr/bin/env bash
#
# Does nginx route what we think it routes?
#
# **Why this exists.** `location ~* \.(xml|...)$` was added so a missing file 404s instead of
# falling through to the SPA shell — a crawler asking for /sitemap_index.xml was getting HTTP
# 200 with text/html, which Google reports as "Couldn't fetch". But an nginx *regex* location
# outranks an ordinary *prefix* one, and the first draft of that block silently captured
# `/media/<uuid>/invoice.pdf` (proxied to the backend, and the URL Meta fetches template media
# from) and `/assets/*.png` (which must keep their immutable caching). Both would have been
# production outages shipped by a config that passes `nginx -t` and reads correctly.
#
# Precedence is exactly the kind of thing that is easier to test than to reason about, so this
# runs the real config in a container against a fake document root and a stub upstream, and
# asserts where each request actually lands.
#
#   bash deploy/routing.test.sh          (needs docker)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
NAME="zunopilot-routing-test-$$"
trap 'docker rm -f "${NAME}" >/dev/null 2>&1 || true; rm -rf "${WORK}"' EXIT

if ! docker info >/dev/null 2>&1; then
  echo 'SKIP: docker is not running. Start Docker Desktop and re-run.'
  exit 0
fi

fail=0
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok   %-46s %s\n' "$1" "$2"
  else
    printf '  FAIL %-46s got %s, expected %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

# ── A document root that looks like a real release ────────────────────────────

mkdir -p "${WORK}/www/assets"
echo '<!doctype html><title>app shell</title>' > "${WORK}/www/index.html"
printf 'User-agent: *\n' > "${WORK}/www/robots.txt"
printf '<?xml version="1.0"?><urlset/>' > "${WORK}/www/sitemap.xml"
echo 'body{}' > "${WORK}/www/assets/index-abc123.css"
printf 'PNG' > "${WORK}/www/assets/logo.png"

# ── The config under test ─────────────────────────────────────────────────────
#
# The real `deploy/nginx/app` cannot run as-is: it terminates TLS with certbot's certificates
# and proxies to 127.0.0.1:4000. So the location blocks are lifted verbatim and only the
# server envelope is replaced — the thing being tested is precedence between those blocks,
# which is decided by the blocks alone.

# Everything from the first `location ^~ /api` to the closing brace of the last `location /`
# inside the app server block, minus the brace that closes `server {` itself — the envelope
# below supplies its own. Dropping it by finding the last column-zero `}` rather than by
# deleting the last line: a trailing blank line is what the first attempt removed instead,
# leaving an extra brace that nginx rejected with an error naming a line 40 further down.
# Anchored on the first location line at the server block's indent, not on `location ^~ /api`
# by name. The earlier version anchored on that literal, so removing the `^~` broke the
# extraction and the test reported "could not lift the blocks" instead of letting the
# behavioural assertions judge it — a fixture failing where the config should have.
sed -n '/^# ── The customer app/,/^# ── The API host/p' "${HERE}/nginx/app" \
  | sed -n '/^    location /,$p' \
  | awk '{ line[NR] = $0 }
         END { for (i = 1; i <= NR; i++) if (line[i] == "}") last = i
               for (i = 1; i < last; i++) print line[i] }' \
  > "${WORK}/locations.conf"

# Not a fixture problem when this fires: it means the extension-404 block this whole file is
# about is no longer in deploy/nginx/app, which is the original bug back.
grep -q 'location ~\*' "${WORK}/locations.conf" \
  || { echo 'FAIL: the extension-404 location block is missing from deploy/nginx/app'; exit 1; }

# The stub upstream stands in for the API and the media route. It answers with a body naming
# itself, so a request reaching it is unmistakable in the output.
cat > "${WORK}/nginx.conf" <<CONF
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;

  server {
    listen 8081;
    location / { return 200 "UPSTREAM\n"; }
  }

  upstream backend { server 127.0.0.1:8081; }

  server {
    listen 8080;
    root /www;
    index index.html;
    gzip_static on;
$(sed 's|http://127\.0\.0\.1:4000|http://backend|' "${WORK}/locations.conf")
  }
}
CONF

docker run -d --name "${NAME}" \
  -v "${WORK}/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "${WORK}/www:/www:ro" \
  -p 18080:8080 nginx:1.28-alpine >/dev/null

for i in $(seq 1 25); do
  curl -fsS -m 2 http://localhost:18080/ >/dev/null 2>&1 && break
  sleep 1
done

if ! docker exec "${NAME}" nginx -t >/dev/null 2>&1; then
  echo 'FAIL: nginx rejected the config'
  docker exec "${NAME}" nginx -t 2>&1 || docker logs "${NAME}" 2>&1 | tail -5
  echo '--- generated config ---'
  cat -n "${WORK}/nginx.conf"
  exit 1
fi

status()  { curl -sS -o /dev/null -m 5 -w '%{http_code}' "http://localhost:18080$1"; }
ctype()   { curl -sS -o /dev/null -m 5 -w '%{content_type}' "http://localhost:18080$1"; }
body()    { curl -sS -m 5 "http://localhost:18080$1"; }
# No `head -1`: `expires 1y` and the `add_header` in the assets block each emit their own
# Cache-Control line, and reading only the first found `max-age=31536000` without `immutable`
# — a failing assertion against a config that was correct.
header()  { curl -sS -o /dev/null -m 5 -D - "http://localhost:18080$1" | grep -i "^$2:" | tr -d '\r'; }

# ── The bug that started this ─────────────────────────────────────────────────

echo 'a sitemap-shaped path that is not a file'
check '/sitemap_index.xml 404s'        "$(status /sitemap_index.xml)" '404'
check '/sitemap-index.xml 404s'        "$(status /sitemap-index.xml)" '404'
check '/missing.txt 404s'              "$(status /missing.txt)"       '404'
check '/nope.json 404s'                "$(status /nope.json)"         '404'
# The whole point, and it is about the *body*, not the content type: nginx's own 404 page is
# legitimately text/html, so asserting on the type proves nothing. What must not come back is
# the application, which is what Google could not parse as a sitemap.
check 'is not the app shell'           "$(body /sitemap_index.xml | grep -c 'app shell')" '0'

echo
echo 'the sitemap that does exist is untouched'
check '/sitemap.xml 200s'              "$(status /sitemap.xml)"       '200'
check '/sitemap.xml is xml'            "$(ctype /sitemap.xml | cut -d';' -f1)" 'text/xml'
check '/robots.txt 200s'               "$(status /robots.txt)"        '200'

echo
echo 'client-side routes still reach the app shell'
check '/pricing serves the shell'      "$(body /pricing | grep -c 'app shell')" '1'
check '/orders/42 serves the shell'    "$(body /orders/42 | grep -c 'app shell')" '1'
check '/inbox serves the shell'        "$(status /inbox)"             '200'

echo
echo '**the two the regex would have broken**'
# `/media/<uuid>/invoice.pdf` ends in a matched extension. If the regex wins, Meta gets a 404
# for every template image instead of the file.
check 'media reaches the backend'      "$(body /media/abc-123/invoice.pdf)" 'UPSTREAM'
check 'media image reaches the backend' "$(body /media/abc-123/photo.png)"  'UPSTREAM'
check 'api reaches the backend'        "$(body /api/anything.json)"         'UPSTREAM'
# Hashed bundles must keep immutable caching; a regex match would drop the header.
check 'assets keep immutable caching'  "$(header /assets/logo.png 'cache-control' | grep -c immutable)" '1'
check 'assets keep a year of max-age'  "$(header /assets/logo.png 'cache-control' | grep -c 'max-age=31536000')" '1'
check 'assets css keeps it too'        "$(header /assets/index-abc123.css 'cache-control' | grep -c immutable)" '1'

echo
if [ "${fail}" = 0 ]; then
  echo 'routing is what the config says it is'
else
  exit 1
fi
