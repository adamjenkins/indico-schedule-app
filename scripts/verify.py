#!/usr/bin/env python3
"""End-to-end verification of a built app against a real Indico instance.

    npx vite preview --port 4173 --host 127.0.0.1 &
    python3 scripts/verify.py [--event 2] [--base http://127.0.0.1:4173]

Checks behaviour numerically rather than by eye — counts of rendered rows, the
contents of IndexedDB, the service worker's state — because "it looked right"
is exactly how offline bugs survive review. Every assertion prints, so a failure
says which one and what it saw.

Run it against `vite preview` (a real production build) rather than the dev
server, and on 127.0.0.1 so the browser treats the origin as secure and
actually registers the service worker.
"""
import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright

PASS, FAIL = '  ok  ', ' FAIL '
failures: list[str] = []


def check(label: str, condition: bool, detail: str = '') -> None:
    print(f'[{PASS if condition else FAIL}] {label}{f" — {detail}" if detail else ""}')
    if not condition:
        failures.append(label)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:4173')
    parser.add_argument('--event', type=int, default=2)
    parser.add_argument(
        '--multiday-event',
        type=int,
        default=None,
        help='an event spanning several days, to exercise day navigation',
    )
    parser.add_argument(
        '--insecure-base',
        default=None,
        help='the same build served on a non-localhost http:// origin, to check it '
        'degrades gracefully where service workers do not exist',
    )
    parser.add_argument(
        '--no-schedule-event',
        type=int,
        default=None,
        help='an event with NO block schedule configured, to check the picker excludes it',
    )
    parser.add_argument('--headed', action='store_true')
    args = parser.parse_args()

    app = f'{args.base}/schedule-app/'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_page  # noqa: F841  (kept for symmetry below)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844})
        page = ctx.new_page()
        errors: list[str] = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))

        # -- 1. cold start ------------------------------------------------
        page.goto(app, wait_until='networkidle')
        check('app boots', page.locator('.app').count() == 1)
        check('empty state on first run', page.get_by_text('No events yet').count() == 1)

        # -- 1b. install guidance -----------------------------------------
        # The app is not installed here, so it must explain how to install it —
        # a missing address bar is the whole point and users need telling.
        card = page.locator('.install')
        check('install guidance is offered', card.count() == 1, f'{card.count()} cards')
        if card.count():
            text = card.inner_text()
            check(
                'guidance names a real action',
                'Home Screen' in text or 'Install app' in text or 'Install' in text,
                text.replace('\n', ' ')[:90],
            )
        page.locator('.install-actions .btn.ghost', has_text='Not now').click()
        check('guidance can be dismissed', page.locator('.install').count() == 0)
        page.goto(f'{app}settings', wait_until='networkidle')
        check(
            'guidance is still reachable in settings',
            page.locator('.install').count() == 1,
            'dismissing on one screen must not hide it everywhere',
        )
        page.goto(app, wait_until='networkidle')

        # -- 2. service worker --------------------------------------------
        state = page.evaluate("""async () => {
            const reg = await navigator.serviceWorker.ready;
            return reg.active ? reg.active.state : 'none';
        }""")
        check('service worker activated', state == 'activated', state)

        cached = page.evaluate("""async () => {
            const names = await caches.keys();
            const shell = names.find(n => n.startsWith('schedule-shell-'));
            if (!shell) return {names, count: 0};
            const keys = await (await caches.open(shell)).keys();
            return {names, count: keys.length};
        }""")
        check('shell precached', cached['count'] >= 6, f'{cached["count"]} entries in {cached["names"]}')

        # -- 2b. the organisation logo -------------------------------------
        # Lifted from Indico's own page header, so the app carries whatever
        # branding the server already shows. The plate behind it is the part
        # worth asserting: Indico's stock header logo is solid white, and on a
        # pale background an unplated logo is indistinguishable from no logo.
        page.wait_for_selector('.sitelogo img', timeout=15000)
        logo = page.evaluate("""() => {
            const box = document.querySelector('.sitelogo');
            const img = box?.querySelector('img');
            return box && img ? {
                onDark: box.classList.contains('on-dark'),
                plate: getComputedStyle(box).backgroundColor,
                width: img.getBoundingClientRect().width,
                height: img.getBoundingClientRect().height,
                complete: img.complete && img.naturalWidth > 0,
                blob: img.src.startsWith('blob:'),
                alt: img.alt,
            } : null;
        }""")
        check('the organisation logo is shown on the top screen', bool(logo and logo['complete']), logo)
        if logo:
            check(
                'it is rendered from a stored copy, not a live URL',
                logo['blob'],
                'blob: URL' if logo['blob'] else logo,
            )
            check(
                'it is visible against its plate',
                logo['width'] > 20 and logo['height'] > 8,
                f'{logo["width"]:.0f}x{logo["height"]:.0f}px',
            )
            check(
                'a light logo gets a dark plate behind it',
                # This instance serves the stock white logo, so the measurement
                # must come back "light" and the plate must be dark.
                logo['onDark'] and _is_dark(logo['plate']),
                f'on-dark={logo["onDark"]} plate={logo["plate"]}',
            )

        # -- 3. add an event by picking it, not by typing a URL -------------
        title = event_title(page, args.event)
        page.get_by_role('button', name='Add an event').click()
        page.wait_for_selector('.sheet')
        # The category listing is fetched after the sheet opens, so counting
        # straight away measures the spinner rather than the result.
        page.wait_for_selector('.event-option', timeout=30000)

        browsable = page.locator('.event-option').count()
        check('the picker lists events to choose from', browsable > 0, f'{browsable} events browsable')
        check(
            'no URL is asked for on the normal path',
            page.locator('input[placeholder*="Event ID"]').count() == 0,
        )

        # -- 3b. only events that have a block schedule ---------------------
        # Indico cannot be asked which events have one, so the app asks per
        # event and remembers. Both halves are checked: the listing excludes an
        # event with no schedule, and the answers are on the device afterwards.
        if args.no_schedule_event is not None:
            page.wait_for_function(
                """() => !document.querySelector('.probe-progress')
                          || !document.querySelector('.probe-progress').textContent.includes('Checking')""",
                timeout=30000,
            )
            empty_title = event_title(page, args.no_schedule_event)
            listed_titles = page.locator('.event-option-title').all_inner_texts()
            check(
                'an event with no block schedule is not offered',
                empty_title not in listed_titles,
                f'"{empty_title[:40]}" among {len(listed_titles)} offered',
            )
            # Worked out independently rather than trusted from the app: ask
            # the same category endpoint the picker uses, then ask each event
            # for its schedule, and compare the two sets of titles.
            truth = sorted(events_with_schedules(page))
            check(
                'the offering is exactly the events that have a schedule',
                sorted(listed_titles) == truth,
                f'offered {sorted(listed_titles)} vs {truth}',
            )
            probes = page.evaluate("""async () => {
                const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('indico-schedule');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                if (!db.objectStoreNames.contains('probes')) return null;
                return await new Promise(resolve => {
                    const all = db.transaction('probes').objectStore('probes').getAll();
                    all.onsuccess = () => resolve(all.result.map(p => [p.eventId, p.hasSchedule]));
                });
            }""")
            check(
                'the answers are cached so they are asked once',
                probes is not None and len(probes) > 0,
                f'{len(probes or [])} verdicts stored',
            )
            check(
                'the empty event is remembered as having none',
                [args.no_schedule_event, False] in (probes or []),
                str(probes),
            )

        page.locator('.sheet input[type=search]').fill(title[:18])
        option = page.locator('.event-option', has_text=title[:18]).first
        # The search results are probed too, so the row appears only once its
        # event has been confirmed to have a schedule.
        option.wait_for(timeout=30000)
        check('search finds the event by name', option.count() > 0, title[:40])
        option.click()

        page.wait_for_url(f'**/schedule-app/event/{args.event}**', timeout=15000)
        page.wait_for_selector('.talk', timeout=15000)

        # -- 4. the schedule ----------------------------------------------
        expected = fetch_payload_counts(page, args.event)
        talks = page.locator('.talk').count()
        check(
            'every scheduled talk renders',
            talks == expected['scheduled'],
            f'{talks} rows vs {expected["scheduled"]} in the payload',
        )

        summary = page.locator('.chips').inner_text()
        check(
            'room summary matches the payload',
            f'{expected["columns"]} of {expected["columns"]} rooms' in summary.replace('\n', ' '),
            summary.replace('\n', ' '),
        )

        headings = page.locator('.timehead').count()
        check('talks are grouped under time headings', headings > 1, f'{headings} headings')

        # -- 5. filtering by group ----------------------------------------
        page.get_by_role('button', name='Filter', exact=True).click()
        page.wait_for_selector('.sheet')
        group = expected['groups'][0]
        page.get_by_role('checkbox', name=group['title'], exact=False).first.click()
        apply_label = page.locator('.sheet footer .btn:not(.ghost)').inner_text()
        page.locator('.sheet footer .btn:not(.ghost)').click()
        page.wait_for_selector('.sheet', state='detached')

        filtered = page.locator('.talk').count()
        check(
            'group filter narrows the list',
            filtered == group['talks'],
            f'{filtered} rows vs {group["talks"]} talks in "{group["title"]}"',
        )
        check(
            'the button predicted the result',
            f'Show {group["talks"]} ' in apply_label,
            apply_label,
        )
        check('filter is in the URL', f'groups={group["id"]}' in page.url, page.url)

        # A filtered URL must be openable from cold — that is the shareable-link
        # promise, and it is the thing a client-side-only filter would break.
        page.goto(page.url, wait_until='networkidle')
        page.wait_for_selector('.talk')
        check(
            'filtered link survives a reload',
            page.locator('.talk').count() == group['talks'],
            f'{page.locator(".talk").count()} rows',
        )

        # -- 6. track filter greys rather than hides -----------------------
        page.goto(f'{app}event/{args.event}?tracks={expected["track_id"]}', wait_until='networkidle')
        page.wait_for_selector('.talk')
        shown = page.locator('.talk').count()
        dimmed = page.locator('.talk.dim').count()
        check(
            'track filter keeps non-matching talks in kept rooms',
            dimmed > 0,
            f'{dimmed} of {shown} rows greyed',
        )
        check(
            'track filter drops rooms with no matching talk',
            shown < expected['scheduled'],
            f'{shown} of {expected["scheduled"]} rows',
        )

        # -- 7. starring and the agenda ------------------------------------
        page.goto(f'{app}event/{args.event}', wait_until='networkidle')
        page.wait_for_selector('.talk')
        first_title = page.locator('.talk .title').first.inner_text()
        page.locator('.talk .starbtn').first.click()
        # Scoped to the tab bar: every star button is also labelled "…my agenda".
        page.locator('.tabbar button', has_text='My agenda').click()
        page.wait_for_selector('.talk')
        check(
            'starred talk appears in the agenda',
            page.locator('.talk .title').first.inner_text() == first_title,
            page.locator('.talk .title').first.inner_text(),
        )
        check(
            'the agenda says stars are device-only',
            'this device' in page.locator('.banner').first.inner_text().lower(),
        )

        # -- 7a. track colours, clashes and finished talks -------------------
        # Three things that only show up on the agenda, and one of them needs a
        # clock: the demo conference is usually dated in the future, where no
        # talk has ever finished. Rather than depend on the date, the page's
        # `Date` is swapped for a fixed one mid-conference and the agenda is
        # re-entered — the screen reads the clock on every render, so nothing
        # has to reload.
        facts = page.evaluate(
            """async (eventId) => {
              const req = indexedDB.open('indico-schedule');
              const db = await new Promise(res => { req.onsuccess = () => res(req.result); });
              const days = await new Promise(res => {
                const tx = db.transaction('days', 'readonly');
                const r = tx.objectStore('days').getAll();
                r.onsuccess = () => res(r.result.filter(d => d.eventId === eventId));
              });
              const day = days[0];
              if (!day) { return null; }
              const talks = day.payload.scheduled_contributions
                .filter(c => c.start_minutes !== null)
                .sort((a, b) => a.start_minutes - b.start_minutes);
              const byStart = new Map();
              for (const c of talks) {
                if (!byStart.has(c.start_minutes)) { byStart.set(c.start_minutes, []); }
                byStart.get(c.start_minutes).push(c);
              }
              const pairs = [...byStart.entries()].filter(([, cs]) => cs.length >= 2);
              if (pairs.length < 2) { return null; }
              const early = pairs[0][1].slice(0, 2);
              const lateStart = pairs[pairs.length - 1][0];
              const late = pairs[pairs.length - 1][1].slice(0, 2);
              if (lateStart <= early[0].start_minutes) { return null; }
              // Clear whatever the earlier section starred, so the counts below are exact --
              // remembering it first, since this section has to hand the store back unchanged.
              const existing = await new Promise(res => {
                const tx = db.transaction('stars', 'readonly');
                const r = tx.objectStore('stars').getAll();
                r.onsuccess = () => res(r.result);
              });
              const previouslyStarred = existing[0] ? existing[0].contributionId : early[0].id;
              const wipe = db.transaction('stars', 'readwrite');
              wipe.objectStore('stars').clear();
              await new Promise(res => { wipe.oncomplete = res; });
              const tx = db.transaction('stars', 'readwrite');
              for (const c of [...early, ...late]) {
                tx.objectStore('stars').put({key: `${eventId}|${c.id}`, eventId,
                                             contributionId: c.id, starredAt: Date.now()});
              }
              await new Promise(res => { tx.oncomplete = res; });
              return {
                day: day.day,
                earlyEnd: Math.max(...early.map(c => c.start_minutes + (c.duration_minutes || 0))),
                lateStart,
                colouredTracks: (day.payload.tracks || []).filter(t => t.color).length,
                keepStarred: previouslyStarred,
              };
            }""",
            args.event,
        )
        if facts is None:
            check('agenda clash/finished checks have usable data', False,
                  'need two separate times with two simultaneous talks each')
        else:
            # Mid-conference: after the early pair has ended, before the late pair starts.
            frozen = (facts['earlyEnd'] + facts['lateStart']) // 2
            page.evaluate(
                """([day, minutes]) => {
                  const [y, m, d] = day.split('-').map(Number);
                  const FIXED = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
                  const Real = Date;
                  class Fake extends Real {
                    constructor(...args) { super(...(args.length ? args : [FIXED])); }
                    static now() { return FIXED; }
                  }
                  window.Date = Fake;
                }""",
                [facts['day'], frozen],
            )
            page.locator('.tabbar button', has_text='Schedule').click()
            page.locator('.tabbar button', has_text='My agenda').click()
            page.wait_for_timeout(500)

            check(
                'finished talks are hidden from the agenda',
                page.locator('.talk').count() == 2,
                f'{page.locator(".talk").count()} rows, expected the 2 still to come',
            )
            toggle = page.get_by_role('button', name=re.compile(r'^Show finished'))
            check('the button says how many are hidden', 'Show finished (2)' in toggle.inner_text(),
                  toggle.inner_text())
            boxes = page.locator('.clash')
            check('the two simultaneous talks are boxed together', boxes.count() == 1,
                  f'{boxes.count()} boxes')
            if boxes.count():
                check(
                    'the box holds exactly the talks that clash',
                    boxes.first.locator('.talk').count() == 2,
                )
                check(
                    'the box names the clash and its window',
                    bool(re.search(r'CLASH.*\d\d:\d\d.*\d\d:\d\d.*2 TALKS',
                                   boxes.first.locator('.clash-head').inner_text().upper())),
                    boxes.first.locator('.clash-head').inner_text(),
                )
            toggle.click()
            page.wait_for_timeout(400)
            check('showing finished brings them back', page.locator('.talk').count() == 4,
                  f'{page.locator(".talk").count()} rows')
            check('finished talks come back dimmed, not looking current',
                  page.locator('.talk.dim').count() == 2,
                  f'{page.locator(".talk.dim").count()} dimmed')
            check('both clashing pairs are boxed once everything is shown',
                  page.locator('.clash').count() == 2, f'{page.locator(".clash").count()} boxes')
            page.get_by_role('button', name='Hide finished').click()
            page.wait_for_timeout(300)
            check('hiding them again works', page.locator('.talk').count() == 2)

            # Put the stars back the way section 7 left them: the storage check
            # further down asserts an exact count, and a helper that quietly
            # changes global state is how a suite starts lying to itself.
            page.evaluate(
                """async ([eventId, keep]) => {
                  const req = indexedDB.open('indico-schedule');
                  const db = await new Promise(res => { req.onsuccess = () => res(req.result); });
                  const tx = db.transaction('stars', 'readwrite');
                  tx.objectStore('stars').clear();
                  tx.objectStore('stars').put({key: `${eventId}|${keep}`, eventId,
                                               contributionId: keep, starredAt: Date.now()});
                  await new Promise(res => { tx.oncomplete = res; });
                }""",
                [args.event, facts['keepStarred']],
            )

            # Track colours are the manager's choice, so this only asserts anything
            # when the event actually has some — otherwise it says so rather than
            # passing vacuously.
            if facts['colouredTracks'] == 0:
                print('  --   no track has a colour set on this event; skipping colour checks')
            else:
                page.locator('.tabbar button', has_text='Schedule').click()
                page.wait_for_selector('.talk')
                pills = page.evaluate(
                    """() => [...document.querySelectorAll('.talk .pill')].map(p =>
                        [getComputedStyle(p).backgroundColor, getComputedStyle(p).color])"""
                )
                default_pill = 'rgb(238, 241, 244)'
                coloured = [p for p in pills if p[0] not in (default_pill, 'rgb(232, 240, 249)')]
                check('a manager-chosen track colour reaches the track pill',
                      len(coloured) > 0, f'{len(coloured)} of {len(pills)} pills coloured')
                check('every coloured pill has black or white text',
                      all(p[1] in ('rgb(0, 0, 0)', 'rgb(255, 255, 255)') for p in coloured),
                      str({p[1] for p in coloured}))

        # -- 7b. abstracts, offline -----------------------------------------
        # The schedule payload carries at most a truncated preview, and usually
        # nothing at all, so the abstract has to come from somewhere else and be
        # stored — otherwise "read the abstract" means "go back online".
        #
        # Whether abstracts exist at all is the organisers' decision (Indico only
        # exports contributions once they are published), so the assertion is
        # conditional on what the server is actually willing to serve. Both
        # branches are real behaviour worth checking.
        available = page.evaluate(
            """async (eventId) => {
                const r = await fetch(`/export/event/${eventId}.json?detail=contributions`,
                    {headers: {Accept: 'application/json'}});
                if (!r.ok) return 0;
                const d = await r.json();
                return (d.results?.[0]?.contributions ?? []).filter(c => c.description).length;
            }""",
            args.event,
        )

        page.goto(f'{app}event/{args.event}', wait_until='networkidle')
        page.wait_for_selector('.talk')
        page.locator('.talk').first.click()
        page.wait_for_selector('.detail')

        if available:
            has_abstract = page.locator('.abstract').count() == 1
            check(
                'the abstract is shown in the app',
                has_abstract,
                f'{available} published upstream' + ('' if has_abstract else ', none rendered'),
            )
            if has_abstract:
                body = page.locator('.abstract').inner_text()
                check('the abstract has real text', len(body) > 30, f'{len(body)} characters')
                check(
                    'no markup leaks through as text',
                    '<' not in body and '&lt;' not in body,
                    body[:60],
                )
            stored_details = page.evaluate("""async () => {
                const open = indexedDB.open('indico-schedule');
                const db = await new Promise((res, rej) => {
                    open.onsuccess = () => res(open.result);
                    open.onerror = () => rej(open.error);
                });
                if (!db.objectStoreNames.contains('details')) return {records: 0, abstracts: 0};
                const req = db.transaction('details').objectStore('details').getAll();
                const rows = await new Promise((res, rej) => {
                    req.onsuccess = () => res(req.result);
                    req.onerror = () => rej(req.error);
                });
                const abstracts = rows.reduce((n, r) =>
                    n + Object.values(r.byContribution).filter(d => d.description).length, 0);
                return {records: rows.length, abstracts};
            }""")
            check(
                'abstracts are stored locally, so they work offline',
                stored_details['abstracts'] > 0,
                json.dumps(stored_details),
            )
        else:
            # Nothing published upstream: the app must say so rather than
            # leaving an empty space where the abstract should be.
            check(
                'a missing abstract is explained, not left blank',
                page.locator('.abstract-missing').count() == 1,
                'no contributions published on this event',
            )

        # -- 8. search ------------------------------------------------------
        page.locator('.tabbar button', has_text='Search').click()
        term = expected['search_term']
        page.locator('input[type=search]').fill(term)
        page.wait_for_selector('.resultcount', timeout=5000)
        count_text = page.locator('.resultcount').inner_text()
        hits = page.locator('.talk').count()
        check(
            'search finds the expected talks',
            hits == expected['search_hits'],
            f'{hits} rows vs {expected["search_hits"]} expected for "{term}" ({count_text})',
        )
        check('matches are highlighted', page.locator('.talk mark').count() > 0)

        # -- 9. what is actually stored -------------------------------------
        stored = page.evaluate("""async () => {
            const open = indexedDB.open('indico-schedule');
            const db = await new Promise((res, rej) => {
                open.onsuccess = () => res(open.result);
                open.onerror = () => rej(open.error);
            });
            const read = name => new Promise((res, rej) => {
                const req = db.transaction(name).objectStore(name).getAll();
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            const [events, days, stars] = await Promise.all([read('events'), read('days'), read('stars')]);
            return {
                events: events.length,
                days: days.length,
                stars: stars.length,
                talksInFirstDay: days[0]?.payload?.scheduled_contributions?.length ?? 0,
            };
        }""")
        check('event stored locally', stored['events'] == 1, json.dumps(stored))
        check('day payload stored locally', stored['days'] >= 1)
        check('payload kept whole', stored['talksInFirstDay'] == expected['scheduled'])
        check('star stored locally', stored['stars'] == 1)

        # -- 9a. the event's own logo ---------------------------------------
        # Optional by nature: organisers set one on the Layout page or they do
        # not, and the list must look right either way. Which case this instance
        # is in is read from the payload rather than assumed.
        has_logo = page.evaluate(
            """async (eventId) => {
                const r = await fetch(`/event/${eventId}/block-schedule/grid-data`,
                    {headers: {Accept: 'application/json'}});
                return (await r.json()).event_logo_url ?? null;
            }""",
            args.event,
        )
        page.locator('.tabbar button', has_text='Events').click()
        page.wait_for_selector('.card')
        logos = page.evaluate(
            """() => [...document.querySelectorAll('.card')].map(card => {
                const img = card.querySelector('.ev-logo img');
                return img ? {blob: img.src.startsWith('blob:'), width: img.getBoundingClientRect().width,
                              loaded: img.complete && img.naturalWidth > 0} : null;
            })"""
        )
        if has_logo:
            check('the event logo is shown on its card in the list',
                  logos and logos[0] is not None, str(logos))
            check('it renders from a stored copy, not a live URL',
                  bool(logos[0]) and logos[0]['blob'] and logos[0]['loaded'], str(logos[0]))
        else:
            print('  --   this event has no Layout logo set; checking the empty case instead')
            check('an event with no logo shows nothing at all',
                  logos and logos[0] is None, str(logos))

        # -- 9b. sponsors ---------------------------------------------------
        # A second plugin entirely, and an optional one whose feature is off by
        # default: most events will never have a block. Everything here is
        # conditional on the endpoint answering rather than on it being installed.
        available = page.evaluate(
            "async (id) => (await fetch(`/event/${id}/sponsors/data`)).ok", args.event
        )
        if not available:
            print('  --   the Event Sponsors plugin is not serving this event; skipping')
        else:
            page.goto(f'{app}event/{args.event}', wait_until='networkidle')
            page.wait_for_selector('.sponsors', timeout=10000)
            page.locator('.sponsor-logo img').first.scroll_into_view_if_needed()
            page.wait_for_timeout(800)
            check('a sponsors block is shown', page.locator('.sponsors').count() == 1)
            logos = page.evaluate(
                """() => [...document.querySelectorAll('.sponsor-logo img')].map(i => ({
                    tier: i.closest('.sponsor-tier').dataset.tier,
                    width: i.getBoundingClientRect().width,
                    fromBlob: i.src.startsWith('blob:'),
                }))"""
            )
            check('logos come from stored copies, not live URLs',
                  bool(logos) and all(logo['fromBlob'] for logo in logos), f'{len(logos)} logos')
            widths = {logo['tier']: logo['width'] for logo in logos}
            # The plugin's sizing rule has to survive the trip: a tier at 70
            # against one at 100 draws its logos at seven tenths the width, on a
            # phone exactly as on the printed grid.
            ordered = sorted(widths.values(), reverse=True)
            check('the tier size ratio survives into the app',
                  len(ordered) >= 2 and abs(ordered[1] / ordered[0] - 0.70) < 0.05, str(widths))
            check('a linked sponsor is a link', page.locator('a.sponsor').count() >= 1)
            # Placement is the event manager's choice, made in the plugin. Read
            # what they chose and assert the block is actually there -- rather
            # than assuming a position, which would pass whatever the setting
            # said and test nothing.
            wants_above = page.evaluate(
                "async (id) => ((await (await fetch(`/event/${id}/sponsors/data`)).json())"
                ".template || {}).above_schedule === true",
                args.event,
            )
            geometry = page.evaluate(
                """() => {
                    const block = document.querySelector('.sponsors');
                    const talk = document.querySelector('.talk');
                    return {
                        blocks: document.querySelectorAll('.sponsors').length,
                        above: block.getBoundingClientRect().top + window.scrollY
                               < talk.getBoundingClientRect().top + window.scrollY,
                        className: block.className,
                    };
                }"""
            )
            check('the block renders exactly once', geometry['blocks'] == 1, str(geometry['blocks']))
            check(f'the block sits {"above" if wants_above else "below"} the talks, as configured',
                  geometry['above'] == wants_above, str(geometry))
            stored = page.evaluate(
                """async (eventId) => {
                    const req = indexedDB.open('indico-schedule');
                    const db = await new Promise(res => { req.onsuccess = () => res(req.result); });
                    const rows = await new Promise(res => {
                        const tx = db.transaction('sponsors', 'readonly');
                        const r = tx.objectStore('sponsors').getAll();
                        r.onsuccess = () => res(r.result);
                    });
                    const row = rows.find(r => r.eventId === eventId);
                    return row ? [row.payload.sponsors.length, Object.keys(row.logos).length] : null;
                }""",
                args.event,
            )
            check('sponsors and their logos are stored on the device',
                  bool(stored) and stored[0] >= 1 and stored[1] >= 1, str(stored))

        # -- 10. offline ----------------------------------------------------
        # Snapshot the console before disconnecting: from here on the browser
        # itself logs failed requests, which is the network reporting reality
        # rather than the app misbehaving.
        # A 404 is also a legitimate *answer*: the picker asks every candidate event
        # for its schedule, and an event whose Block Schedule feature is switched off
        # replies 404. The browser logs that as a failed resource load, which is the
        # network narrating, not the app going wrong.
        errors_while_online = [
            e
            for e in errors
            if 'favicon' not in e.lower()
            and not re.search(r'Failed to load resource.*40[34]', e)
        ]
        check('no console errors while online', not errors_while_online, '; '.join(errors_while_online[:3]))
        online_count = len(errors)

        ctx.set_offline(True)

        # The logo is stored as a blob rather than left as a URL precisely so
        # that it survives this: the service worker caches the app shell, and a
        # logo served from elsewhere on the host would not be in it.
        page.goto(app, wait_until='domcontentloaded')
        page.wait_for_selector('.event-card, .card', timeout=15000)
        offline_logo = page.evaluate("""() => {
            const img = document.querySelector('.sitelogo img');
            return img ? {complete: img.complete && img.naturalWidth > 0, blob: img.src.startsWith('blob:')} : null;
        }""")
        check(
            'the logo is there on a cold offline start',
            bool(offline_logo and offline_logo['complete'] and offline_logo['blob']),
            offline_logo,
        )

        page.goto(f'{app}event/{args.event}', wait_until='domcontentloaded')
        page.wait_for_selector('.talk', timeout=15000)
        offline_rows = page.locator('.talk').count()
        check(
            'cold start works offline',
            offline_rows == expected['scheduled'],
            f'{offline_rows} rows with the network disabled',
        )

        if available:
            # Scrolled into view explicitly rather than by wheeling to the
            # bottom: the logos are `loading="lazy"`, so a scroll that stops
            # short leaves them permanently un-started and looking broken.
            page.locator('.sponsor-logo img').first.scroll_into_view_if_needed()
            # Then wait for them rather than sampling once: the blobs become
            # object URLs in an effect that runs after the stored record loads.
            decoded = True
            try:
                page.wait_for_function(
                    "() => { const imgs = [...document.querySelectorAll('.sponsor-logo img')];"
                    " return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0); }",
                    timeout=8000,
                )
            except Exception:
                decoded = False
            count = page.locator('.sponsor-logo img').count()
            check('the sponsors block survives a cold offline start', decoded, f'{count} logos')

        page.locator('.tabbar button', has_text='Search').click()
        page.locator('input[type=search]').fill(term)
        page.wait_for_selector('.resultcount', timeout=5000)
        check(
            'search works offline',
            page.locator('.talk').count() == expected['search_hits'],
            f'{page.locator(".talk").count()} rows offline',
        )
        # -- 11. offline failures stay at the network layer -----------------
        # The only errors the offline run may produce are the browser's own
        # "could not reach the server". Anything else means the app threw
        # instead of falling back to its cached copy.
        unexpected = [
            e
            for e in errors[online_count:]
            if 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to fetch' not in e
        ]
        check('offline produces no app errors', not unexpected, '; '.join(unexpected[:3]))

        ctx.set_offline(False)

        # -- 12. day navigation ---------------------------------------------
        if args.multiday_event:
            check_day_navigation(page, app, args.multiday_event)

        # -- 13. insecure origin --------------------------------------------
        if args.insecure_base:
            check_insecure_origin(browser, f'{args.insecure_base}/schedule-app/', args.event)

        browser.close()

    print()
    if failures:
        print(f'{len(failures)} check(s) failed: {", ".join(failures)}')
        return 1
    print('all checks passed')
    return 0


def check_insecure_origin(browser, app: str, event_id: int) -> None:
    """Over plain http:// to a non-localhost host there is no service worker.

    The app must still work as an ordinary website — and must say why the
    offline and install behaviour is missing, rather than leaving it as a silent
    and very confusing absence.
    """
    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    warnings: list[str] = []
    errors: list[str] = []
    page.on(
        'console',
        lambda m: warnings.append(m.text)
        if m.type == 'warning'
        else errors.append(m.text)
        if m.type == 'error'
        else None,
    )

    page.goto(app, wait_until='networkidle')
    secure = page.evaluate('() => window.isSecureContext')
    has_sw = page.evaluate("() => 'serviceWorker' in navigator")
    check('insecure origin really is insecure', not secure and not has_sw, f'secure={secure}')

    # The reason matters: telling someone to tap an install button that cannot
    # exist on an http:// host is worse than saying nothing.
    warn = page.locator('.install.install-warn')
    check('http:// is named as the reason installation is unavailable', warn.count() == 1)
    if warn.count():
        check('the reason is stated plainly', 'http://' in warn.inner_text(), warn.inner_text()[:80])

    add_event_via_picker(page, event_id, first=True)
    check(
        'app still works without a service worker',
        page.locator('.talk').count() > 0,
        f'{page.locator(".talk").count()} rows',
    )
    check(
        'the missing offline support is explained',
        any('secure context' in w for w in warnings),
        warnings[0] if warnings else '(no warning logged)',
    )
    real = [e for e in errors if 'favicon' not in e.lower()]
    check('no console errors on an insecure origin', not real, '; '.join(real[:2]))
    ctx.close()


def check_day_navigation(page, app: str, event_id: int) -> None:
    """A multi-day event: tabs appear, switching days changes the list, filters survive."""
    page.goto(app, wait_until='networkidle')
    add_event_via_picker(page, event_id)

    per_day = page.evaluate(
        """async (eventId) => {
            const first = await (await fetch(`/event/${eventId}/block-schedule/grid-data`,
                {headers: {Accept: 'application/json'}})).json();
            const counts = {};
            for (const day of first.event_days) {
                const d = await (await fetch(
                    `/event/${eventId}/block-schedule/grid-data?day=${day}`,
                    {headers: {Accept: 'application/json'}})).json();
                counts[day] = d.scheduled_contributions.length;
            }
            return {days: first.event_days, counts, trackId: first.tracks[0].id};
        }""",
        event_id,
    )
    days = per_day['days']

    tabs = page.locator('.daytabs button').count()
    check('day tabs appear for a multi-day event', tabs == len(days), f'{tabs} tabs vs {len(days)} days')

    first_day = days[0]
    check(
        'first day renders its own talks',
        page.locator('.talk').count() == per_day['counts'][first_day],
        f'{page.locator(".talk").count()} rows vs {per_day["counts"][first_day]}',
    )

    # Every remaining day, so a bug on day 3 is not hidden by day 2 passing.
    for day in days[1:]:
        page.locator('.daytabs button').nth(days.index(day)).click()
        page.wait_for_url(f'**/event/{event_id}/{day}**', timeout=10000)
        page.wait_for_selector('.talk')
        rows = page.locator('.talk').count()
        check(f'day {day} renders its own talks', rows == per_day['counts'][day], f'{rows} rows')

    # Switching day must carry the filter across — otherwise "the 9th floor
    # schedule" silently becomes "everything" the moment you look at tomorrow.
    page.goto(f'{app}event/{event_id}/{days[0]}?tracks={per_day["trackId"]}', wait_until='networkidle')
    page.wait_for_selector('.talk')
    page.locator('.daytabs button').nth(1).click()
    page.wait_for_selector('.talk')
    check(
        'filters survive a day change',
        f'tracks={per_day["trackId"]}' in page.url,
        page.url,
    )


def _is_dark(css_colour: str) -> bool:
    """Rough luminance test on a computed `rgb(...)`/`rgba(...)` value."""
    numbers = [float(n) for n in re.findall(r'[\d.]+', css_colour)][:3]
    if len(numbers) < 3:
        return False
    r, g, b = numbers
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5


def events_with_schedules(page) -> list[str]:
    """The titles that *should* be on offer, computed without asking the app.

    Reads the same root-category listing the picker browses, then asks each
    event for its block schedule — which is exactly the question the app cannot
    get answered any other way.
    """
    return page.evaluate(
        """async () => {
            const params = new URLSearchParams(
                {from: '-365d', to: '730d', limit: '200', pretty: 'no'});
            const listing = await fetch(`/export/categ/0.json?${params}`,
                {headers: {Accept: 'application/json'}});
            const events = (await listing.json()).results ?? [];
            const withSchedules = [];
            for (const event of events) {
                const r = await fetch(`/event/${event.id}/block-schedule/grid-data`,
                    {headers: {Accept: 'application/json'}});
                if (!r.ok) continue;
                const data = await r.json();
                if (data.columns.length > 0) withSchedules.push(data.event_title);
            }
            return withSchedules;
        }"""
    )


def add_event_via_picker(page, event_id: int, first: bool = False) -> str:
    """Add an event the way a user does: open the picker, search, tap it.

    Returns the event's title. `first` distinguishes the empty-state button from
    the one below an existing list.
    """
    title = event_title(page, event_id)
    label = 'Add an event' if first else 'Add event'
    page.get_by_role('button', name=label, exact=True).click()
    page.wait_for_selector('.sheet')
    page.wait_for_selector('.event-option', timeout=30000)
    page.locator('.sheet input[type=search]').fill(title[:18])
    # Search results are checked for a block schedule before they appear.
    page.locator('.event-option', has_text=title[:18]).first.wait_for(timeout=30000)
    page.locator('.event-option', has_text=title[:18]).first.click()
    page.wait_for_url(f'**/schedule-app/event/{event_id}**', timeout=15000)
    page.wait_for_selector('.talk', timeout=15000)
    return title


def event_title(page, event_id: int) -> str:
    """The event's real title, so the picker can be driven the way a user would.

    Read from the core export API rather than from the plugin's own endpoint,
    because an event without a block schedule -- exactly the case this is used
    for -- may have the plugin's feature switched off, and then that endpoint
    404s and has no title to give.
    """
    return page.evaluate(
        """async (eventId) => {
            const r = await fetch(`/export/event/${eventId}.json?pretty=no`,
                {headers: {Accept: 'application/json'}});
            return ((await r.json()).results ?? [])[0]?.title ?? '';
        }""",
        event_id,
    )


def fetch_payload_counts(page, event_id: int) -> dict:
    """Derive the expected numbers from the payload itself, not from constants."""
    return page.evaluate(
        """async (eventId) => {
            const r = await fetch(`/event/${eventId}/block-schedule/grid-data`, {
                headers: {Accept: 'application/json'},
            });
            const d = await r.json();
            const perGroup = d.groups.map(g => {
                const rooms = new Set(g.column_ids);
                return {
                    id: g.id,
                    title: g.title,
                    talks: d.scheduled_contributions.filter(c => rooms.has(c.column_id)).length,
                };
            }).filter(g => g.talks > 0);

            // Pick a track that shares a room with another track, so the
            // greying-out behaviour is genuinely exercised rather than
            // trivially satisfied.
            const roomTracks = new Map();
            for (const c of d.scheduled_contributions) {
                if (!roomTracks.has(c.column_id)) roomTracks.set(c.column_id, new Set());
                roomTracks.get(c.column_id).add(c.track_id);
            }
            const mixed = [...roomTracks.values()].find(s => s.size > 1);
            const trackId = mixed ? [...mixed][0] : d.tracks[0].id;

            // Pick the commonest longish word in the titles, so the search
            // check exercises many rows rather than trivially matching one.
            const frequency = new Map();
            for (const c of d.scheduled_contributions) {
                for (const word of new Set(c.title.toLowerCase().match(/[a-z]{6,}/g) || [])) {
                    frequency.set(word, (frequency.get(word) || 0) + 1);
                }
            }
            const term = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'a';
            const hits = d.scheduled_contributions.filter(c =>
                [c.title, c.people.join(' '), c.track_name || '', c.session_name || '']
                    .join(' ')
                    .toLowerCase()
                    .includes(term.toLowerCase())
            ).length;

            return {
                scheduled: d.scheduled_contributions.length,
                columns: d.columns.length,
                groups: perGroup,
                track_id: trackId,
                search_term: term,
                search_hits: hits,
            };
        }""",
        event_id,
    )


if __name__ == '__main__':
    sys.exit(main())
