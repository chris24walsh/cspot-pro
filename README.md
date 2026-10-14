# cspot-pro

Website visual-editor sign-in is specified in
[`docs/website-editor-sso.md`](docs/website-editor-sso.md).

## Service outlines and section settings

The icon beside Sections opens the service template picker. New services prefer
the scheduled weekday template, then a matching weekday name or Midweek Meeting.
Create a template there, apply it, and populate it with section templates from
any service type. New sections are kept in the current template by default.

Section and item settings use compact expandable groups for visuals, timing,
audio, overlays and media. Existing edits default to this service only; select
“Save configuration to template” to evolve that service's template. The overlay
editor has a 25–200% font-size control in 1% steps. Timed Welcome cues use the
same control for their built-in message and clock, with one text layer. Present
marks the section after Pre-service as the service start; Welcome countdowns can
target that start or a clock time, with a maximum duration. Template sections can
be reordered in Present, and imported sections sharing a position are separated.
The Sunday template keeps Pre-service and Welcome as separate sections.
The outline picker can also save the current structure and order. Songs, uploads and dated
announcement details are not copied by that action. Backing audio uses inline
YouTube search, continues through section items, and can fade at a marked item.
Automated section starts use the service date and the configured church timezone;
manual presenter control continues to take precedence over the scheduler.

Modern reimplementation of c-SPOT, the church service online planning tool.

This repository is intentionally separate from the legacy Laravel application in
`../cspot`. The old project remains the reference for behaviour, data model, and
migration planning; this project starts clean with a container-first stack.

## Stack

- Backend: Python, FastAPI, Pydantic settings
- Frontend: React, TypeScript, Vite
- Database: PostgreSQL
- Runtime: Docker Compose for local development
- Auth: cookie-based sessions with backend-enforced RBAC
- Tests: pytest for backend, browser tests to follow once flows exist

## Live audio

CSpot can take live and recorded service audio from the portable
[CSpot Audio Bridge](audio-bridge/README.md), with independent USB microphone
and mixing-desk inputs on Windows or Raspberry Pi. A Windows playback-loopback
or virtual-cable source can add church-PC media to the server-side source mix.
Five presentation-aware scenes keep Pastor, Congregation, and Worship on the
desk/room feeds while Media and Pre-service use the direct media feed as a
mix-minus, excluding the desk return and room microphone. That avoids sending
the same PC playback both directly and back through the desk, and makes the
media route independent of the desk's audio signal. The bridge only captures a
Windows endpoint: a browser or other designated player must still render audio
to that endpoint. Song backing tracks deliberately remain on the Worship/desk
route so the livestream keeps the live musicians and vocals and receives the
PC track once through the desk return; standalone video uses the direct Media
route.

Configured pre- and post-service music is rendered only by the dedicated /app/media receiver and captured into the selected remote program-audio route. Livestream viewers and slideshow displays never render their own local copy, so every listener hears the same source and timeline. The original
[single-input Pi/Icecast setup](docs/raspberry-pi-live-audio.md) remains
supported. Independent HTTP/MP3 inputs are normalized to AAC by go2rtc for the
same fragmented-MP4 MSE/HLS browser transport used by camera audio. Real
multi-input or gain-adjusted mixes use an authenticated 200 ms fragmented-AAC
stream with a bounded browser buffer and MP3 fallback; the raw relay remains
available for compatibility and recording.

## Network TV display

The live slideshow can run directly in a
[church TV's native browser](docs/tv-browser-display.md), following a presenter
over the server without an HDMI cable or extended desktop. Use the short
`/app/tv` production route; public HTTP visits are upgraded to HTTPS. Once the
presenter selects **Start**, the TV output remains active until a presenter
stops it or starts another service. Only one service can be live system-wide,
including historical services started for a replay. Explicitly started services
remain live without output heartbeats; legacy heartbeat-only and unclaimed
past-service sessions still expire.

Song editing includes inline YouTube search under Details. Preview a result in
the popup, choose **Use this video**, then save the song to keep its YouTube link.
Search uses the same shared Google integration as service video search.

## Local Development

Copy the environment file:

```bash
cp .env.example .env
```

Start the stack:

```bash
docker compose up --build
```

If your Docker install uses the older standalone Compose command, use:

```bash
docker-compose up --build
```

Older `docker-compose` 1.x can throw a Python `KeyError: 'id'` from its attached
log watcher even while the containers keep running normally. If you see that,
use detached mode and follow logs separately:

```bash
docker-compose up --build -d
docker-compose logs -f api web
```

`docker-compose` 1.x can also throw `KeyError: 'ContainerConfig'` when recreating
containers with newer Docker image metadata. The best fix is to install/use
Compose v2 (`docker compose`). If you must stay on Compose v1, recreate the app
containers without deleting volumes:

```bash
sudo docker-compose up --build --force-recreate
```

Avoid `docker-compose down -v` unless you intentionally want to delete the local
database volume.

If Compose v2 is installed as a user-level plugin but your user cannot access
the Docker socket yet, start the app with:

```bash
sudo ./scripts/start-app.sh
```

This runs `up --build -d` and does not delete volumes.

On startup, the API container runs database migrations, seeds reference data, and then
starts FastAPI.

Fresh installs now use first-admin bootstrap instead of a shared demo password.
Open the web app, create the first administrator account, and then invite the
rest of the team from the Admin screen.

For the current frontend wireframe only:

```bash
npm install
npm run dev
```

Services:

- API: http://localhost:8000
- API docs: http://localhost:8000/docs
- Web app: http://localhost:5173
- Postgres: localhost:5432

## Church Windows Deployment

For the simplest real-world deployment right now, run `cspot-pro` directly on
the church Windows PC with Docker Desktop.

See:

- [docs/windows-church-deployment.md](docs/windows-church-deployment.md)

Key files:

- `docker-compose.church.yml`
- `.env.church.example`
- `scripts/start-church.ps1`
- `scripts/update-church.ps1`
- `scripts/stop-church.ps1`

## Home Tailscale Deployment

For the best first shared-host setup, run `cspot-pro` on an always-on home
machine and publish it privately with Tailscale Serve.

See:

- [docs/tailscale-home-deployment.md](docs/tailscale-home-deployment.md)

Key files:

- `docker-compose.tailscale.yml`
- `.env.tailscale.example`

## Nginx Proxy Manager Deployment

If you already run a Docker VM and expose apps through Nginx Proxy Manager,
`cspot-pro` can also be deployed that way behind your normal domain/subdomain.

See:

- [docs/nginx-proxy-manager-deployment.md](docs/nginx-proxy-manager-deployment.md)

Key files:

- `docker-compose.npm.yml`
- `.env.npm.example`

## Public Website

The Listowel Christian Fellowship public website is kept in a separate private
repository so church-specific content and images do not have to live in this
open-source app repository.

Private website repo:

- <https://github.com/chris24walsh/lcf-website>

`cspot-pro` still exposes the generic site-content API used by the private site
for logged-in admin editing:

- `GET /api/v1/site/content`
- `GET /api/v1/site/content/admin`
- `PATCH /api/v1/site/content/{key}`

When building the member app, set `VITE_PUBLIC_WEBSITE_URL` to the public site
URL if the Website shortcut should link back there, for example:

```bash
VITE_PUBLIC_WEBSITE_URL=https://lcf.walsh.qzz.io
```

Pull requests are checked automatically. For production-like testing from a
remote device, use the isolated Tailscale sandbox described in
[docs/collaboration-and-sandbox.md](docs/collaboration-and-sandbox.md).

Run the checks:

```bash
npm run check
docker compose run --rm api pytest
```

## Project Layout

```text
backend/     FastAPI app, domain modules, backend tests
frontend/    React app
docs/        decision records and architecture notes
docker/      shared container/database setup
```

## Current Build Shape

The first scaffold covers the major legacy c-SPOT domains:

- `identity`: users, roles, permissions, social login records
- `planning`: plans, running-order items, defaults, notes, history, caches
- `music`: songs, lyrics, chords, song parts, OnSong sections
- `people`: instruments, team assignments, availability/confirmation
- `library`: resources, files, file categories, Bible data
- `presentation`: presenter sessions and sync position
- `communication`: message threads, participants, reminders/notifications
- `imports`: review-first content and lyrics import workflows
- `sunday_school`: lesson runner with an autosaved teacher board, one live classroom session, a permanent room TV, a combined memory verse game and teacher-paced interactive stories

See [docs/legacy-feature-map.md](docs/legacy-feature-map.md) for the rebuild
coverage map. For durable product and architecture context, also see:

- [docs/project-context.md](docs/project-context.md)
- [docs/current-architecture.md](docs/current-architecture.md)
- [docs/security-todo.md](docs/security-todo.md)
- [AGENTS.md](AGENTS.md)

The first persistent slice is now in place for:

- plan types
- plans
- running-order plan items
- songs
- song parts
- users and roles
- team assignments and instruments
- resources and plan resource assignments
- messages and replies
- manual lyrics import
- Bible version/book/passage lookup

The frontend reads those live API endpoints when FastAPI is available and falls
back to the static wireframe data when it is not.

## Working Screens

- Service: use an endlessly extending, month-grouped all-days timeline (or switch to a compact Sunday-only timeline), and use the adjacent arrows to move between actual planned-service dates rather than fixed weekly offsets. Every selected date opens immediately as an empty durable plan: Sundays default to Sunday Service and other days to Midweek Meeting. The applicable outline is added only with the first explicit set, deck, or content item. Archiving preserves the date slot by replacing its content with a fresh empty plan, with Undo still available. The compact type control on an existing service can correct its type while preserving content and adding missing sections. Administrators manage service types in the dedicated Service templates tab, including nested default items and one automated template start. Template items and direct service editors share visual, timing, overlay, scene, and destination settings; administrator-only controls can promote reusable defaults. A section can auto-contract its items or end the service after its final timed slide. Outline sections are compact colour-coded containers which can contain several named, locally reorderable items such as sermon decks, announcement images, videos, or decks; groups reorder only among groups. Each child item is independently expandable in the rail and sorter. Section and item pencils open scoped native editors: section images act as fallback content only while no children exist, songs route to the song editor, Welcome/Open time support timed overlays and montage controls, Announcements store structured event details, and sermon decks expose presentation-safe fit/transition controls. One group-level add button opens the item dialog, defaults Sermon and Announcements to Slide Deck, and includes an Images tab for creating one sortable item from one or more uploaded images. Presenters cannot move or remove template outline groups. The seeded Sunday template runs a 25-minute Welcome montage and five-minute countdown before selecting Please be seated, with no separate automation clock for each cue. Returning to the montage preserves its original countdown; each entry to the final countdown starts a fresh five minutes, capped by the original deadline, and advances to Please be seated at zero. Countdown and auto-advance controls live together under Timing. Its Post-service montage selects a room-enabled ambiance scene. The Start menu lets operators set the selected service's actual start time and shows the pre-service start calculated from its timed Welcome cues, alongside manual slideshow options.
- Edit history uses the same interaction in Service, Worship, and Sunday School: selecting the body of a version restores that complete point in time after confirmation, while the separate Undo change action reverses only that entry and preserves unrelated later edits. Song edits store field-level snapshots for per-change undo. Worship history also keeps reusable stashed sets: stashing archives the current list and leaves its date empty, while applying first stashes the current list and then copies the selected stash into that date.
- Worship and Sunday School: Sunday cards show compact plan/lesson summaries and use capacity-aware leader rotations for current and future dates, while historical assignments remain unchanged; assignment and upcoming-Sunday swaps stay behind the compact Leader control, and the `cspot_tablet` account remains available for manual worship assignment but is excluded from automatic rotation
- Songs: create/edit/archive songs, import and clean lyrics, edit details/chords, and prepare song slides
- Broadcast: viewer-first remote service page plus admin tabs for sermon recordings, low-latency multi-camera livestream settings, and shared mixer-desk integration; admins can blend independent audio sources with per-feed trim/mute controls and presentation-aware Pastor, Congregation, Worship, Media, and Pre-service scenes shared by livestream and recording, start a public or admin-only test livestream, and operate synchronized slides, per-camera service-aware dwell timing, automatic stream recovery, holding messages, and pre-service audio. The Livestream tab shows signed-in viewers who are watching now and per-user watch time for current and previous streams. An open TV or livestream viewer activates scheduled pre-service at 10:30 without starting the main slideshow; starting or stopping the slideshow keeps the currently selected slide visible rather than blanking the output.
- Admin: share an optional self-registration link/QR code, approve or reject inactive registration requests, invite users, send password resets, manage grouped roles and rotation eligibility, configure Google Drive, and test SMTP email

## Access Control

`cspot-pro` now supports:

- first-admin bootstrap for empty installs
- password login
- invite-based account setup with one-time links
- forgot-password email reset links
- cookie-backed sessions that work with presenter/live-output windows
- backend-enforced permissions for read, edit, create, and admin actions

Public hosting should still set a strong `AUTH_SECRET_KEY`, run behind HTTPS,
turn on secure cookies, and configure `PUBLIC_APP_URL` so invite/reset links
point back to the correct host. SMTP is optional but recommended; Brevo,
Mailtrap, or any normal SMTP relay can be used.

## Reference Project

Legacy clone:

```text
../cspot
```

Current legacy stack summary:

- Laravel/PHP application
- Blade-rendered views
- MySQL/MariaDB data store
- Bootstrap-era frontend
- Existing Dockerfile based on Ubuntu 16.04/LAMP
- Core domains: users, roles, plans, plan items, songs, teams, resources, files,
  Bible passages, messages, presentation sync, and OnSong support

## Initial Product Goals

- Plan church services, events, running orders, teams, resources, songs, notes,
  lyrics, chords, files, and presentation views.
- Keep the system portable through containers and reproducible local
  development.
- Make future features easy to add through clear module boundaries.
- Improve visual design, responsiveness, accessibility, and perceived
  performance.
- Support safe import workflows for song metadata and lyrics, with source
  provenance and licensing/status recorded alongside imported content.

New recordings and trimmed copies are hidden from non-admins until a broadcast admin
selects **Publish recording** after reviewing and trimming them. **Unpublish recording**
hides them again and revokes public links. Existing completed recordings remain visible.
Publishing for signed-in viewers does not create a public link; making a recording public
also publishes it for signed-in viewers. Playback and download endpoints enforce visibility.

Each recording has one share/download menu for a compatible MP3 audio export, synchronized MP4 export,
and admin-controlled public access. Public recordings are opt-in and available
only through a random individual link; removing public access revokes that link.
The public page plays the original audio with its synchronized slide images and
does not require an account. Recordings are named from the sermon deck, with the
recorded timestamp shown as secondary information. Admins can set a custom name
or clear it to restore the deck-derived name; public links use the current name.
The archive action revokes public access and hides the recording from the current
list. Admins can filter, play, download, and restore archived recordings. Archived
media is permanently cleaned up after one year.

The sermon player includes a full-width seek bar, ±30-second skips, playback speed,
and volume controls. Broadcast admins can select start/end times, mark the current
playhead, preview the selection or its final five seconds, and either replace the
original or save a separate copy. The trim endpoint requires `broadcast:use`, validates
against the audio duration, and retains compact mono Opus at 48 kbps. Replacement
uses a temporary backup and restores the original if media or database work fails. Slide
snapshots are retained and timings are rebased; `trimmed-sermon` copies contain
actual slide display times, so the player does not apply its camera delay again.

Song library search combines text with immediately applied Key, Theme and Source
filters, a matching-song count, and Clear all. Options come from saved library
metadata, including missing-value choices. Themes use comma-separated categories;
sources group book references without song numbers. Key uses the saved sounding
key (or derives it from the capo key and position), and is shown in library rows.
In the song editor Chords tab, switch off the transpose icon beside Key and Capo
to correct the saved key while preserving chord symbols and positions.
The capo stays unchanged and its derived key follows the corrected song key.
Chord controls sit beside the editor tabs on desktop and directly below on mobile.

The Rhythm button in the Chords tab opens meter and strumming guidance without
using permanent chord-panel space. Select a common meter (or a custom count and
beat unit), choose a meter-matched preset, and click strokes to cycle through down,
up, rest and muted strokes. Whole-song patterns can have verse, chorus and bridge
variations, with optional feel notes. Save the song to keep the guidance. Musician
view shows the meter and current section's pattern beside the key; click it for
beat counts, all patterns and notes. Rhythm guidance is optional. Meter and strum strokes stay unchanged when the key
or capo changes.
Custom meters and named strums can be saved to the shared library and selected
in other songs. Saved strums select their associated meter and are copied into
the song, so later edits do not change the shared preset. Library writes require
song edit/create permission; all players with song read access can use them.

Listen strum previews the selected pattern over a chosen chord. Bars & chords
stores an optional chart for the whole song or a named lyric part such as V1 or C.
Use `C | Am | F G | C *2`: bars are separated by pipes or new lines, multiple
chords divide a bar evenly, and `*2` repeats a bar. `C@1 G@3` gives exact change
counts; counts use the written meter unit (eighth notes in 6/8). Starting from
existing song chords places one chord per bar for the user to refine.
Listen chart/part combines those chords with the matching strum. Listen song
uses the whole-song chart when present; otherwise it follows the lyric sequence
and requires a chart for every part. Without a section strum, the default strum
applies, or one downstroke per main beat if no default exists.
Practice controls offer BPM, count-in, metronome, loop and a real `.mid` download.
6/8 and 12/8 BPM uses the dotted-quarter pulse. Audio is synthesized practice
sound rather than a recording. Playback stops on close, edits or navigation.
Transposing a song key also transposes its bar-chart chord symbols; metadata-only
key corrections preserve them. Musician previews follow the selected sounding key.
The chord/bar mode switch beside the tabs changes what clicking and dragging in
this same lyric grid does. Chords mode edits and moves chord symbols. Bars mode
adds a boundary immediately on click, moves it by dragging, and removes it by
clicking it again. Existing chords remain visible and their positions are kept.
Markers are saved with rhythm metadata using section-relative lyric anchors.
They generate the marked part's playback chart: chord changes within a bar divide
its time evenly, and empty later bars hold the previous chord. Unmarked parts keep
manual charts. Marked lyric parts use the same timing map for playback and MIDI;
unmarked songs retain the whole-song/part chart workflow. Fuller chord voicings,
brighter harmonics and sustained envelopes make chord quality audible.
Worship Live's **Musician** menu (guitar icon) groups Chords, Bars, Rhythm,
and page/scroll view. Edit song is directly on the toolbar. Bars and guided
practice remain admin-only for now;
Dynamics is shown as unavailable until annotations exist. A compact **Play**
dropdown selects Metronome, MIDI strum, or Backing track; active playback becomes
a direct Stop button. In Worship Live, guided playback starts at the first bar
on the selected slide, then continues through the song. Opening bars remain silent
until the first annotated chord change; chords before the playback starting point
are not inherited. Metronome clicks begin one bar before that first change. Opening
rests supply the lead-in, so only any missing preparation time is added.
The selected sequence occurrence is preserved, including repeated verses.
A slide needs a bar boundary to start guided playback there. Backing track keeps existing service-audio permissions and requires Sync.
Menus support keyboard navigation, Escape and outside-click dismissal.
**Silent guide** starts from the current slide without sound or count-in, showing
the dot and turning pages. **Musician → Chords / Bars / Dot** each has Auto, On
and Off choices. Auto keeps chords visible and shows bars/dot while playing
(including shared timing). On stays visible while idle, playing and stopped;
Off stays hidden through playback changes. An always-on dot parks at its last
position on the current page, or at that page's first bar before playback.
For other Worship Live devices, enable **Share timing** on the admin playback
host and **Follow shared timing** on each receiving device. Followers get the dot
and local page turns without audio or duplicate service commands. Display modes
and following are remembered per device; sharing is opt-in for the current session.
Sharing works with silent, metronome and MIDI guidance. Only the playback host
advances the synced service display. Shared timing expires when the host disconnects;
congregation/display screens do not receive the dot. A bouncing dot follows the lyrics using the audio clock.
Pages turn at their first bar. When synced, the service display advances too;
with Sync off, page turns stay local.
Place boundaries in each sequenced part to enable the whole-song timing guide.
After the first annotated change has played, empty bars carry the last played chord,
including across parts and repeats.
Before any chord has played, they use metronome-only playback.
The editor uses the same guide and source anchors. Lyrics retain normal character
and word spacing when chords or bars move, including while Music is hidden.
The dot varies its speed between anchors to follow musical time without stretching text.
Pages resolve chords and timing by section, sequence occurrence and source line
range, so identical lyric pages retain their own chords and active timing dot.
Overlays occupy existing lyric/chord rows; the positional framework can also host
future dynamics and player directions.


Sermon recording follows the live service session, including scheduled services
without a separate output window. Short automatic captures remain recoverable
in Archived recordings; automatic grace trimming first preserves the full audio
and slide metadata under `storage/recordings/recovery/`.
Interrupted recordings are reconciled after an API restart; available capture
segments are recovered while their original files are retained.

Production browser compatibility includes an iOS 12 / Safari 12 JavaScript fallback
via `@vitejs/plugin-legacy`, with usage-based runtime polyfills in both modern and legacy bundles (Safari 12
can select the modern bundle). Older Safari uses native HLS camera playback and
CSS viewport, camera-ratio, and toolbar positioning fallbacks. Verify older devices
against a production build; the Vite development server requires a modern browser.
Presentation views tolerate missing BroadcastChannel and ResizeObserver; local
output retains storage-event synchronization. Device testing is still needed for
older Safari media playback and layout capabilities.

Worship-only accounts can use the musician role without the viewer role. Removing
viewer access hides Broadcast and My Profile, leaving the Worship workspace and
sign-out available. Worship Live includes older-WebKit scrolling and compact tablet
page-mode sizing fallbacks. Touch devices do not focus the hidden hardware-keyboard
capture input, and use a lower-cost live-state polling cadence.
Admin requires another direct access role to be selected before the final direct
role can be removed; approved serving assignments are displayed separately.
Accounts without the viewer role also omit the Website navigation link.

Livestream camera sources support digital close-ups (zoom and horizontal/vertical centre) and optional B-roll inserts. With automation enabled, the selected main camera anchors each insert and returns after its exact configured dwell (default 8 seconds, allowing a 2.5-second fade to settle), using the existing camera crossfade. Close-ups are viewer-side crops, not separately encoded or recorded streams. ONVIF slow cruise uses server-side PTZ_HOST, PTZ_PORT (default 80), PTZ_USERNAME and PTZ_PASSWORD. The controller discovers the media/PTZ profile, checks continuous movement support, refreshes a two-second motion lease, and eases pan reversals. It starts only on operator request and stops on shutdown; hardware speed fidelity must be checked on the camera.

Imou IPC-S2XE-6M0S calibration: ONVIF accepts 0.03 and 0.12 pan commands without visible movement; 0.13 produces visible but brisk motion. Physical cruise defaults to 0.13 with a five-second sweep rather than an ineffective low-speed command. The Livestream settings poll controller status and show asynchronous failures; controller activity does not guarantee physical movement.

Smooth digital pan adds a minimum 1.25× crop and gently shifts its horizontal centre over a roughly 16.7-second leg, alternating direction. CSS animation keeps movement smooth between camera-clock updates; a shared time anchor synchronizes the sweep between viewers. Main-view priority, eight-second inserts and 2.5-second fades remain configured independently. Sample left/right uses a bounded 0.75-second physical movement to select a new live-feed angle before broadcasting, then stops the motor. Sampling is rejected while manual streaming or live presentation output is active. It does not record or replay samples; physical resampling during a live broadcast is not automated.

Additional physical PTZ devices are configured privately through PTZ_CAMERAS_JSON, an object keyed by device ID with host, port (default 80), username (default admin), password and label. The original device retains PTZ_HOST/PTZ_PORT/PTZ_USERNAME/PTZ_PASSWORD and the default ID. Livestream settings select the physical device for sampling, cruise and status; each controller has independent state and all stop on shutdown. Camera feed choices and digital framing remain per-source settings.

The presenter live preview includes a Pointer toggle. When enabled, moving over the preview shows a circular 2× magnifier of the rendered slide on connected live displays. Coordinates scale with the display; leaving the preview, changing slides, blanking, or losing the connection hides the pointer. Mouse/trackpad hover shows the magnifier; click and drag draws translucent yellow highlighter strokes. On touchscreens, tap to magnify briefly or drag to highlight; pointer capture keeps the gesture attached to the slide, secondary touches are ignored, and drawing prevents scrolling only inside the enabled preview. Switch Pointer off to erase annotations; strokes remain until the slide changes or Pointer is switched off. Pointer replaces the rarely used Dark toggle. Pointer updates use a separate authenticated presentation endpoint and local BroadcastChannel, with a two-second cursor expiry, without changing slide selection or timing.

Pointer uses the same checked switch styling as Audio and Recording, thicker highlighter strokes, and a larger magnifier that copies the rendered text/image visual without starting duplicate presentation components. The lens follows slide updates and display resizing. Video slides retain an emphasis ring because embedded video frames cannot be copied as slide content.

### Responsive action buttons

Use icons with short action labels on larger screens, and compact icon-only
controls on smaller screens when space is tight. Preserve accessible names and
tooltips when labels are hidden. This is an app-wide UI principle; recording
controls use Play, Share / download, Publish / Unpublish, and Archive / Restore.

While dragging, the magnifier is hidden on both the preview and live output so highlighter strokes remain visible as they are drawn. It stays hidden after a stroke until the next hover or tap. Lens width and height are fixed together from the original stage size, with isolated layout to prevent mobile stretching.

Right-click or press and hold the Pointer switch for marker colour and thickness options. A long press opens the picker without toggling Pointer. Each stroke keeps its original style. Completed highlights are retained separately from the expiring cursor and are shown on other devices’ live previews, even with their Pointer switch off, until cleared or the slide changes.

The Pointer dropdown includes Zoom, off by default. With Zoom off, pointing shows an emphasis ring; enable Zoom for the 2× magnifier. Highlight drawing and marker styles work in either mode, and the zoom choice follows the pointer to live displays.

The preview has no Clear highlights button. Switching Pointer off clears its highlights across connected displays and previews, including when the last stroke update is still in flight.

Worship Live’s Musician menu includes **Band sync**, enabled by default per device.
With service Sync off, manual navigation and playback page turns share a separate
musician-only page position; turning Band sync off allows independent browsing.
Service Sync takes priority on every device, regardless of the Band sync setting.
The band position is stored separately in the presentation payload and polled via
`/api/v1/presentation/band-sync/{plan_id}`; it never changes congregation output.

Worship Live scroll mode has a per-device **Auto-scroll** option (enabled by
default) that follows the active source lyric line during guided playback or followed
shared timing. The sung line stays near the centre (with at most 15% viewport
height of forward lookahead), and scroll movement eases between line targets.
Early page cues do not move unfinished lyrics above the viewport. Manual wheel/touch scrolling pauses this motion until the next
live page change. Playback turns pages half a bar before the next page’s first bar; the dot and audio keep their actual
musical timing. The same early turn drives Band sync and coupled service output.

Non-looping guitar previews finish with a gentle down-strum of the last sounded
chord, sustained for four seconds with a soft decay. Exported practice MIDI adds
held guitar notes and an expression fade for the same ending. Metronome-only
and silent guides keep their original duration; loops have no ending pause.

Guitar previews use bundled FluidR3_GM steel-string and muted-guitar samples
(CC BY 3.0; attribution shipped with the assets). Only required notes load on
Listen, and compressed samples are cached for reuse. X strokes use the muted
guitar bank; MIDI exports use a separate muted-guitar channel.

Saving a strum with an existing shared name (case-insensitive) asks for confirmation
before updating that library entry. Cancel keeps it unchanged. Song patterns
already applied remain copies; future selections use the updated shared strum.

Guitar strings ring through skipped strokes for up to 2.5 seconds. Replucking a
string replaces its previous voice; X strokes and chord changes damp ringing
strings. These durations apply to both live playback and MIDI downloads, while
the final chord retains its four-second fade.

Strumming patterns can span one or two bars. The rhythm editor selects the length
and shows a separate row per bar with repeated counts. Shared strums preserve
the full cycle, and playback alternates its bars at the song tempo. Annotated
playback retains the cycle phase when starting from a later lyric page. Existing
one-bar patterns keep their previous behavior.

During Worship Live metronome or MIDI playback, selecting another lyric page
queues “play from here” for the next downbeat. The running audio clock finishes
its current bar, then starts the selected page without another count-in. Repeat
sections and different songs use the same player; the destination’s bar markers,
chords, pattern phase and tempo apply after the transition. Automatic early page
turns do not trigger jumps, and manual shared band/service selections can redirect
the device running playback. Shared timing changes to the destination on the
downbeat. Independent scrolling does not redirect playback.

Worship Live has a translucent beat keeper at the lyric panel’s top-left. Its
Musician-menu toggle defaults to enabled and shows it during guided playback or
followed shared timing. The song rhythm panel saves its visual count, which can
follow the meter or use a separate 1–12 count: selecting four shows 1–2–3–4 evenly across an 8/8 bar without changing
the meter, tempo, strum or MIDI. Count-in beats use the same audio clock.

Silent guide also supports manual slide changes during playback: it switches to
the selected slide on the next bar boundary, keeping the timing overlays and
automatic advance aligned without creating an audio session.

The Musician menu remembers Share timing per browser, defaulting to off.
Restoring this preference only shares timing once local playback starts.

The song chord editor keeps chord/bar editing, Play, and Rhythm beside its tabs.
A compact Chord tools menu groups key, capo, transposition, copy-verse and clear
actions. On mobile, the controls sit just below the tabs to preserve chord-panel
space. Clear retains its confirmation dialog.

Right-click or hold the chord/bar mode toggle to enter Both mode, moving chords
and bar boundaries at the same position together. Click returns to Chords.
Chord tools → Bars at chords adds missing boundaries at existing chord positions
without removing existing bars, providing a quick starting rhythm layout.

Chord/bar dragging highlights the exact destination slot and lyric character,
with a vertical guide through both rows. The preview uses the same source anchor
as the drop handler, including wrapped lines and leading/trailing positions.

Musician settings use consistent compact segmented controls. Chords, Dot, Beat
keeper, Band sync, Follow shared timing, Share timing and Auto-scroll use On/Off;
Bars retains Auto/On/Off. Enabled chords stay visible; the dot and beat keeper
appear only during playback. Existing saved Auto/On values remain enabled.

Worship Live auto-scroll averages the lyric trajectory over four bars and blends
it with the overall song pace, reducing pauses and abrupt changes in speed.
The active sung line constrains the target to 32–65% of the viewport; manual
scrolling still pauses following until the next slide advance.

Manual live navigation immediately centres the selected slide in scroll mode,
including synced devices, while playback finishes its current bar. Scroll
following waits for the musical destination before resuming. MIDI carries the
last sounding chord through unannotated destination bars until the next change;
a fresh playback start still leaves opening unannotated bars silent.

All users with Worship Live access can use Play for metronome, MIDI strum and
silent guidance, including musicians and worship leaders. Sharing the timing
clock is available to administrators and worship leaders; musicians can follow
shared timing but cannot publish it. The API enforces the same role boundary.

Manual playback segues finish the current bar, then enter at the destination
slide’s first annotated chord as beat 1, skipping earlier unannotated bars.
If no chord is annotated on that slide, its first bar carries the previous chord.
An entry-stop index in the shared clock keeps follower dots aligned with a
mid-bar entry; saved bars and normal fresh playback remain unchanged.

Guitar upstrokes use lower velocity even on accented beats. Muted strokes brush
high-to-low like a soft upstroke, with lower velocity and a gentler attack while
still damping sustained strings. The velocity balance also applies to MIDI export.

Muted guitar strokes now decay for up to 300 ms (bounded by strum spacing),
with a longer smooth release instead of the earlier short cutoff.

The Play menu offers MIDI only for guitar chords and strumming without
metronome clicks or an audible count-in, retaining guided slide following
and the same manual segue behaviour as MIDI with metronome.
