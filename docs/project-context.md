# Project Context

## Service template workflow

Service and section templates are selected in compact presenter dialogs. The
outline control is an accessible icon at every viewport size. Existing edits
stay with the service unless the operator chooses to update its template; new
sections default to joining the template so it can grow during preparation.
Templates copied from another service type become local defaults for the current
type. Saving a child configuration must not overwrite its parent's settings.
The section editor follows the expandable configuration groups used for roles,
including dated starts, inline YouTube backing audio, and an item fade-out cue.

This document captures the intent that has been communicated while shaping
`cspot-pro`. It is meant to be useful both for humans joining the project
and for coding agents that need durable context between sessions.

Song video selection stays inside the song editor: search with thumbnails,
watch an embedded preview, and choose the video before saving the song.

## Core Purpose

`cspot-pro` is a complete reimplementation of the legacy `cspot` church
service planning tool using a stack that is easier to maintain, extend, test,
and deploy.

The aim is not just technical replacement. The project is also a rethink of the
product experience:

- more modern appearance
- better performance
- clearer architecture
- easier portability through containers
- simpler future feature growth
- a stronger presenter workflow
- a church television that can follow a server-connected presenter without
  being an external monitor

## Product Priorities

In rough order:

1. Build and manage a church service plan end to end.
2. Present that plan reliably in a live setting.
3. Make songs, Bible passages, and sermon decks easy to add and operate.
4. Keep the system modular enough that future features can be added without
   major rework.
5. Preserve the useful behaviour of the original app while improving the
   information density, workflow, and maintainability.
6. Support real multi-user church operation with authentication and role-based
   permissions before public hosting.
7. Support prepared Sunday School lesson material so a cover teacher can run
   a lesson at short notice.

## Guiding Product Principles

### 1. Presentation is central

The presentation workflow is not a side feature. It is a primary operational
surface of the app.

The app should support:

- preparing a service
- navigating it in real time
- selecting a specific slide quickly
- adjusting Bible passages while presenting
- moving naturally between songs, readings, and sermon content

### 2. Sections are first-class

A plan is not just a flat list of slides.

The app should treat sections as meaningful units such as:

- Welcome
- Worship
- Reading
- Sermon
- Other service segments

Sections should remain visible and directly navigable while presenting.

The default Sunday template contains Welcome, Worship, Open time, Sermon,
Announcements, and Post-service. Welcome contains individually selectable
Montage, Countdown, and Please be seated items. Automation starts the template
once; each item owns its duration, automatic advance, output destinations, and
audio scene. The seeded flow shows a 25-minute montage followed by a five-minute
countdown, then selects Please be seated. Welcome navigation preserves the
montage's original countdown; each entry to the final countdown starts a fresh
five minutes, capped by that original deadline.
At zero the final countdown advances to Please be seated. Countdown and
auto-advance settings are grouped under Timing. Operators configure the selected
service's actual start time from the Start menu; the pre-service start is
calculated from the timed Welcome cues. Welcome photos
can be scoped to one service or retained for future services. Montage photos start their transition clock when selected, preserve configured order by default, and can be randomized per item. They crossfade gently, including the final transition back
to the holding background. Scene changes independently determine livestream
mixing and whether media plays through the room. Starting the service shows the
currently selected cue; worship starts only on the operator's next advance. Open time is a neutral LCF background transition. Empty Sermon and Announcements sections are clickable
deck placeholders; imported decks replace their filler backgrounds. Existing
Sunday plans can add only their missing standard sections, preserving content.

### 3. Different content types behave differently

Not all service content should be processed the same way.

- Songs should be formatted and split into usable lyric slides.
- Bible passages should be reference-driven and navigable by verse/chapter.
- Sermon and external slide decks should be preserved as rendered slide decks
  rather than transformed into lyric-style text slides.

### 4. Dense, work-focused UI

The preferred interface style is compact and operational:

- little wasted vertical space
- strong use of dropdowns, context menus, and overlays
- fewer sprawling edit forms on the page at once
- less scrolling
- more direct manipulation near the content being worked on

### 5. Stable project memory matters

Important intent, architecture, and workflow decisions should be written down in
the repo rather than existing only in chat history.

### 6. Public hosting must be permission-aware

The app is expected to become publicly reachable. That means:

- authentication is not optional
- browser-only trust is not enough
- the backend must enforce role-based permissions
- the UI should expose read-only versus edit/create/admin affordances clearly

## Confirmed UX Preferences

These preferences have been made explicit and should guide future changes.

### Presenter workflow

- `Present` should be the default landing view.
- The presenter UI should prioritize the actual service flow rather than acting
  as a passive preview page.
- The main preview should be balanced against a visible slide sorter and section
  rail.
- Section management belongs in the section rail, not on every slide tile.
  Sections are colour-coded outline groups containing named content items. Group
  and item ordering are separate: groups reorder globally, items only within
  their parent group, and nested rail items are collapsed by default.
- Insert actions should happen in context, especially between sections.

### Interaction style

- Use app-native confirmation dialogs rather than browser prompts.
- Avoid persistent success banners that clutter the interface.
- Keep error messages visible enough to be actionable.
- Use keyboard navigation aggressively where it helps live operation.
- Calendar navigation should default to a continuously scrolling, month-grouped
  all-days timeline, with a compact Sunday-only alternative. Both timelines
  should extend seamlessly in either direction as the user scrolls. Populated
  cards should use their available space for a terse service, set, or lesson
  status, while blank cards remain visually quiet. Item counts use the shared
  compact calendar badge and remain visible at mobile widths. In the all-days
  view, the selected date's full Sunday-to-Saturday week should be visually grouped.
- Sunday services, worship sets, and lessons should behave as available
  planning slots without requiring a separate create action. Records may be
  materialized lazily when a slot is first opened or edited.
- Initial date selection should use whichever comes first: the next Sunday or
  the next non-empty plan date. Empty records created by calendar browsing do
  not count, and a non-Sunday without planned content must not default to today.
- Worship and Sunday School leaders should be allocated by a simple,
  capacity-aware monthly rotation. Manual assignment and Sunday swaps belong
  behind the Leader control, not inside the calendar. Dedicated service
  accounts such as `cspot_tablet` use Manual mode: they remain assignable and
  swappable but do not enter automatic rotation. Disabled roles are hidden from
  assignment and swap controls without removing their workspace access.
  Rotation defaults apply only to current and future
  dates; historical dates retain their stored assignments and are excluded
  from swapping.
- General account onboarding uses an admin-toggleable QR/link. Self-registered
  accounts remain inactive and alert admins until explicitly approved; the
  baseline Viewer role opens only the Broadcast workspace and has the minimum
  plan, song, and library read permissions needed for livestream and recording
  playback.
- Broadcast audio can use one independent source or a limited multi-source mix.
  Per-source digital trim and mute state are shared by livestream and sermon
  recording, with compact live controls available beside the admin camera view.
- Authenticated livestream viewing is recorded by event and user. Broadcast
  administrators can see who is currently watching and review unique viewers
  and accumulated watch time for previous livestreams. Background tabs and
  locked phones continue to count while livestream audio is enabled; mobile
  playback uses a native stream so the operating system can keep it alive.
  Runtime mix changes update the active server-side audio filter graph and do
  not replace the viewer's browser stream.
  Saved Pastor, Congregation, Worship, Media, and Pre-service scenes can be
  recalled manually; presenter item and media-playback state can recall them
  automatically. Pastor, Congregation, and Worship use desk/room feeds with
  direct PC media excluded. Media and Pre-service are the inverse mix-minus:
  direct PC media is enabled while the desk return and room microphone are
  excluded, avoiding a doubled PC line-out → desk → USB-return signal.
- A playing song backing track remains on Worship rather than switching to
  Media. The complete desk return carries that track once alongside live vocals
  and instruments. Combining live desk channels with direct PC media would
  require a desk aux/matrix mix-minus that excludes the PC input; it cannot be
  reconstructed reliably from the stereo record-out in software.
- A direct PC-media bridge source is only a capture endpoint. A designated
  Windows player must feed its loopback or virtual cable; running the capture
  bridge headlessly does not create that playback. Configured pre- and post-service music is rendered once by the dedicated media receiver and distributed through the selected remote live-audio route; viewers and slideshow displays do not render local copies.

### Song handling

- New songs should support paste-in lyrics and formatting assistance.
- Worship songs should be normalized into a consistent slide structure.
- Elapsed worship-set order should add opening, middle, and closing song-type
  tags without replacing manually assigned tags. Manual removals remain in
  force until a later elapsed set provides new evidence for that position.
- Every song save should prune invalid or deprecated part labels and renumber
  lyric and sequence verses together without gaps.
- A sequence longer than the lyric label list may encode deliberate repeats and
  should be preserved, with newly introduced lyric labels merged into it.
- Worship-song lyrics should store each distinct song part once where possible.
  Repeated parts belong in the song sequence, or as bare section labels when
  preserving imported lyric order.
- The final slides do not need visible labels such as "verse" or "chorus" if
  the content already reads clearly as separate slides.

### Deck handling

- Imported sermon and external slide decks should remain visually intact.
- The system should store them as slide-deck content that can be inserted into
  plans.
- Fidelity to PowerPoint is preferred, but the current implementation uses a
  LibreOffice-based render pipeline and may need improvement.

### Bible handling

- Multiple translations should be available.
- Reference lookup should be fast.
- Keyword search should be possible.
- Search should be available directly from the presenter workflow.
- Bible slides should be navigable by verse and chapter without leaving Present.

### Sunday School handling

- Sunday School lessons should be stored by Sunday/date.
- Each lesson keeps lightweight Theme and Bible Reference metadata plus a flexible,
  ordered board of resources, uploads, links, or notes. Legacy structured lesson
  fields remain supported so existing prepared lessons are not lost.
- Sunday School resources are available source material that can be added to a
  Sunday's board directly, with suggestions guided by its theme and reference.

## Import Intent

### Songs

Song import is a desired capability, but it should be treated as a workflow
rather than a brittle one-off scrape.

Desired characteristics:

- manual paste always available
- bulk import support
- parsing/normalization after import
- provider-specific logic where practical
- personal-use oriented workflow

### Sermons and slide decks

Imported sermon decks should not be reparsed into worship-song structures. They
should stay as decks with rendered slides and be selectable inside a plan and
while presenting.

## What the Legacy App Is For

The legacy repo is still valuable for:

- feature parity reference
- behavioural comparison
- data model migration planning
- visual cues worth preserving

It should not dictate the new architecture.

## Current Known Tension

The current slide-deck render pipeline can diverge from PowerPoint layout and
text alignment because the deck is rendered through LibreOffice. This is now a
known architectural concern, not just a UI bug.

## How To Use This Document

If a future change seems technically sensible but pushes against the principles
above, stop and re-evaluate before shipping it. This document should be treated
as a durable expression of product intent.

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


Sermon recording must follow the service lifecycle, not output-window ownership.
A scheduled service can remain live without a local slideshow window. Automatic
stop/trim must retain recoverable source audio; short automatic captures belong
in Archived recordings rather than being permanently deleted.

Production browser compatibility includes an iOS 12 / Safari 12 JavaScript fallback
via `@vitejs/plugin-legacy`, with usage-based runtime polyfills in both modern and legacy bundles (Safari 12
can select the modern bundle). Older Safari uses native HLS camera playback and
CSS viewport, camera-ratio, and toolbar positioning fallbacks. Verify older devices
against a production build; the Vite development server requires a modern browser.
Presentation views tolerate missing BroadcastChannel and ResizeObserver; local
output retains storage-event synchronization. Device testing is still needed for
older Safari media playback and layout capabilities.

For dedicated older worship devices, assign musician and remove viewer. This hides
Broadcast and My Profile while retaining worship-set and Worship Live access. Worship
Live avoids software-keyboard focus and reduces background work on touch devices.
In Admin, select another direct role before removing the final one; approved serving
assignments can grant effective access but appear separately from direct role toggles.
Worship-only accounts without viewer access do not show the Website navigation link.

## Sunday School presentation (September 2026)

The classroom has a permanent `/media/sundayschool` receiver, one live lesson at
a time, and Service-style shared controls. The lesson sequence is Action Songs,
one combined Memory Verse Game (recall then learn), Bible Story, Questions,
Printout/Craft, and Game/Free Play. The teacher's board remains empty until they
choose activities. Jonah is the first data-driven interactive story; teacher
narration stays off the TV. Local short sounds require one initial TV gesture.
Story authoring, full action-song backing media and PDF generation remain out of scope.

Livestream camera sources support digital close-ups (zoom and horizontal/vertical centre) and optional B-roll inserts. With automation enabled, the selected main camera anchors each insert and returns after its exact configured dwell (default 8 seconds, allowing a 2.5-second fade to settle), using the existing camera crossfade. Close-ups are viewer-side crops, not separately encoded or recorded streams. ONVIF slow cruise uses server-side PTZ_HOST, PTZ_PORT (default 80), PTZ_USERNAME and PTZ_PASSWORD. The controller discovers the media/PTZ profile, checks continuous movement support, refreshes a two-second motion lease, and eases pan reversals. It starts only on operator request and stops on shutdown; hardware speed fidelity must be checked on the camera.

Imou IPC-S2XE-6M0S calibration: ONVIF accepts 0.03 and 0.12 pan commands without visible movement; 0.13 produces visible but brisk motion. Physical cruise defaults to 0.13 with a five-second sweep rather than an ineffective low-speed command. The Livestream settings poll controller status and show asynchronous failures; controller activity does not guarantee physical movement.

Smooth digital pan adds a minimum 1.25× crop and gently shifts its horizontal centre over a roughly 16.7-second leg, alternating direction. CSS animation keeps movement smooth between camera-clock updates; a shared time anchor synchronizes the sweep between viewers. Main-view priority, eight-second inserts and 2.5-second fades remain configured independently. Sample left/right uses a bounded 0.75-second physical movement to select a new live-feed angle before broadcasting, then stops the motor. Sampling is rejected while manual streaming or live presentation output is active. It does not record or replay samples; physical resampling during a live broadcast is not automated.

Additional physical PTZ devices are configured privately through PTZ_CAMERAS_JSON, an object keyed by device ID with host, port (default 80), username (default admin), password and label. The original device retains PTZ_HOST/PTZ_PORT/PTZ_USERNAME/PTZ_PASSWORD and the default ID. Livestream settings select the physical device for sampling, cruise and status; each controller has independent state and all stop on shutdown. Camera feed choices and digital framing remain per-source settings.

The presenter live preview includes a Pointer toggle. When enabled, moving over the preview shows a circular 2× magnifier of the rendered slide on connected live displays. Coordinates scale with the display; leaving the preview, changing slides, blanking, or losing the connection hides the pointer. Mouse/trackpad hover shows the magnifier; click and drag draws translucent yellow highlighter strokes. On touchscreens, tap to magnify briefly or drag to highlight; pointer capture keeps the gesture attached to the slide, secondary touches are ignored, and drawing prevents scrolling only inside the enabled preview. Switch Pointer off to erase annotations; strokes remain until the slide changes or Pointer is switched off. Pointer replaces the rarely used Dark toggle. Pointer updates use a separate authenticated presentation endpoint and local BroadcastChannel, with a two-second cursor expiry, without changing slide selection or timing.

Pointer uses the same checked switch styling as Audio and Recording, thicker highlighter strokes, and a larger magnifier that copies the rendered text/image visual without starting duplicate presentation components. The lens follows slide updates and display resizing. Video slides retain an emphasis ring because embedded video frames cannot be copied as slide content.

Historical service replays use the same explicit Start/Stop ownership as current services. Cleanup must not blank or stop a manually started replay merely because its output heartbeat is stale or there is no local output window. Legacy heartbeat-only sessions still expire, and starting another service still closes the previous service.

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
