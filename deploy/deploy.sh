#!/usr/bin/env bash
# Build and install the schedule app on an Indico host.
#
#   ./deploy/deploy.sh [target-directory]
#
# Defaults to /srv/schedule-app. Run it on the Indico host, or build locally
# and rsync dist/ yourself — the app is only static files, so there is no
# service to restart and nothing in Indico's virtualenv to touch.
#
# The nginx side is a one-off: see deploy/nginx-schedule-app.conf. That part
# is deliberately NOT automated here, because the vhost is shared with Indico
# itself and should be changed deliberately.
set -euo pipefail

TARGET="${1:-/srv/schedule-app}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$HERE"

echo "==> Building"
npm ci
npm run build

if [[ ! -f dist/asset-manifest.json ]]; then
  echo "dist/asset-manifest.json is missing — the service worker would precache nothing" >&2
  exit 1
fi
if grep -q '__BUILD_ID__' dist/sw.js; then
  echo "dist/sw.js still has its placeholder build id — it would never update on clients" >&2
  exit 1
fi

echo "==> Installing to $TARGET"
sudo mkdir -p "$TARGET"
# --delete so a removed asset does not linger and get served forever.
sudo rsync -a --delete dist/ "$TARGET/"
sudo chown -R root:root "$TARGET"
sudo chmod -R a+rX "$TARGET"

echo "==> Done"
echo "If this is the first install, add deploy/nginx-schedule-app.conf to the"
echo "Indico vhost, then: sudo nginx -t && sudo systemctl reload nginx"
