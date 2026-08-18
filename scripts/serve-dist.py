#!/usr/bin/env python3
"""Serve a built dist/ the way the production nginx will, for verification.

    python3 scripts/serve-dist.py [--root dist] [--port 4175] [--indico http://indico.wisecat.net]

`vite preview` is not a faithful rehearsal: it knows about the app's base path
and applies its own rewriting. This mimics exactly what
`deploy/nginx-schedule-app.conf` does and nothing else —

  * /schedule-app/…            files from the root, falling back to index.html
  * /schedule-app/sw.js        Cache-Control: no-store
  * /schedule-app/assets/…     immutable, one-year cache
  * everything else            proxied to Indico (/event, /search, /category, …),
 *                              which is what being same-origin gives you for free

so a pass here means the artifact and that config agree. Verification only; it
is single-threaded and has no place in front of real users.
"""
import argparse
import http.server
import mimetypes
import pathlib
import urllib.error
import urllib.request

BASE = '/schedule-app/'


def make_handler(root: pathlib.Path, indico: str):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_args):
            pass  # quiet; the verification script is the output that matters

        def do_GET(self):  # noqa: N802  (BaseHTTPRequestHandler's naming)
            if self.path.startswith(BASE):
                self._serve_app()
            else:
                self._proxy()

        def _serve_app(self):
            relative = self.path[len(BASE):].split('?')[0].split('#')[0]
            candidate = (root / relative).resolve()

            # Refuse to serve outside the root even if the path climbs out.
            if not str(candidate).startswith(str(root.resolve())):
                self.send_error(403)
                return

            headers = {}
            if relative == 'sw.js':
                # A cached service worker pins every visitor to an old build.
                headers['Cache-Control'] = 'no-store'
            elif relative.startswith('assets/'):
                headers['Cache-Control'] = 'public, max-age=31536000, immutable'

            if not candidate.is_file():
                # try_files … /schedule-app/index.html — this is what makes the
                # app's own routes survive a reload or a shared link.
                candidate = root / 'index.html'
                headers.pop('Cache-Control', None)

            body = candidate.read_bytes()
            ctype = mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
            if candidate.suffix == '.webmanifest':
                ctype = 'application/manifest+json'
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _proxy(self):
            request = urllib.request.Request(
                indico.rstrip('/') + self.path,
                headers={
                    'Accept': self.headers.get('Accept', '*/*'),
                    'Cookie': self.headers.get('Cookie', ''),
                },
            )
            try:
                with urllib.request.urlopen(request) as upstream:
                    body, status, ctype = (
                        upstream.read(),
                        upstream.status,
                        upstream.headers.get('Content-Type', 'application/json'),
                    )
            except urllib.error.HTTPError as error:
                body, status, ctype = (
                    error.read(),
                    error.code,
                    error.headers.get('Content-Type', 'application/json'),
                )
            except urllib.error.URLError:
                body, status, ctype = b'{"error":"upstream unreachable"}', 502, 'application/json'
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='dist')
    parser.add_argument('--port', type=int, default=4175)
    parser.add_argument('--indico', default='http://indico.wisecat.net')
    args = parser.parse_args()

    root = pathlib.Path(args.root).resolve()
    if not (root / 'index.html').is_file():
        raise SystemExit(f'{root} has no index.html — build first')

    handler = make_handler(root, args.indico)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    print(f'serving {root} at http://127.0.0.1:{args.port}{BASE} (Indico: {args.indico})')
    server.serve_forever()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
