# Changelog

All notable changes to the schedule app are documented here.

The app is not versioned or released separately: it is built and copied to
whatever host serves it, and every build stamps its own id into
`asset-manifest.json` and the service worker's cache name. Entries below are
grouped by the round of work that produced them.

## [Unreleased]

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
