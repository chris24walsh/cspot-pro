# Development environments

## Service template persistence

`POST /planning/plans/{id}/sections` copies a default section and its children in
one transaction. `PATCH /planning/items/{id}` accepts `save_template`; it updates
only the owning service type's matching default configuration. The JSON
`template_id` preserves identity through renames, and outline edits retain
existing DefaultItem IDs. `POST /planning/plans/{id}/save-outline` saves structure
and reusable configuration, excluding song selections and dated
announcement details. Planning editors can create and populate templates; global
service-type administration retains its existing permission checks.

Saved items retain their type and text (including Bible readings), overlay
formatting, backing audio and montage ordering. `template_files` records stored
file IDs and ordering; new services and inserted sections receive independent
attachment links to those files. Deleted stored files are skipped. Existing
templates missing content or attachments must be saved again from an intact
service item; existing service instances are not rewritten.

Default JSON stores reusable `scheduled_start`, `backing_audio_id` and
`stop_backing_audio`. A dated instance uses `planned_start`; the server scheduler
resolves due start anchors within the existing manual-control rules. Section
backing audio is inherited by child slides, with fade cues handled by display
and viewer playback. Reads no longer reapply explicit templates, preserving
service-only changes and removals. Legacy implicit Sunday outlines still receive
repairs and are materialised before their first saved customisation.

The repository has a hot-reload local stack, an isolated production-image
sandbox, and production deployments. The sandbox owns a separate Compose
project, database volume, storage volume, credentials, and localhost port.
Private remote access uses Tailscale Serve and never production data.


# Current Architecture

## Sunday School lesson runner

Sunday School keeps its Elements library, clear autosaved board, and date/leader
navigation. A single Memory Verse Game stores `last_week` and `this_week` text
and reference, with optional translation. Existing separate verse board items
are combined on read without losing their content.

`/media/sundayschool` is a permanent room receiver (under the configured app base
path). Like Service, it uses authenticated HTTP polling, a heartbeat, and an
explicit Start / Present / Back / Next / Blank / End lifecycle. Service sessions
require service-plan foreign keys and invoke sanctuary recording/audio automation;
Sunday School instead uses one seeded room row with an atomic revision check.
Only one date can own that row. Stale commands and competing starts receive 409;
heartbeats neither claim the room nor create lessons. The older date-based display
columns are retained for migration compatibility but no longer control output.

The teacher and TV use the same content renderer and existing `AutoFitSlideText`.
Only the TV initializes a persistent Web Audio context, following a one-time
sound-enable gesture. Short original effects are generated locally. Blanking
preserves state, stops sound, and does not replay cues on resume. The scoped
`sunday_school:present` permission lets classroom teachers control this room
without granting sanctuary control or lesson editing.

Stories are local scene/layer/cue data. A pure frame reducer restores Back and
reconnect positions; the renderer implements only show/hide, movement, bounce,
shake and short sound cues. Jonah supplies four scenes and local SVG assets.
Narration is rendered only by the teacher presenter. Reduced-motion preferences
suppress transitions and animations.

## Website editor identity bridge

CSpot can authorize the website's Strapi admin through a short-lived,
single-use authorization-code exchange. CSpot remains the authority for the
explicit `website:edit` and `website:publish` permissions; Strapi establishes
and owns its own restricted administrator session for the mapped individual.
The browser flow and Strapi implementation contract are documented in
[`website-editor-sso.md`](website-editor-sso.md).

This document describes the current architecture of `cspot-pro` in a way
that should be readable by both humans and coding agents.

`SongYouTubeSearch` uses the existing YouTube search API for debounced, paginated
results inside the song editor Details tab. A single embedded player previews
the chosen result; selection updates the draft `youtube_id` and the normal song
save persists it. Unmounting the preview stops playback.

## High-Level Shape

The system is a modular monolith with three primary runtime pieces:

1. `frontend`: React + TypeScript + Vite
2. `backend`: FastAPI + SQLAlchemy + Alembic
3. `db`: PostgreSQL

Local development and portability are centered on Docker Compose.

## Architectural Goals

- one repo
- one backend deployable
- explicit domain modules
- container-friendly local development
- minimal setup overhead
- future extraction possible if a module genuinely outgrows the monolith

## Runtime Topology

```text
Browser
  |
  v
Frontend (React/Vite)
  |
  v
Backend API (FastAPI)
  |
  v
PostgreSQL
```

Optional supporting flows:

- file upload storage under `backend/storage`
- rendered slide image generation through LibreOffice + `pdftoppm`
- local browser-to-browser presenter sync through `BroadcastChannel` and
  `localStorage`
- cookie-based session authentication between browser and backend

## Repository Structure

```text
backend/
  app/
    api/
    core/
    modules/
    scripts/
  migrations/
  tests/

frontend/
  src/
    components/
    data/
  public/

docs/
docker/
scripts/
```

## Backend Architecture

### Module Strategy

The backend is partitioned by domain modules inside `backend/app/modules`.

Current modules:

- `identity`
- `planning`
- `music`
- `people`
- `library`
- `presentation`
- `communication`
- `imports`
- `sunday_school`

These modules share a common database and API process, but are intended to stay
conceptually separate.

### Data Flow

Typical request path:

```text
Route -> schema validation -> ORM/session work -> response schema
```

### Persistence

- PostgreSQL is the system of record.
- Alembic handles schema evolution.
- Demo data seeding currently bootstraps a usable local environment.

### Authentication and authorization

Administrative access and serving capabilities are deliberately separate. Signed-in users
can maintain their own identity, volunteer preferences, a flexible workload
(`X` per week, month, quarter, or year), and unavailable date ranges.
Administrators approve or decline those requests;
approved ministry capabilities provide their matching non-admin workspace access
without a second permissions step. Approved worship and Sunday School
preferences are also exposed to the existing rotation selectors. Each approved
relationship has an independent scheduling mode: Automatic participates in
allocation, Manual is available only for direct assignment and swaps, and
Disabled is hidden from all assignment controls while retaining workspace
access. The same
data-backed serving-area catalogue also covers welcome, AV, cleaning, cooking,
maintenance, and grounds work as the foundation for broader chore scheduling.
Admin attention is surfaced as a quiet navigation badge and per-user flag;
requests are reviewed within the relevant user rather than in a separate global
queue. Unavailable ranges are shared by automatic allocation, direct assignment,
and swap validation.

Public self-registration is opt-in and controlled from Admin Settings. The
stable share link and downloadable QR code open the compact authentication
screen in registration mode. A submitted account receives a strong password
and Viewer role but remains inactive until an administrator approves it;
registration requests participate in the existing admin attention routing.
SMTP-enabled deployments send a one-day email-verification link, while admin
approval remains an explicit identity override for installations without SMTP.
Rejection permanently removes only the still-pending account after confirmation.
Public registration, login, verification, and password-reset requests have a
small per-client in-process rate-limit guard.

Serving capabilities are grouped by owning ministry rather than by ambiguous
trade labels: Worship & Production owns music, sound, projection, livestream,
and its equipment care; Hospitality & Care owns welcome and food; Property &
Facilities owns cleaning, grounds, and building maintenance. Specific jobs sit
under these areas, allowing equipment repairs and rota roles to share a team
without pretending they are the same task. Profile and admin use the same
grouped, expandable role-list pattern so requests and reviews remain visibly
coordinated.
Serving relationships can begin as either a volunteer request or an admin
invitation. The opposite party accepts or rejects it, and both sides stage
workload, note, status, and removal changes locally before an explicit save.
Attention follows ownership: admin invitations alert the invited user, while
admins are alerted by volunteer requests and by responses to invitations they
sent. Outgoing invitations do not create an admin alert.
True legacy-role equivalents are consolidated in the serving UI: Worship
Leader, Musician, Sunday School teacher/leader, Service Teacher, and Presenter
direct assignments suppress duplicate volunteer or invitation controls. Access
grants that are not semantic equivalents (for example Sound/AV using Presenter
permissions) remain distinct. Historical preference records are preserved.

Admin navigation uses up to three flat tab rows: Manage users/Settings, then
Users/User settings, then Account & identity/Roles & serving. Google Drive is
kept under Settings; Sunday rotation limits are inline on the applicable role
rows rather than presented as a separate user-settings panel.
The personal profile follows the same compact navigation pattern with Account
and Serving tabs; availability remains inside Serving because it directly
affects rota allocation. Pending invitations route to and expand the exact role
row when Profile opens. Admin attention likewise opens the relevant user and
expanded item on Roles & serving without clearing the alert before it has been
handled. On desktop, the user list and user editor remain visible side by side;
the Users/User settings switch is reserved for narrower screens.
Calendar assignments use automatically derived first/surname initials. Colours
are assigned from the full palette per visible user set, avoiding reuse until
the palette is exhausted, and assignment markers expose the full name on hover.
All personal Serving actions apply immediately and do not require a second
save. Workload and note edits persist on change; destructive actions such as
rejecting an invitation, cancelling a request, leaving a role, or removing an
unavailable range use an in-app confirmation. The last-open profile tab is
retained across identity refreshes. Active/requested roles sort first within
each ministry. Both profile and admin collapse roles beneath ministry headings,
show the number active in each heading, and allow only one ministry and one
nested role to be expanded at a time. Compact role rows keep Join, Leave,
Accept, Invite, or Remove actions visible while their workload, availability,
and explanatory detail remain expandable. Profile role mutations update local
state in place rather than refetching the full profile, preserving scroll and
accordion position.
Account changes refresh authentication data separately from Serving attention,
so joining or accepting a role does not remount Profile. Role order also stays
stable while its action and ministry count update in place. Confirmation
dialogs remain compact and centered on narrow screens rather than inheriting
the full-height mobile editor treatment.
Serving frequency uses one shared adaptive dropdown control in Profile and
Admin rather than free-form numbers. Current practical limits are 1–3 per week,
1–5 per month, 1–8 per quarter, and 1–12 per year; changing period clamps the
count into its valid range. Admin Settings manages serving-role categories,
roles, descriptions, and normal task intervals. Weekly roles suggest an
editable monthly commitment, two- and three-weekly roles suggest a quarterly
commitment, and monthly roles suggest a yearly commitment when a volunteer or
administrator starts a new assignment. Assigned roles and categories containing
assigned roles cannot be deleted. The dense ministry/role hierarchy is shared
between role management and per-user serving management.
Admin Roles & serving follows the same immediate-action model as Profile:
access-role assignment, rotation limits, request decisions, invitations,
frequency, and admin notes persist without a separate save. Destructive removal,
rejection, and invitation cancellation retain compact confirmation. Account &
identity edits remain deliberately separate behind Save User, and an immediate
serving mutation does not submit any unrelated account draft.

Legacy operational roles are migrated into approved serving relationships by
revision `0037_migrate_roles`. Worship leader/team aliases, musician, Sunday
School teacher/leader, service teacher/leader aliases, and presenter map to
their semantic serving areas. Existing notes and frequency preferences win;
otherwise Sunday limits seed the worship/children frequencies. Revision
`0038_rotation_modes` converts the former zero/“Never” value to Manual. The corresponding direct `user_roles`
row is removed only after an approved replacement exists, while Viewer and
Administrator remain direct system roles. Each future rename, merge, or split
should use a new additive mapping migration rather than editing the historical
0037 snapshot.
Rotation mode and frequency are independent of authorization. Manual excludes
a person or device from automatic allocation but leaves direct assignment and
swapping available; Disabled also hides it from those pickers. Both retain the
serving capability and its workspace access. This is how dedicated accounts
such as `cspot_tablet` retain worship planning/control access without entering
the automatic worship-leader rota.

Viewer is deliberately limited to the Broadcast workspace. It grants the
plan, song, and library read permissions required to render synchronized live
slides and sermon recordings, but no edit, team, message, presentation-control,
or broadcast-control permissions. Broader workspace access comes from approved
serving relationships or explicit administration.

`identity` now owns:

- first-admin bootstrap
- password hashing
- cookie-backed login/logout/session lookup
- role-to-permission resolution
- backend permission checks on module routes

The app uses an RBAC-style ladder aimed at church operations:

- read-only access
- edit existing plans/songs/team data
- create/manage plans and songs
- full administration including user management

### Files and slide decks

Uploaded files are stored under backend-managed storage paths.

For slide decks:

1. file uploaded
2. file linked to a plan item
3. backend renders deck pages to PNGs
4. frontend requests rendered slide URLs
5. presenter surfaces display those images

### Current rendering pipeline

The deck-rendering path currently depends on:

- LibreOffice (`soffice` / `libreoffice`) for conversion
- `pdftoppm` for PDF-to-PNG rendering

This works operationally, but may still differ visually from PowerPoint.

### Sunday School lessons

`sunday_school` owns date-based lesson records for emergency cover and lesson
preparation. Its desktop and mobile workspace mirrors Worship's Library/Set
concept: expandable element groups offer contextual or catalog suggestions on
the left, while a flexible ordered board holds what has actually been added for
the Sunday. Theme and Bible Reference remain lightweight suggestion metadata.
Board items can reference catalog resources, shared-library uploads, or plain
content; legacy structured lesson fields remain readable and are surfaced as
board items when an older lesson has no board data. Lessons are still created
lazily on their first save or assignment change.

## Frontend Architecture

### Live data refresh and reliability

- Durable planning, music, worship-set, and identity mutations advance lightweight,
  domain-specific process-local revisions exposed at `GET /api/v1/change-revision`.
- Authenticated clients poll that database-free revision with one request in flight,
  slow down while hidden, and exponentially back off during failures. A changed
  revision refreshes only the affected active workspace, profile, or administration
  data without a page reload or loading-state flash.
- High-frequency presentation and broadcast state keeps its dedicated polling cadence,
  but polling loops must be single-flight so a slow API cannot create an unbounded
  request backlog.
- SQLAlchemy pool acquisition has a short timeout and recycled connections, allowing
  overload to fail quickly and recover rather than occupying request workers for the
  previous 30-second default.

### App shape

The frontend is currently a single SPA with module-based views. The product
direction now strongly favors the Present workflow as the main operational
surface.

### Key presenter components

- `PresentationView.tsx`
- `PresentationOutput.tsx`
- `presentation.ts`
- `ScaledSlideImage.tsx`

### Presenter state model

The presenter is built around:

- selected plan
- ordered sections
- derived slides
- current live slide index
- a separate output window synchronized through local browser messaging

On phones and tablets, every module uses the same compact context toolbar with
an immersive-view toggle at its right edge. Entering immersive view always hides
the application's primary navigation row. Supporting browsers are additionally
asked to enter native fullscreen and hide their own navigation UI; iPhone and
iPad Safari keep their browser chrome but still gain the space occupied by the
application navigation. Date/history/assignment controls, broadcast mode tabs,
and musician live controls share this toolbar rather than adding view-specific
rows.

Primary workspaces are mounted on first use and retained for the rest of the
authenticated app session. Switching modules therefore preserves fetched
resources, selections, scroll context, and draft UI state without giving up the
initial lazy load for workspaces the user has not opened.

### Presentation derivation

Slides are derived from plan items by content type:

- songs -> split into multiple worship slides
- readings -> single text slide based on passage text
- deck-backed items -> one rendered image slide per deck page
- generic sections -> single text slide

Service plans remain empty date slots until their first explicit content item.
That first addition populates the plan through `planning/service_scaffold.py`
from the selected plan type's ordered `DefaultItem` outline. Administrators can
create custom named plan types and edit these outlines in Admin settings. The
seeded Sunday type retains Welcome, Worship, Open time, Sermon, and
Announcements for compatibility. `planned_start` remains available as plan-item
metadata, but template outlines leave it unset and the presenter keeps headings
uncluttered. The Service date navigator exposes the selected plan type between
the calendar and History controls. Opening a date creates an empty plan, using
Sunday Service on Sundays and Midweek Meeting on every other day. Adding the
first set, deck, or other content applies that type's template when configured.
The previous/next navigator arrows select the nearest earlier or later date that
has service content (including a linked worship set); they do not advance by a
fixed seven-day interval and ignore empty plans created by browsing the calendar.
Scaffold completion is idempotent and
recognizes the older item aliases, so adding missing sections does not overwrite
or duplicate existing service content. Section type also supplies the default
automatic broadcast-audio scene; active media playback takes precedence.
Presenters cannot reorder, rename, or remove these fixed outline groups.
Each group is represented by a root `PlanItem`; optional child `PlanItem` records
use `parent_item_id` and retain their imported filename-derived titles. Groups
can move only among root groups, while children can move only among siblings.
The presenter rail renders a colour-coded group boundary and keeps children
collapsed by default. Group headings navigate to the group; explicit plus
controls add content. The sorter uses the same expand/collapse convention for
every multi-slide item, including songs and imported decks. Presenters can
manage songs inside the linked worship set, add multiple sermon or announcement
decks while retaining the outline group, and manage images attached to
Welcome, Open time, and Announcements. Administrators retain structural repair
controls.

Welcome is a root group whose nested template items normally include
`welcome_montage`, `welcome_countdown`, and `welcome_seated`. Each dated `Plan`
has one authoritative `queued_start`, initially copied from its service type's
`automation_start`. Changing the template start updates future plans which have
not received a dated override; changing it in the service editor updates that
same plan field. Durations and `auto_advance` behavior live on child items and
cannot create competing service starts. A newly activated queue always begins
at the first cue, records its actual activation time, and resolves later cues
from durations elapsed since that activation. Legacy item start fields do not
skip ahead within the service, and a same-day queue cannot be newly set to an
already-past time. The scheduler resolves the current cue from cumulative item durations,
so it can recover correctly after a restart without separate Welcome/countdown
clocks. Old service-schedule records and `pre_service_phase` remain readable as
compatibility fallbacks for services not yet using item cues.

Pre-service montage images are `StoredFile` records attached to the Welcome
montage child through `ItemFile`. Admins and presenters choose whether each new photo is scoped to the
current service or inherited by future Welcome sections; legacy global photos
in the `Pre-service Montage` category remain supported as persistent entries.
They can manage both kinds from the Welcome section. Image montages begin with
their first configured image whenever the slide is selected; an item-level
option can instead apply a deterministic random order shared by every output.
Each item can also select a named audio scene and route its visual to church
displays, livestream, or both. Audio scenes are administrator-defined mixes of the configured inputs. The dedicated media receiver always renders program audio so its Windows bridge capture can feed livestream and recording. Whether that Windows endpoint also feeds the church desk and room speakers is determined by the Windows audio and desk routing, not by viewer browsers or an audio-scene mute. Scene activation follows item selection, including automatic cues.
Backing-audio playback is owned by each song item and uses the shared live
presentation media command, so Service Live and Worship Live show and control
the same playback state. Administrators can persistently couple Worship Live
navigation to Service Live. Coupling adopts the service's current song when it
is already in worship; otherwise it moves the service to Worship Live's selected
song. Both views then share slide and audio play/fade state until either control
decouples them or Service Live leaves worship. Backing audio always fades before
pausing or leaving its song. Operators can decouple Worship Live
(jumping the service to the first section after worship).
Section and child-item pencils share one native editor backed by the plan item's
`presentation_options` JSON. Section images are fallback content and are omitted
while child items exist. The editor exposes image dwell/fit, transition and
auto-advance controls. Editors group timing, visuals, audio, overlay and media
settings into collapsible sections; reusable groups can be promoted to the
current service type's defaults by administrators without copying item-specific text. The Admin
template editor exposes the same presentation settings, while service editors
show only settings relevant to the selected section or item. A template section
can auto-contract its children. Only the final section can end the live service
when its final timed cue finishes. Both editors use the compact nested disclosure treatment shared with
profile Serving settings. Template items render beneath their owning section
and expose left-edge drag handles that reorder only among valid siblings. Welcome,
Open time, Sermon and Announcements support styled static/countdown overlays;
their overlay font scale is stored per item as a percentage (25–200%). Countdown
overlays can use a duration or a clock time on the service date. The live
presentation position retains duration countdown start times across outputs.
Welcome montage keeps its original start and advance deadline when revisited.
Entering the final Welcome countdown starts its duration again, capped by the
montage's original countdown deadline; updating the same slide's display state
does not restart it. Its auto-advance uses that same deadline and selects Please
be seated at zero. Countdown and advance settings are grouped under Timing.
Clock targets use Europe/Dublin on every output. Selecting slides before starting
the output does not consume countdown time. Timed
Welcome cues apply that scale to the built-in message and clock and suppress
the separate overlay so the text is rendered once.
The service template stores the actual service start time and derives its
automated pre-service start from the timed Welcome montage and final countdown.
The Sunday template has a distinct Pre-service section containing those timed
cues, followed by a Welcome section where the service begins. Older Sunday
templates with a combined Welcome root are split while retaining their cues.
The Start menu stores a service-specific start time and shows the calculated
pre-service start. Changing Welcome cue durations recalculates that pre-service
start while preserving the chosen service time. The section immediately after
Pre-service is marked as the service start in the presenter rail and its timing
editor. Welcome countdown cues can target the service start or a specific clock
time; their configured duration remains a maximum, and the actual service start
also caps them. Imported Pre-service and Welcome sections with the same position
are separated with Pre-service first, and template sections can be reordered by
presenters. Existing queued pre-service times continue
to derive the displayed service start from the Welcome duration.
Announcements also add structured date, location, contact, URL and layout
metadata; sermon/deck controls remain presentation-only so imported pixels are
not rewritten. Preview and live output consume the same options.
An open network display or viewer poll creates a scheduled live presentation at
the dated plan's `queued_start`, selects the current cumulative
item cue, and activates that item's scene. The dedicated Service templates Admin
tab owns this configuration. A legacy recurring schedule can still provide a
fallback start and cleanup window, but no longer owns individual cue boundaries.
When a presenter navigates an automatically started service, manual control
replaces scheduler navigation without ending the scheduled live window; public
livestream discovery and media authorization remain active through the handoff.
Template automation is scoped to the plan's local service date and begins on its
first configured cue at the exact automation start time. The service presenter
reads that authoritative session state, labels the control as automatically
started, and can stop the scheduled service even when its browser did not open
the output window. The first presenter navigation or theme change explicitly
claims the session from the scheduler, preventing the scheduled cue clock from
overwriting manual control; stopping records suppression for the remainder of
that scheduled run so polling cannot immediately recreate it.
For template-only schedules, an automation time later than the service type's
nominal start is treated as the effective start instead of producing an invalid
legacy schedule; this keeps live-service discovery available to livestreams.
Starting slideshow is the human takeover signal. It starts the currently selected
slide without blanking it and continues item-driven audio-scene selection.
Stopping slideshow leaves the current slide visible without blanking it and returns
audio to the safe Pre-service scene rather than taking the scheduled broadcast
offline. The scheduled session is exposed only during its configured window.
Before creating it, the scheduler retires an abandoned live session with no
connected output, so an earlier rehearsal cannot suppress Sunday automation.
Superseding a live service also records its output owner as closed before
clearing the output state. Late heartbeats from the old display are rejected,
so they cannot reclaim live status from the replacement service. A past-date
Welcome slide resets to its waiting background rather than retaining the
historical “Please be seated” phase.
That scheduled window also authorizes its configured camera and audio transports
for ordinary viewers before PresentationOutput is claimed; admin-only manual
tests remain restricted to administrators.

The configured pre- and post-service track is rendered only by the dedicated `/app/media` program-media receiver. Its output is captured as the media source and distributed to every livestream viewer through the selected remote live-audio route. Ordinary slideshow windows, network displays, and livestream viewer browsers never render a local copy. The legacy `room_media_enabled` field no longer mutes the dedicated receiver, because doing so would silence the sole upstream broadcast source. The Pre-service scene excludes desk and room inputs, preventing musicians' rehearsal audio from being published with the online track.

Empty Sermon and Announcements sections open Google Drive deck search when
clicked. A general deck import targets the canonical Sermon placeholder; an
Announcements click targets Announcements. Existing standalone Google Drive
sermon imports are folded into the placeholder by migration. Building an
announcements deck from website events or rota/maintenance data
is an integration boundary: those upstream systems must expose dated structured
records before cSpot can reliably generate the slides.

The Video search tab searches both connected Google Drive video files and the
YouTube Data API. YouTube results are relevance-ordered, append in pages while
the result pane scrolls, and use the selected result's title automatically. The
shared Google OAuth connection includes read-only Drive and YouTube scopes.

### Local presenter sync

The current live output model uses:

- `BroadcastChannel`
- `localStorage`

This keeps the control window and output window in sync inside one browser
environment without requiring a server push channel yet.

### Network TV output

The stable `/tv` display route (with `?presentation=tv` retained for
compatibility) is a passive, authenticated slideshow renderer for a television
browser. Public HTTP requests are upgraded by the browser bootstrap using the
client-visible URL, which avoids ambiguity across nested TLS-terminating proxies.
When the presenter selects **Start**, the presenter control page
creates a server-authoritative output session. The presenter Start control is a
split button: by default it enables network output without opening a local
window, while its dropdown can make the next start also open a local slideshow
window and lets plan editors enable, change, or clear that service's automated
start time.
The session remains active if controller tabs, local output windows, or TV
browsers close or become suspended. Another presenter can reconnect and stop it
explicitly, which causes open desktop output windows to close and TV browsers to
return to waiting. Starting another service ends every other live session, so
only one service can be live across the system. Explicitly started output remains active for historical services too, even when
no local output window sends heartbeats. Cleanup uses the same authoritative
output status as Start/Stop; only legacy heartbeat-only or unclaimed past-service
sessions expire. This allows an operator to replay a previous service without
cleanup blanking or stopping it after the heartbeat timeout. A manually started
replay remains discoverable to displays even if its original scheduled window has ended. This avoids external-monitor wiring
and allows multiple passive displays without output-ownership conflicts. The TV uses a remembered,
least-privilege viewer session; browser fullscreen and autoplay still require
interaction on the television itself.

Identity accounts have a unique, lowercase username in addition to email.
Sign-in accepts either identifier, and remembered sessions include both
`Max-Age` and `Expires` for compatibility with older embedded browsers.

### Remote service viewer

The Broadcast area is viewer-first. Eligible users land on the viewer even when
they can edit its settings. The scheduled pre-service/ready/post-service state or
an explicitly active slideshow output session opens the gate for:

- the active service slideshow
- multiple named camera/stream sources with manual or synchronized weighted cross-fades; automatic pacing uses deterministic jitter and service-aware worship, prayer, sermon, and announcement profiles, with a lectern/pulpit bias
- audio from any configured camera, no audio, or a dedicated Raspberry Pi/desk stream

Administrators can also enable the camera and audio directly from the Livestream
tab without starting presentation output. They choose either a public stream,
visible to all eligible viewers, or an admin-only test stream. Manual mode persists
until an administrator stops it; admin-test state and live audio remain unavailable
to non-admin accounts. Without presentation output, the slide pane shows a live
holding card rather than inventing a slideshow state.

When neither presentation output nor a permitted manual stream is active, both panels remain disabled. During the configured window before the next planned service, the page shows a starting-soon state; configured worship audio is available only when the remote program-audio route is live. Outside that window it clearly shows that no
service is streaming.

Viewer settings are stored in the database and edited from Broadcast Settings.
Camera sources are kept warm in layered players so switching uses an opacity
cross-fade instead of reconnecting. The camera gateway uses MSE over a proxied
WebSocket for low-latency playback, with native/HLS/MJPEG compatibility paths,
a stall watchdog, and automatic reconnection. Slide state is polled separately
at 500 ms and passes through a configurable delay so it can be aligned with the
camera pipeline.

Independent room-microphone, sound-desk return, and church-PC media feeds can
remain private HTTP MP3 inputs. The normal physical media path is PC line-out to
the sound desk, followed by the desk's USB return into CSpot. A parallel PC-media
capture exposes the original playback directly. Because the desk return already
contains that playback, enabling both the desk return and direct media at full
level would create a doubled or delayed echo. Media routing is therefore an
explicit mix-minus: speaking/worship scenes exclude the direct media capture,
while media scenes exclude both the desk return and room microphone.

CSpot keeps source URLs and listener tokens server-side. Camera audio uses the go2rtc transport, while independent and mixed sources use CSpot's authenticated server relay so a gateway on another subnet does not need direct access to a private source. The raw API relay at `/api/v1/broadcast/live-audio` remains available for compatibility and recording. Browsers use
the authenticated `/api/v1/broadcast/live-audio.mp4` variant: FFmpeg emits
roughly 200 ms AAC fragments, the client retains only complete recent
fragments, trims its decoded buffer, and targets about 250 ms behind the live
edge. Known MP3 bridge inputs use explicit demuxing and minimal input probing;
without that, FFmpeg opens and analyzes live inputs sequentially and can add
several seconds of latency for every source in a mix. Camera MSE playback uses
the same live-edge correction policy. Both
routes open only the selected on-air inputs so an unavailable off-air feed cannot
block a healthy desk feed. Viewer audio reconnects when the selected input IDs
change; gain changes use runtime commands without reconnecting the stream. Cancelling the fragmented stream aborts the request and reaps its FFmpeg
process, and the database connection is released before streaming begins. The
same raw upstream remains available to the sermon-recording pipeline. The
administrator's per-source Listen preview uses the normalized transport as well
when the gateway is available.

Camera and mixed audio still originate in separate transport timelines. Keeping
both close to the same bounded live edge prevents accumulating drift, but this
is not sample-accurate A/V synchronization; that would require muxing them into
one timed media stream.

Standalone video on the remote viewer is a visual-only follower: it exposes no
independent controls, is always muted, and follows the presentation's delayed
play, pause, stop, and fade-stop state. The action timestamp is used to seek a
late or newly joined player toward the program-audio position, while all audible
media continues to come from the selected source-mix route. This bounds the
common delayed-start error, although the separate browser video and captured
audio clocks can still require site-specific delay calibration.

Persistent presentation followers have separate responsibilities. `/app/tv`
is always visual-only and mutes pre-service, backing-track, and video audio.
`/app/media` is the church-PC program-media receiver: it discovers the same live
service and follows the same play/pause/stop timestamps, but enables audio for
the Windows endpoint feeding the sound desk and optional `pc-media` loopback.
This receiver requires an interactive desktop browser session; the Audio Bridge
remains a capture service and does not itself render remotely commanded media.

The Broadcast Mixer combines enabled independent sources into one mono live
feed with a saved −30 dB to +24 dB digital trim per source and output limiting.
Five saved scenes define the default role-based routing:

| Scene | Room microphone | Desk return | Direct PC media |
| --- | --- | --- | --- |
| Pastor | On at −18 dB | On at 0 dB | Off |
| Congregation | On at 0 dB | On at −12 dB | Off |
| Worship | On at −12 dB | On at 0 dB | Off |
| Media | Off | Off | On at 0 dB |
| Pre-service (`pre_service`) | Off | Off | On at 0 dB |

Legacy or unclassified sources preserve their current gain/enable state in
Pastor, Congregation, and Worship for backward compatibility, but default to
excluded in Media and Pre-service. Operators can assign explicit roles and tune
site-specific levels; the desk/direct-media exclusion remains the safe starting
point. A silent or powered-down desk does not contribute to Media or Pre-service;
direct PC media remains a separate route. If an HTTP source endpoint itself
disappears while FFmpeg is opening or relaying a mix, hot failover is not yet
guaranteed, so source health still needs to be checked before a service.

With presentation following enabled, scheduled pre-service selects Pre-service,
song slides—including a playing backing track—select Worship, ordinary speaking
slides select Pastor, and playing standalone video selects Media. Media playback
state persists across slide changes within the playing section; pausing,
stopping, finishing, or leaving standalone media restores the scene appropriate
to the current service item. Claiming the main slideshow derives the safe scene
for its current item; releasing it selects Pre-service so speech microphones are
removed during post-service. The server mix drives all normal viewer audio and sermon recording, including pre- and post-service music.

Song backing audio has no viewer-local fallback. The dedicated media receiver renders the track and the selected desk or media capture route carries it to every viewer exactly once. If that source is not selected or available, the viewer reports or experiences the remote-source failure instead of starting an unsynchronized local copy. The Worship route deliberately
uses the full desk return for a backing track, retaining live vocals and
instruments. Combining those live desk channels with a simultaneous direct PC
leg would require a hardware desk aux/matrix mix-minus that excludes the PC
input; software cannot subtract that track reliably from a stereo record-out.

Changing routing, mute, or gain during a sermon closes the current recording
segment and starts another; the segments are joined losslessly when recording
ends so playback remains one continuous item. The full mixer lives in the Mixer
subtab, with a compact copy under the admin camera preview for live operation.

Gateway entries owned by CSpot use opaque names in the reserved
`cspot-audio-*` namespace. Reconciliation creates or updates entries for the
currently configured independent sources and removes stale CSpot-owned entries.
It never treats the opaque name as a user-facing source ID and does not modify
operator-managed camera streams outside that namespace. Camera audio uses its
matching gateway source and stays independent of which camera is visible.
The public frontend proxy exposes only authenticated WebSocket and HLS playback
routes, checks requested source names against the configured camera/audio
allowlist, and returns 404 for go2rtc configuration, stream-inspection, log, and
restart endpoints. Independent input URLs are redacted from ordinary viewer
settings responses.
The optional CSpot Audio Bridge exposes multiple Windows DirectShow or Linux
ALSA inputs as on-demand, shared MP3 streams. Capture stops after the final
consumer disconnects, and the same bridge can move from a Windows church
desktop to a Raspberry Pi without changing the CSpot-side input protocol.
It is a capture service, not a program-audio player: a designated browser or
other playback process must render to the selected Windows output (the default
physical endpoint in the church deployment, or an optional virtual cable)
before the `media` source contains useful audio. Playback occurring only on a
separate television or remote viewer cannot be captured by the church PC.

The portable Windows installer uses an interactive logon task because that is
the most broadly compatible DirectShow setup. On the current church desktop,
the same bridge has also been verified from a limited S4U boot task in Session 0
with its files under `C:\ProgramData\CSpotAudioBridge`. That optional headless
pattern removes the login dependency for capture, but it remains driver-specific
and does not create a headless playback producer. The current deployment has
verified continuous Session 0 streams from both DirectShow inputs and the
default-output WASAPI loopback while no user is signed in; an audible media test
is still needed whenever the Windows output device or driver changes.
PTZ movement remains the camera's own patrol/tour responsibility; CSpot selects
and fades that moving view but does not store camera credentials or issue vendor-
specific movement commands.

Broadcast administration is divided into Recordings, Livestream, and Audio
Mixer tabs. Mixer settings store the shared desk identity, integration type,
control/bridge URL, and installation notes. Digital desks with their own web
interface can be opened directly; OSC/MIDI desks require a model-specific
bridge before native CSpot faders are exposed. An analogue desk can supply
audio through an aux/matrix output, class-compliant USB interface, and Raspberry
Pi, but its physical faders cannot be controlled digitally.

## Presenter Information Architecture

Completed services and their linked worship sets are retained as historical
records. Non-administrators can no longer mutate a plan once its presentation session has
actually ended; passing the configured service start alone does not lock the plan.
Unfinished plans lock when their service day becomes historical. Default selection is
date-based across Service, Worship, and Sunday School. It chooses the earlier
of the next Sunday and the next non-empty plan date; empty records materialized
by calendar browsing do not become defaults. Each mounted view retains its last
explicit calendar selection while switching modules; defaults are reapplied
only after a hard page refresh.

Previous and next date controls use the same relevant-date sequence: the closest
non-empty plan date or Sunday in that direction. Worship date changes fetch only
the selected set and its history; shared catalogs refresh independently.

The current intended presenter layout has three roles:

### 1. Main preview

Shows the currently selected live slide and primary presentation controls.

### 2. Slide sorter

Shows thumbnails for slides and supports direct slide selection.

### 3. Section rail

Shows service structure and supports:

- section jump
- insert between sections
- reorder section
- remove section

## Search and Navigation

The presenter now includes search-driven insertion and Bible navigation.

### Search overlay

Hotkey: `s`

Search modes:

- Bible reference
- Bible keyword
- Songs
- Song lyrics are treated as canonical labelled parts. The presenter can expand
  slides from `Song.sequence`, so repeated choruses/verses do not need duplicated
  lyric text.
- Song saves canonicalize supported part labels, discard invalid or deprecated
  labels, and keep lyric and sequence verse numbers contiguous and aligned.
  Longer sequences retain their deliberate repeated-section arrangement, while
  shorter stale sequences are rebuilt from the current lyric structure.
- Chord-chart JSON version 3 anchors each annotation to a canonical song-section
  label and a line offset within that section. Inserting an earlier verse, tag,
  or missing line therefore leaves annotations in later sections attached to
  their intended lyrics. Version 1 and 2 absolute line positions are converted
  against the current lyrics when read and saved in the new format on the next
  song edit.

### Keyboard behavior

- `Left` / `Right`: slide navigation
- `Up` / `Down`: slide navigation on normal slides
- `Up` / `Down` on reading slides: Bible verse navigation
- `F5`: start slideshow

## Architectural Strengths Right Now

- API startup repairs the required `Worship Set` reference plan type after
  migrations, protecting upgraded installations from incomplete seed data.
- Worship leader assignments are stored by service date independently of
  worship-set plans, allowing the calendar to schedule future leaders before
  any song set is created.
- Shared calendar overlays default to a continuous, month-grouped seven-day
  timeline with native vertical scrolling and a compact Sunday-only alternative.
  Both timelines extend in either direction near their scroll boundaries,
  preserve position when earlier dates are prepended, and omit status text from
  blank slots. Selecting a missing service or worship Sunday transparently creates
  and opens its plan without inserting placeholder plan items. Archive actions in
  these overlays are admin-only.
- Calendar-driven service and worship-set loads are request-ordered: stale
  responses and live-state polls cannot overwrite a newer date selection.
- Service calendar summaries count content supplied by the linked worship set,
  so a service with worship songs but no direct items does not appear empty.
- The service calendar's populated styling is also content-based; merely
  opening a date and creating an empty plan does not leave it highlighted.
- Worship-set calendar styling follows the same content-based rule while
  retaining leader markers independently of whether songs have been added.
- Shared calendar days accept a generic item count and label. The popup renders
  these consistently as number-only badges that remain visible on mobile, so new
  calendar workflows do not need to build or responsively style their own count.
  Counts include explicit leaf content only: service outline/template containers
  are excluded, while Sunday School counts the items added to its lesson board.
- Sunday School edit history includes an Archive action for editors. Archiving
  clears explicitly added lesson content while retaining the dated slot and its
  history, so the lesson can be restored from a previous version.
- Service archives and worship-set stashes leave a fresh empty plan on the same date,
  so archive never removes the calendar foundation or reopens a preparation
  prompt. Their immediate Undo actions discard that replacement and restore the
  archived plan through the permission-checked endpoint.
- Worship set history is split between edit history and reusable stashed sets.
  Stashes are archived worship-set plans exposed with their ordered song items for
  preview. Applying one first stashes the current set, then copies the selected
  stash into the fresh plan on the current date; the source stash remains reusable.
  Editors with plan-delete permission can also permanently delete a stash from
  its preview after confirmation.
- Migration `0031_remove_empty_ends` removes legacy End slides only when they
  are the sole active item in an otherwise empty service; populated services
  and their intentional End slides are preserved.
- Worship and Sunday School leader defaults are deterministic monthly
  round-robin schedules. Each user can have a separate worship and Sunday
  School maximum (null means unlimited), plus an explicit Automatic, Manual,
  or Disabled rotation mode. Manual users remain directly assignable and can
  participate in swaps; Disabled users are omitted from assignment and swap
  controls. Both are omitted from automatic allocation. Explicit
  assignments reserve capacity before automatic gaps are filled. Automatic
  defaults only apply from today forward; historical dates show stored values
  and are omitted from swapping. The Leader dialog supports assignment and
  upcoming-Sunday swaps. `cspot_tablet` is
  kept out of automatic worship rotation while remaining a manual option.
- Sermon recording stores compact Opus audio plus timestamped presentation
  transitions. Automatic start is edge-triggered by a non-sermon-to-sermon move
  while the service session is live, including scheduled services without an
  output window; it does not restart a manually stopped
  recording on later sermon slides. A paused recording resumes on the next sermon
  slide. Leaving the sermon, reaching End, or explicitly stopping the service starts a persisted,
  configurable stop countdown (60 seconds by default); blanking never starts it.
  Returning to a sermon slide cancels the countdown and retains one continuous
  recording. If the countdown expires or End now is chosen, the grace audio is
  trimmed back to the departure point and the archive records the stop reason.
  Before trimming, the complete capture and recording metadata are preserved in
  `storage/recordings/recovery/<recording-id>/`; if preservation fails, trimming is
  skipped. Captures with an automatic departure point under 30 seconds are moved
  to Archived recordings with their full audio retained, rather than deleted.
  The normal archive retention period applies; recovery copies have no automatic
  purge. A deliberate
  stop while still on the sermon retains even a short recording. Recorder transitions
  run on one background worker with a separate database session;
  stream probing and FFmpeg startup never block presenter API requests. Failed
  source probes enter a cooldown instead of retrying on every heartbeat. Automatic
  recording can be disabled persistently from Broadcast settings, preventing
  stream probes and recorder startup while leaving manual recording available.
  Expired grace countdowns are also reconciled when recording status is polled,
  so a failed watcher cannot leave an uncloseable 0:00 banner. On API startup,
  interrupted recording rows are finalized; recoverable segment audio is
  remuxed without deleting the original source files.
  Presenters can use the visible Start, Pause, Resume, and End recording controls;
  broader broadcast configuration remains administrator-only.
  Audio timestamps are generated from emitted samples rather than the live
  source clock, so pausing FFmpeg cannot create an empty multi-hour seek range.
  Finalization probes the media duration and automatically rewrites discontinuous
  timestamps when it differs materially from the expected recording duration.
  Recording controls are hidden behind an off-by-default presenter toggle.
- Every service receives a final End slide. Presenter controls can start, pause,
  resume, and stop recording; moving to a new slide resumes a paused recorder.
  A visible presenter countdown protects brief worship/announcement detours and
  accidental slideshow closure without splitting the sermon archive.
  Broadcast settings can permanently remove completed archive entries and files.
- Presentation output ownership is server-authoritative and persists until an
  authorized presenter explicitly stops it. Stop works across devices, leaves a
  close marker so an older output client cannot reclaim the session, and is
  polled by desktop output windows so they close remotely. Legacy heartbeat-only
  sessions still expire during upgrades. Service-view `B` controls blanking and
  `F` toggles its locally opened output fullscreen.
- An empty worship set offers a five-song suggestion as its first list item.
  Populated rows expose a one-song swap action beside their edit, remove, and
  reorder controls; clicking the row expands or contracts its lyrics on mobile.
- Song-library and set rows show concise usage age and additive worship-slot
  tags. Opening, middle, and closing roles are learned only after the worship-set
  date has passed. Removing a learned role suppresses historical re-learning
  until the song later serves in that position again.
- General suggestions exclude Advent, Christmas, Lent, and Easter categories.
  The empty-set category selector can request themed or musical subsets, while
  recent swap rejections apply a decaying penalty to future suggestions.
- Changing a song's set key defaults to permanently transposing stored chord
  annotations. Switching off the transpose icon beside Key and Capo corrects key
  metadata while preserving chord annotations and legacy chord text;
  capo (0–5) changes display metadata only. Chord controls share the tab row
  on desktop and sit directly below it on mobile, leaving the panel height for
  editing; the guitar diagram sits beside the panel on desktop. Song saves stay in the editor with
  explicit Saved/Unsaved state, and song archiving requires confirmation.
- Song meter and strumming guidance are stored in the nullable `songs.rhythm`
  JSON column (migration `0069_song_rhythm`), exposed by song create/read/update
  schemas. Validation bounds the meter, permits only down/up/rest/muted strokes,
  requires each pattern to fill one bar, and rejects duplicate section overrides.
  `songRhythm.ts` owns presets, count labels, resizing and section matching;
  `SongRhythmEditor` edits metadata in a compact overlay from the Chords tab.
  `SongRhythmDisplay` shows the active section pattern in the musician toolbar,
  with a viewport-bounded reference panel for all counts and feel notes.
  Existing songs need no rhythm metadata, and partial song updates preserve it.
  Rhythm changes participate in the existing save/dirty state and undo history;
  strum strokes and meter are independent of key and capo. Bar-chart chord symbols
  follow permanent key transposition; metadata-only key corrections preserve them.
- Migration `0070_rhythm_presets` adds shared, named meter/strum presets. Music
  preset endpoints enforce song read access for listing and edit/create access
  for creation. Names are checked for duplicates, patterns fill exactly one bar,
  and applied presets are song-local copies, so edits cannot mutate other songs.
- Optional `rhythm.arrangements` stores bar-chart text per whole song or named
  lyric part, and `rhythm.bpm` stores practice tempo. `musicPractice.ts` parses
  evenly spaced or explicit-count chord changes and repeated bars, combines
  charts with section strums and the existing worship sequence, voices chords,
  schedules Web Audio with bounded lookahead, and exports Standard MIDI files
  with a GM guitar, percussion, tempo, meter and balanced note-on/off events.
  Audio and MIDI share the same performance event list. Whole-song charts take
  precedence for chart-only songs; otherwise every sequenced part needs a chart.
  Marked editor lyrics instead supply explicit timing anchors through lyricTiming.ts. Practice charts are bounded to 256 bars / 20 minutes.
  `RhythmPracticeControls` handles listen/stop, count-in, metronome, loop and MIDI
  export in both editor and musician references. Only one preview runs at once;
  unmounts, edits, key changes and hidden tabs stop it. Song normalization includes
  stable property ordering and defaults so saved rhythm metadata is not dirty
  merely because the API canonicalizes JSON fields.
- The song editor has mutually exclusive chord/bar interaction modes in the same
  lyric grid. Bar mode clicks add/remove boundaries immediately, and drag/drop
  moves those boundaries without changing chord annotations or opening inputs.
  `rhythm.markers` stores stable ids, section-relative line indexes and chord-grid
  anchors, reusing the chord section resolver so wrapping does not change position.
  `barMarkers.ts` derives marked-part playback charts from boundaries and chord
  positions. Chords divide each bar evenly; empty later bars hold the prior chord.
  Removing a part's last marker clears its derived chart. Unmarked manual charts
  are retained, and whole-song charts keep their established playback precedence.
  `lyricTiming.ts` maps source lyric anchors to bar spans, equally timed chord
  stops, fixed character widths, wrapped lines and repeated sequence occurrences.
  `LyricMusicControls` provides metronome-only or combined chord-strum playback.
  Its fractional cursor comes from the same AudioContext clock as note scheduling;
  compound meters bounce on dotted-quarter pulses. Both chord editing and Worship
  Live render bar lines and a dot in existing rows. Musical time varies cursor speed
  between anchors; it never stretches lyric characters or changes word spacing. Editor song/part playback and MIDI share these timed bars;
  legacy chart-only songs keep the original playback path. Guided song playback
  requires markers in every remaining sequenced part and provides a one-bar
  metronome lead-in before the first chord change. Existing opening rests provide
  that lead-in; only missing preparation time is prepended.
  Empty bars carry the last played chord across bars, parts and sequence repeats
  in both guided and rhythm-editor playback. Only bars before any chord has played
  remain silent apart from the metronome. No implicit mute is inferred.
  The Worship Live Musician menu consolidates Chords, Bars, Rhythm, view mode
  while Edit song is a direct toolbar action; Dynamics remains disabled until
  annotation support exists. Guided
  playback is gated by the administrator role; the Bars display toggle is available
  to all Worship Live users. Playback permissions are checked separately
  from user-management permissions. CompactControlMenu portals accessible menus
  with arrow-key navigation, Escape, outside dismissal and focus restoration.
  Play chooses metronome, MIDI strum or backing track and becomes direct Stop
  while playing. Worship Live captures the selected page’s occurrence and source
  range at Play, slices the source timeline before resolving annotated chord
  changes, and starts with no inherited chord. Only annotations at each timed
  position change the active chord; subsequent empty bars hold it. Cursor progress adds the captured bar
  offset only after count-in, so it cannot jump back to an earlier page. Page changes
  during playback do not restart audio; a new Play uses the newly selected page.
  PracticeSilentPlayer uses a monotonic timer without constructing AudioContext;
  silent mode includes a full one-bar visual lead-in and omits all note events. Chords, Bars and Dot each use
  per-device Auto/On/Off display modes. Auto shows chords by default and bars/dot
  during playback, including an opted-in shared clock. Explicit On/Off never mutate
  on play/stop. An On dot parks at the last cursor in the current page (or its first
  bar) when idle; this display-only cursor never drives auto-advance. Display modes
  are independent from the playback cursor and source timing. The per-device Follow shared timing option
  lets musician readers animate an administrator's shared clock without audio.
  GET/PATCH /presentation/music-timing/{plan_id} stores a bounded transport snapshot
  in the existing position payload; it preserves slide state and requires admin
  permission to write. An owner id prevents overlapping controllers, heartbeats
  run every two seconds, and disconnected clocks expire after twelve seconds.
  Receivers poll once per second and interpolate on a local monotonic clock using
  server elapsed time and a round-trip estimate, avoiding device wall-clock skew.
  Followers move their own pages and never publish service slide updates; only
  the local playback host does that when synced. Sharing is opt-in and released
  on stop/unmount. Dot visibility and following persist as device preferences.
  This transport is scoped to Worship Live; no congregation overlay is introduced
  and no database migration is needed.
  Pages without a bar boundary report that a boundary is needed rather than jumping
  to the song start. Backing track retains the existing service-audio permission and
  Sync requirement. Hiding bars does not stop guided playback or page turns. Auto page turns use the active bar's source
  start line and sequence occurrence. Coupled playback publishes page changes through
  the normal service slide API and browser broadcasts; uncoupled turns stay local.
  Page changes are deduplicated so beat updates do not republish the same slide.
  `lyricPages.ts` resolves each sequence block within its source section, then
  assigns split pages consecutive source line ranges. Chord rendering, bar/dot
  overlays, wrapping and auto turns share these ranges instead of finding the
  first matching lyric text. Identical pages keep distinct chords and a single
  active dot, including repeat occurrences and the next-page preview.
  Musical overlays do not affect normal lyric character spacing.
  Source positions provide the shared anchor framework for future
  directions/dynamics, without adding persisted unused fields or additional rows.
  Browser synthesis
  uses upper chord tones, a harmonic waveform and sustained decay; MIDI shares the
  same full voicings. No database migration is needed for optional rhythm markers.
- coherent modular monolith shape
- container-first local development
- real end-to-end vertical slices already exist
- presenter workflow is becoming product-centered instead of bolted on
- service content types are being differentiated more correctly

## Known Weaknesses Right Now

### 1. Slide-deck rendering fidelity

The current conversion path can disagree with PowerPoint in text placement,
alignment, or layout fidelity.

### 2. Presenter complexity in one component

`PresentationView.tsx` now holds a large amount of behavior and should likely be
split into smaller subcomponents once the presenter model stabilizes.

### 3. Mixed maturity across modules

Some modules are operational, while others are still scaffolds or partial
implementations.

## Near-Term Improvement Directions

1. Investigate higher-fidelity deck rendering options or stronger LibreOffice
   conversion settings.
2. Split presenter concerns into:
   - stage
   - section rail
   - slide sorter
   - insertion/search dialogs
   - Bible navigation/search
3. Continue converging planning and presenting into one service-builder
   experience.
4. Strengthen import workflows for songs, Bible data, and slide decks.
5. Add focused automated tests around presenter behavior and plan editing.

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

Production browser compatibility includes an iOS 12 / Safari 12 JavaScript fallback
via `@vitejs/plugin-legacy`, with usage-based runtime polyfills in both modern and legacy bundles (Safari 12
can select the modern bundle). Older Safari uses native HLS camera playback and
CSS viewport, camera-ratio, and toolbar positioning fallbacks. Verify older devices
against a production build; the Vite development server requires a modern browser.
Presentation views tolerate missing BroadcastChannel and ResizeObserver; local
output retains storage-event synchronization. Device testing is still needed for
older Safari media playback and layout capabilities.

Roles are independently assignable. A musician without the viewer role gets a
worship-only shell: Broadcast and My Profile are omitted. Worship Live uses explicit
shrinkable overflow geometry for scroll mode and a compact tablet page layout. Touch
devices avoid the keyboard-capture input, skip Page-mode fitting while in Scroll mode,
and only rerender when the live-state timestamp advances. Scroll mode leaves vertical
touch gestures with the lyrics pane instead of capturing them for page navigation.
Admin prevents removal of a user's final direct role and explains that approved
serving assignments are separate from direct access roles.
The shell hides Website, Broadcast, and My Profile when the viewer role is absent.
The Livestream tab also exposes authenticated viewership. A visible viewer sends
a small heartbeat every 15 seconds; the API groups visits under the active
presentation session (or manual livestream), retains per-user accumulated watch
time, and considers a viewer live for 35 seconds after the last heartbeat. An
audio-enabled viewer remains live while background playback is active, including
when mobile JavaScript timers are suspended after the screen locks. Mobile and
tablet mixed audio uses the native MP3 stream and OS media-session controls.
Administrators can expand current and previous events to see names, email
addresses, live status, and watch duration. Hidden tabs without audio stop
accruing time.

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

The Play menu offers MIDI only for guitar chords and strumming with a metronome count-in, then without
metronome clicks during the MIDI, retaining guided slide following
and the same manual segue behaviour as MIDI with metronome.

Strumming includes ⇣ Soft downstroke between Up and Muted in the stroke cycle.
It plays a quiet pitched downstroke with a shorter, lightly damped sustain,
available in saved songs, shared patterns, live playback and MIDI export.

⇡ Soft upstroke complements ⇣ Soft downstroke with the same quiet level and
lightly damped sustain, brushing high strings to low. Both can be saved in
songs and shared patterns and are supported by playback and MIDI export.

Users with song-edit permission can enable Edit in the Worship Live Rhythm
popout to click-edit existing strum strokes, then explicitly Save. The popout is read-only by default; Cancel discards the draft.
Full meter and shared-preset editing remains in the song editor.

The Worship Live rhythm popout groups Edit beside Close, retains the stroke
legend and offers Listen strum / Listen song without part preview, MIDI download
or synthesis help text. Playback checkboxes have larger, spaced tap targets.

Worship Live keeps rhythm playback/tempo options expanded by default. Edit
enables the tempo input as well as stroke editing; Save persists BPM with the
pattern, and Cancel restores both to the saved song values.

Strum grids support 1, 2 or 4 strokes per beat; four uses 1 e & a counts.
Migration 0071 converts existing 8/8 songs and shared strums to 4/4 with doubled
subdivision and half song BPM, preserving the same number of bars, stroke order
and elapsed bar/stroke/chord timing. Explicit chart beat positions are rescaled;
original converted values are backed up for rollback. Custom meter presets remain.

Strum bars with more than eight subdivisions wrap over two rows in the song
rhythm editor and Worship Live reference/edit popout. Counts and stroke order
remain aligned; wrapping changes no musical timing or saved pattern values.

Clicking the current lyrics page during local playback queues a restart of that
slide at the next bar, using the same first-chord entry as other manual segues.
The current bar continues uninterrupted; scroll-mode part clicks work likewise.

Mobile auto-scroll pauses only after an actual vertical touch movement, not
on touch-down. Manual navigation/restarting the same slide and segue completion
resume following; failed segues clear the scroll destination hold.

Worship Live’s Musician menu includes a per-device **Lyric highlight** switch.
Enable it alongside Dot or turn Dot off for lyric highlighting alone; the beat
keeper remains independent. Highlighting progressively fills the current bar using the existing bar/chord timing, including
shared timing, without changing wrapping or auto-scroll. It waits during count-in
and clears when playback stops. This is an approximate lyric guide rather than
syllable-level vocal alignment. Beat one uses a larger, brighter tile and halo
for peripheral visibility, including during count-in.

Shared Worship Live timing recognises worship-leader access from approved
serving roles as well as directly assigned roles, matching the rest of the app’s
authorization. Musicians can follow timing; publishing remains limited to
administrators and worship leaders.

In Worship Live scroll view, scrolling manually pauses automatic following.
A Service-view-style up/down catch-up arrow points toward the current singing
position. Tap it to return to the live lyric position and resume auto-scroll
without seeking playback or changing the shared service selection. Automatic
page changes preserve the manual pause; local and shared timing both support
catch-up.

Paused lyric auto-scroll resumes independently on each device when the live
scroll target reaches the manually chosen position (within 12% of viewport
height, bounded to 12–64 pixels). It waits until touch and momentum scrolling
have settled for 1.2 seconds. The catch-up arrow still resumes immediately.

Lyric highlighting follows the cursor with a twelve-character wave across words, blank timing slots and bar boundaries.
It holds soft amber for the first one-and-a-half visual beats, blending to green afterwards,
aligned with the beat keeper. A soft trail fades continuously over the preceding twelve character positions,
creating a wave with consistent width and a fixed one-em highlight height. A subtle brightness swell follows each
visual beat without moving the timing edge. Previous bars fade out over 450 ms; colour changes
blend over 280 ms. No underline is used. Reduced-motion preferences disable
these transitions.

The lyric wave includes whitespace and blank leading/trailing timing slots.
While following an active shared clock, the receiving device derives its song
and lyric page directly from that clock, even if the band or service selection
still points elsewhere. Followers do not republish those local page changes.

The amber downbeat accent starts at the current bar boundary and extends only
to its right; the fading trail in the preceding bar stays green.

Silent guide shares its clock during a full one-bar visual lead-in, giving
followers time to receive timing before the first lyric/downbeat. Opening rests
do not shorten this preparation bar. Manual segues still have no new count-in.

### Worship Live sync responsiveness

Band page writes collapse queued navigation to the latest selection while a
request is in flight. Service-state reads discard responses from an old plan
or from before local navigation. Shared music timing immediately follows a
successful in-flight update with any intervening start/stop or seek change,
rather than waiting for the next two-second heartbeat. Polling intervals and
local clock animation rates remain unchanged; no LAN transport is introduced.


Worship Live playback offers **Lyrics only**, **Click only**, **Guitar + click**,
and **Guitar only**, plus **Backing track** where available. Pedal mode is opt-in
and off on entry. Select a mode to arm it; the right pedal starts on keydown,
and releasing that starting press does not issue another command. The Play
menu retains the inline Pedal toggle and per-song **Intro** dropdown (0–16 bars,
default 2, saved in `rhythm.intro_bars` with song editing permission).

Pedal starts use one full count-in bar, then the configured number of musical
intro bars on the song's first chord, falling back to its root key. Lyrics only
keeps both phases silent; Click only provides clicks; Guitar + click strums the
intro with clicks; Guitar only clicks the count-in then strums without clicks.
Lyrics, highlighting and page-following wait until the intro finishes. The beat
keeper labels the count-in, then fills a square one segment per intro bar and
shows the chord and bars remaining. A zero-bar intro still has the one-bar
count-in. The same preparation applies when resuming; manual live segues do not
insert a new intro. Shared timing accepts the full negative preparation window.

During playback, right tap advances a slide. Left tap restarts the current slide
unless a destination is queued or playback is within its pickup/entry bar or the
first half of its first full bar; in those cases it steps back. Repeated taps can
walk back several slides without waiting for each segue. Decisions use keydown
timing; tap/hold actions execute on release. Hold left for 0.6 seconds to choose
a section; tap left/right to select, hold right to confirm, or hold left to cancel.
Hold right during playback to pause. Hardware repeats are ignored. Before arming,
pedal presses navigate manually. Superseded jumps cannot release newer holds.

Service and Worship share `SlideKeyCapture`, read-only on mobile with
`inputMode="none"`, focused on initial mount and activation. Worship menus share
`SlideKeyboardCaptureContext` to restore capture on close; lyric taps restore
capture after the focusable lyric block's click. Actual form editing retains
native focus. The diagnostic pedal test and topbar pedal instructions have been
removed. The key picker has its own bounded hit area; mobile Worship toolbar
buttons have at least 44×44-pixel targets, including the landscape control rail.

Worship applies one action-focus policy to the whole view and its portalled
controls: ordinary action clicks (rail, title, slide/song controls and toolbar)
return to pedal capture after the action. Native fields, labels, content editing
and open popups retain focus while in use. Touch key-picker commits and keyboard
Enter/Escape return capture. The shared capture component also recovers idle
body focus after a focused popup is removed or the window regains focus; it does
not reclaim focus from an editing field or open popup. Left/right and Page
Up/Down pedal modes use the same capture policy; changing hardware mode is not
required.

### XR18 mixer

The `mixer` module provides an authenticated local OSC/UDP transport, parameter
catalog, 20 Hz SSE updates, command readback/retries and PostgreSQL-backed
connection/snapshot configuration. It shares one desk session among browser
clients within the single API worker. The Broadcast Mixer surface includes the
XR18 desk alongside the existing software audio mixer. See [XR18 details](xr18-mixer.md).

XR18 layout uses the measured panel width rather than device detection, adapting
strip widths as app navigation or orientation changes. Every bank renders one
horizontally scrollable row with Main LR pinned outside it. `MixerFader` owns independent
pointer capture and relative movement for each strip; `mixerLayout` computes
visible strip capacity with space reserved for Main LR. Expanded fader view uses
a flex column to allocate remaining viewport height to the tracks. Channel
selection never opens or scrolls to processing; editing is explicit on every
screen size. Layout changes send no OSC commands.

XR18 commands use a single in-flight browser batch with latest-value coalescing
per parameter; the original single-command endpoint remains compatible. The
stream explicitly forbids proxy compression/transformation through the public
website rewrite and gateway. Clients detect silent stalls and reopen a complete
snapshot when returning from a background tab. Pending local feedback remains
separate from authoritative hardware readback.

If EventSource delivers no frames, the XR18 dashboard recovers through sequential
state requests at 250 ms intervals. Successful responses refresh the command
freshness guard; polling stops while stream frames arrive normally. Hidden tabs
stop recovery requests, and late responses cannot replace newer stream frames.

Lyric chords support an optional saved playback count independent of their text anchor. In the chord editor, timing controls appear only when editing an existing chord inside a bar; adding chords and editing bar-start chords keep the compact input. Use **Play on** for whole or half counts, then **Loop bar** to audition it with the metronome. Bar markers are required; the first chord starts on count 1. Unassigned changes retain even spacing, or interpolate between assigned counts. Both generated charts and lyric playback use these counts, and the lyric cursor reaches each chord at its assigned count. Moving a chord within the bar preserves its timing. Counts use the meter’s written unit (eighth notes in 6/8).

Explicitly timed changes after the initial chord add a sounding attack when the strum pattern has a rest, muted stroke, or no subdivision at that count. Untimed charts retain their original strumming behavior.

Existing bar markers support meter and strumming-pattern changes: switch to Bars and click a marker (or right-click it in Chords). Choose **This bar only** to restore the preceding settings afterwards, or **Continue until next change** to affect following bars in lyric-chart order. Repeated sections reuse their resolved source-bar settings. **Song defaults** with a continuing scope returns to the song meter and section patterns; **Clear change** removes the override. Moving a marker preserves its settings. Custom strokes and shared strum presets are available. Playback, metronome, chord count selectors, lyric guidance, shared follower timing, and MIDI exports use variable bar lengths while keeping the quarter-note tempo steady. Bar changes are stored in the existing rhythm JSON; no database migration is needed.
