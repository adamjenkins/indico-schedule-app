# Deploying

Two steps: copy a directory, add an nginx block. Nothing is installed into
Indico, there is no service to restart, and nothing in Indico's virtualenv is
touched.

The build is already done — `schedule-app-<build>.tar.gz` sits in this
directory. To rebuild it: `npm ci && npm run package`.

## 1. Copy the files

```bash
scp schedule-app-<build>.tar.gz <server>:/tmp/

# on the server
sudo mkdir -p /srv/schedule-app
sudo tar xzf /tmp/schedule-app-<build>.tar.gz -C /srv/schedule-app
sudo chown -R root:root /srv/schedule-app
sudo chmod -R a+rX /srv/schedule-app
```

The archive unpacks to its own root, so that lands as:

```
/srv/schedule-app/index.html
/srv/schedule-app/sw.js
/srv/schedule-app/manifest.webmanifest
/srv/schedule-app/asset-manifest.json
/srv/schedule-app/assets/…
/srv/schedule-app/icons/…
```

## 2. Add the nginx location

Paste the three blocks from `deploy/nginx-schedule-app.conf` into the Indico
`server { … }` block, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Ordering against Indico's catch-all `location /` does not matter — nginx picks
the longest matching prefix, and `/schedule-app/` is longer than `/`.

**The `sw.js` block is the one that matters.** A cached service worker pins
every visitor to an old build, and there is no way to push a fix to a browser
that will not re-fetch it. If you paste only part of the file, paste that part.

## 3. Check it

```bash
curl -sI https://<host>/schedule-app/ | head -1                    # 200
curl -sI https://<host>/schedule-app/sw.js | grep -i cache-control # no-store
curl -sI https://<host>/schedule-app/event/1/2026-09-04 | head -1  # 200 (try_files)
```

Then open `https://<host>/schedule-app/` on a phone, add an event by pasting
its URL, and use "Add to Home Screen".

## It must be HTTPS

Service workers only exist in a secure context. Over plain `http://` (anything
but localhost) the app still works as an ordinary website, but there is **no
offline support and no home-screen install** — it logs a console warning saying
exactly that. If the host has no certificate, fix that before judging the app.

## Same origin, deliberately

The app must be served from the **same host as Indico**. That is what lets the
browser send the user's existing `indico_session` cookie, which is why there is
no login screen and no API token anywhere. Serving it from a different host
will fail on CORS: Indico's `grid-data` endpoint sends no CORS headers.

## Updating later

Same two commands as step 1, with the new tarball. Browsers pick up the new
build by themselves — the service worker's bytes change whenever the assets do,
so it reinstalls on the next visit.

```bash
sudo rm -rf /srv/schedule-app && sudo mkdir -p /srv/schedule-app
sudo tar xzf /tmp/schedule-app-<new-build>.tar.gz -C /srv/schedule-app
sudo chown -R root:root /srv/schedule-app && sudo chmod -R a+rX /srv/schedule-app
```

Removing the directory first rather than unpacking over the top: old hashed
assets would otherwise accumulate forever.

## Rehearsing it locally

`scripts/serve-dist.py` serves a `dist/` (or an unpacked tarball) under exactly
the rules in `deploy/nginx-schedule-app.conf`, proxying everything else to
Indico. The full verification suite has been run against the packaged artifact
that way:

```bash
mkdir -p /tmp/deployed && tar xzf schedule-app-<build>.tar.gz -C /tmp/deployed
python3 scripts/serve-dist.py --root /tmp/deployed --port 4175 &
python3 scripts/verify.py --base http://127.0.0.1:4175 --event <id>
```
