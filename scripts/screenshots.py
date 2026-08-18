#!/usr/bin/env python3
"""Screenshot the running app, for review and for the docs.

    npx vite preview --port 4173 --host 127.0.0.1 &
    python3 scripts/screenshots.py --out /tmp/shots [--dark]

Writes one PNG per screen at phone size. Not part of the build; this exists so
changes to the design can be looked at rather than guessed at.
"""
import argparse
import pathlib
import sys

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:4173')
    parser.add_argument('--event', type=int, default=2)
    parser.add_argument('--out', default='/tmp/schedule-app-shots')
    parser.add_argument('--dark', action='store_true')
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    app = f'{args.base}/schedule-app/'
    suffix = '-dark' if args.dark else ''

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844},
            device_scale_factor=2,
            color_scheme='dark' if args.dark else 'light',
        )
        page = ctx.new_page()

        page.goto(app, wait_until='networkidle')
        page.screenshot(path=str(out / f'01-empty{suffix}.png'))

        page.get_by_role('button', name='Add an event').click()
        page.locator('input.field').fill(str(args.event))
        page.get_by_role('button', name='Add', exact=True).click()
        page.wait_for_selector('.talk', timeout=15000)
        page.screenshot(path=str(out / f'03-schedule{suffix}.png'))

        page.goto(app, wait_until='networkidle')
        page.wait_for_selector('.card')
        page.screenshot(path=str(out / f'02-events{suffix}.png'))

        page.goto(f'{app}event/{args.event}', wait_until='networkidle')
        page.wait_for_selector('.talk')
        page.get_by_role('button', name='Filter', exact=True).click()
        page.wait_for_selector('.sheet')
        page.screenshot(path=str(out / f'04-filter{suffix}.png'))
        page.keyboard.press('Escape')

        page.goto(f'{app}event/{args.event}?tracks=1', wait_until='networkidle')
        page.wait_for_selector('.talk')
        page.screenshot(path=str(out / f'05-track-filter{suffix}.png'))

        page.goto(f'{app}event/{args.event}', wait_until='networkidle')
        page.wait_for_selector('.talk')
        page.locator('.talk').first.click()
        page.wait_for_selector('.detail')
        page.screenshot(path=str(out / f'06-talk{suffix}.png'))

        page.locator('.detail .btn').first.click()
        page.locator('.tabbar button', has_text='My agenda').click()
        page.wait_for_selector('.talk')
        page.screenshot(path=str(out / f'07-agenda{suffix}.png'))

        page.locator('.tabbar button', has_text='Search').click()
        page.locator('input[type=search]').fill('practice')
        page.wait_for_selector('.resultcount', timeout=5000)
        page.screenshot(path=str(out / f'08-search{suffix}.png'))

        page.goto(f'{app}settings', wait_until='networkidle')
        page.wait_for_selector('.settings-group')
        page.screenshot(path=str(out / f'09-settings{suffix}.png'))

        browser.close()

    print(f'wrote screenshots to {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
