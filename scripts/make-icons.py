#!/usr/bin/env python3
"""Render the app icons from an inline SVG.

    python3 scripts/make-icons.py

Uses the harness's Playwright + Chromium (HARNESS.md §6) rather than an image
library, because Chromium is already installed here and Pillow/ImageMagick are
not. Rerun after changing the mark; the output is committed so a normal build
needs neither Playwright nor a browser.

Three files, because the platforms want different things:
  icon-192 / icon-512      the mark, edge to edge
  icon-maskable-512        the same mark inside the 40% safe zone, so Android's
                           circular/squircle mask cannot crop it
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent.parent.resolve()
OUT = HERE / 'public' / 'icons'

BG = '#1f5c96'
BAR = '#ffffff'

# A schedule reduced to its essentials: a stack of bars of differing length and
# offset, reading as "things at times" rather than as a generic calendar page.
MARK = '''
  <rect x="20" y="22" width="44" height="10" rx="5" fill="{bar}" opacity="0.95"/>
  <rect x="20" y="40" width="60" height="10" rx="5" fill="{bar}" opacity="0.75"/>
  <rect x="36" y="58" width="44" height="10" rx="5" fill="{bar}" opacity="0.95"/>
  <rect x="20" y="76" width="30" height="10" rx="5" fill="{bar}" opacity="0.55"/>
'''.format(bar=BAR)


def svg(size: int, maskable: bool) -> str:
    # The mark is authored in a 100x100 box; a maskable icon shrinks it to 60%
    # and centres it, which is the safe zone Android guarantees is visible.
    scale = 0.6 if maskable else 0.86
    offset = (100 - 100 * scale) / 2
    radius = 0 if maskable else 22
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="{radius}" fill="{BG}"/>
  <g transform="translate({offset} {offset}) scale({scale})">{MARK}</g>
</svg>'''


ICONS = [
    ('icon-192.png', 192, False),
    ('icon-512.png', 512, False),
    ('icon-maskable-512.png', 512, True),
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for name, size, maskable in ICONS:
            page.set_viewport_size({'width': size, 'height': size})
            page.set_content(
                f'<body style="margin:0;background:transparent">{svg(size, maskable)}</body>'
            )
            page.screenshot(path=str(OUT / name), omit_background=True)
            print('wrote', name)
        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
