# Changelog

All notable changes to the schedule app are documented here.

The app is not versioned or released separately: it is built and copied to
whatever host serves it, and every build stamps its own id into
`asset-manifest.json` and the service worker's cache name. Entries below are
grouped by the round of work that produced them.

## [Unreleased]

### Fixed — external review round (2026-08-19)
- **Signed-out requests are recognised as such.** Every request now carries
  `X-Requested-With: XMLHttpRequest`, which is what Indico's error handlers
  actually check before answering in JSON — `Accept` alone got a redirect to
  the login page, a 200 with HTML, and the real status was lost. A redirect
  that lands on `/login` anyway is classified as an authentication refusal,
  belt and braces.
- **Events whose dates moved now recover.** A refresh used to ask for the
  first *cached* day, and once the server no longer had that day the 400 made
  every refresh fail forever — the day list is only corrected by a refresh
  that succeeds. The first request now asks for the server's default day,
  whose answer is always valid and carries the current day list; a 400 on a
  later day (dates moved mid-refresh) is retried once with no day named.
  Cached days the server no longer lists are pruned, in the same spirit.
- **Requests get a deadline.** A network that accepts TCP and then goes silent
  — the standard conference-hotel failure — left a fetch pending forever.
  Fifteen seconds via `AbortSignal.timeout`, feature-detected, and a timeout
  wears the same words as being offline, because to the user it is.
- **Storage failures get their own words.** IndexedDB refusing to read —
  private browsing, Lockdown Mode, a full disk — used to fall through to the
  empty states, and "No events yet" invites re-adding everything into a store
  that cannot hold it. Reads that fail now surface a storage error screen
  naming the likely causes, on the library, the schedule, the agenda and
  search alike.
- **A failed schedule check is no longer recorded as "no schedule".** Only a
  real HTTP answer earns a persisted probe verdict; a dropped connection or a
  500 says nothing about the event, and writing "no" for it hid conferences
  from the picker for a day over one bad wifi moment. The picker now says it
  could not check and offers to ask again.
- **A failed event listing is no longer an empty one.** Category browsing and
  event search report failure as a value, so the picker can say "could not
  load" with a retry instead of "no events here" — and only a 404 or 422,
  which genuinely are answers, still read as empty.
- **Overlapping refreshes collapse into one.** `syncEvent` is reachable from
  startup, pull-to-refresh, several buttons and `addEvent`; one in-flight
  promise per event id keeps a failing run from writing its stale snapshot
  over a succeeding run's fresh one — and the error path re-reads the event
  before writing, for the same reason.
- **The unstarred star is visible.** It sat at the hairline colour and
  disappeared on a phone outdoors; it is `--muted` now, and the filled star's
  light-mode amber is darkened to clear 3:1 on white — it is a control, not
  decoration.
- **The service worker precaches past the HTTP cache.** The shell URL is the
  one precached entry that is not content-hashed, and a heuristically-fresh
  stale copy would pin the new cache to assets the deploy just deleted — a
  blank app that cannot self-heal. `cache: 'reload'` on every precache
  request.

### Changed — external review round (2026-08-19)
- **A star tap repaints one row, not the list.** The revision counter became
  named channels — a hook that reads stars only hears about stars — and
  `TalkRow` is memoised with identity-stable callbacks, with the same memo
  boundary around each search result.
- **Search stays responsive on broad queries.** The day payloads are loaded
  once per data change instead of once per keystroke, the scan runs against a
  deferred query so typing repaints the input at full speed, and results are
  capped at 100 with the count line saying so — a query needing more of the
  list really needs more letters.
- **Refreshes download less.** The abstracts export — the heaviest fetch the
  app makes — is skipped when the schedule is unchanged and the stored copy is
  under six hours old; an event whose last day has passed is left alone by the
  bulk refresh for a day at a time, though its own Refresh control always
  works.
- **Sheets behave like modals.** Opening one pushes a history entry, so
  Android's back gesture closes the sheet instead of leaving the app; Escape
  and the scrim funnel through the same path, focus moves into the dialog and
  back to the opener, and the app behind the scrim is `inert`.
- **Talk rows are two real buttons.** A row that was itself a `role="button"`
  read to assistive tech as one leaf control with the star — and its pressed
  state — swallowed. The text is now an open button whose overlay keeps the
  whole card tappable, with the star a reachable sibling above it.
- **Day tabs and the filter row stay pinned** while a long day scrolls — the
  scroll container is not the document, so not even iOS's tap-the-status-bar
  gesture brought them back — and the time headings pin just below the
  measured header. Small touch targets (chips, day tabs, banner and
  breadcrumb buttons) come up to 44px.
- **Removing an event removes all of it**: sponsors and probe verdicts go
  with the cached days and stars, and days the server no longer lists are
  pruned on refresh rather than surfacing stale talks in search forever.
- **The install sheet subscribes to install state** instead of sampling it
  once — on Android Chrome `beforeinstallprompt` lands after mount, and the
  sheet is one-shot, so a too-early snapshot lost the one platform with a
  real install dialog.
- **The system chrome matches the app bar.** `theme-color` in both schemes
  now names the app bar's own surface, so the status bar continues the first
  painted frame instead of flashing a third colour.

### Added — external review round (2026-08-19)
- **A version row in Settings** showing the deployed build's id — the thing to
  quote in a bug report — and **a "new version is ready" banner** with a
  Reload button when a newer build has installed behind the running one, which
  is otherwise indistinguishable from nothing happening.

### Changed
- **Licensed AGPL-3.0-or-later**, with the full text in `LICENSE`. Previously
  `package.json` declared MIT and there was no licence file at all, which reads
  as unlicensed to GitHub and to most tooling. The AGPL rather than the GPL
  because this is a thing people run and reach over a network rather than a
  thing they install — its section 13 is the part that matters here.

### Added (2026-08-18)
- **A sponsor's logo on the talks it sponsors**, small in the lower right of the
  row, on the schedule, the agenda and in search results. Drawn from the stored
  copy like everything else, so it is there offline. Where several sponsors are
  attached to one talk only the first is marked — a row is a row, and the
  sponsors block is where they are all listed.

### Changed (2026-08-18)
- **Both the start and the finish time** are shown on every talk, on the
  schedule and on My agenda. The time heading groups talks by when they begin
  and cannot say when each one ends, because talks starting together do not
  finish together.

### Fixed (2026-08-18)
- **Sponsor logos on a row now share a line.** Each is drawn into a box of the
  same shape with the artwork fitted inside it, standing on the floor, so a row
  of mixed proportions reads as a row. Fitted, never cropped or stretched.
- **The template's "largest logo width" had no effect in the app.** The width
  was normalised away and replaced with a constant, so the setting looked like
  it worked and did nothing here. It is now used exactly as the server computes
  it — and the width goes on the sponsor card rather than on the logo inside it,
  because a percentage resolves against the parent's content box and the card is
  sized by its own contents.

### Added — sponsors and event logos (2026-08-18)
- **Sponsors** on the schedule screen, from the Event Sponsors plugin. The
  per-tier field choices arrive from the server already resolved onto each
  sponsor, so the app renders what the event manager configured rather than
  reimplementing the plugin's matrix and drifting from it.
- Sponsor logos are stored as blobs, not URLs: a logo held only as a URL is a
  logo that vanishes the moment the phone loses signal, which is the one
  condition this app exists for.
- The plugin's sizing rule survives the trip — a tier at 70 against one at 100
  draws its logos at seven tenths the width, on a phone exactly as on the
  printed grid.
- A `list` template stacks its sponsors one per row unless the tier is marked
  "display inline", matching what the plugin does on the page.
- The block sits **above or below the day's talks**, as a switch in the plugin
  decides. Above means above the schedule content but below the day tabs and
  the filter controls, which are navigation and belong where the thumb expects
  them.
- **Each event's own logo** on its card in the library, from Indico's Layout
  page. Re-downloaded only when its address changes — the URL carries the
  image's hash — and simply absent when no logo is set: no placeholder, no
  reserved space.
- Sponsors are entirely optional and entirely silent. A site without the
  plugin, an event that never enabled it, and a failed request are one
  situation from here, and none of them is worth an error on a screen somebody
  opened to find out where their next talk is.

### Added — agenda and colours (2026-08-18)
- **Clashes are drawn as a group**: starred talks that overlap are wrapped in
  one bordered box headed with the window they collide in and how many talks
  are involved. The previous marker said a clash existed; the box says which
  talks it is between, which is the question the feature is for. Clusters are
  transitive, so a three-way pile-up is one box.
- **Finished talks are hidden** on the agenda behind a `Show finished (N)`
  button, and come back dimmed. An agenda is consulted to find out where to go
  next; by day three most of it is history.
- Judged against the device's clock, because the payload gives times as the
  event's own wall clock with no zone attached. At the conference those are the
  same clock — which is why finished talks are hidden rather than dropped.
- **Real track colours**: the track stripe and pill take the colour the event
  manager chose, falling back to the generated palette where none is set, using
  the same black-or-white contrast rule as the plugin.

### Added — event picker and branding (2026-08-15)
- The picker offers **only events that have a block schedule**. Nothing in
  Indico advertises this, so each candidate is asked one at a time, three
  requests in flight, in batches, with every answer stored so an event is asked
  about once. The same rule is enforced when adding by id, so nothing can slip
  past it.
- **The organisation's logo** on the top screen, read once a week from the
  `<img class="header-logo">` in Indico's page header and kept as a blob so it
  survives a cold offline start. It is also *measured*: Indico's own default
  logo is solid white, which on a pale background is indistinguishable from no
  logo, so light artwork gets a dark plate behind it.

### Added — first build (2026-08-14)
- Installable offline-first PWA over the Block Schedule plugin's `grid-data`
  endpoint. Renders from IndexedDB always; the network only updates the store,
  which is what makes offline an ordinary state rather than a special case.
- Event library, day navigation, a time-ordered agenda, room/group/track
  filtering that reuses the plugin's own rules and URL parameters, local
  full-text search, talk detail with abstracts and affiliations, and a personal
  agenda of starred talks.
- Refresh happens once at startup and otherwise only when asked. There is no
  background timer: a schedule changes a handful of times over a conference,
  and on iOS a background timer would not run anyway.
- Starred talks live on this device only, and the app says so rather than
  letting anyone assume their agenda is on the server. Indico 3.3.12 has
  nowhere to keep a per-user starred contribution.
- Install guidance raised once, with the instruction that actually applies:
  Chrome's native dialog, Safari's Share menu on iOS, and an explicit
  explanation on an insecure origin, where service workers do not exist and so
  neither does offline start or installation.
