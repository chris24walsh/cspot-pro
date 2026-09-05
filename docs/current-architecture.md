# Development environments

## Service template persistence

`POST /planning/plans/{id}/sections` copies a default section and its children in
one transaction. `PATCH /planning/items/{id}` accepts `save_template`; it updates
only the owning service type's matching default configuration. The JSON
`template_id` preserves identity through renames, and outline edits retain
existing DefaultItem IDs. `POST /planning/plans/{id}/save-outline` saves structure
and reusable configuration, excluding song selections, uploads and dated
announcement details. Planning editors can create and populate templates; global
service-type administration retains its existing permission checks.

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
displays, livestream, or both. Audio scenes are administrator-defined mixes of
the configured inputs and include a separate `room_media_enabled` decision.
The seeded Pre-service scene sends PC music to livestream/recording while
keeping it out of the room; the seeded Post-service scene also enables room
playback. Scene activation follows item selection, including automatic cues.
Backing-audio playback is owned by each song item and uses the shared live
presentation media command, so Service Live and Worship Live show and control
the same playback state. Administrators can persistently couple Worship Live
navigation to Service Live (jumping to the first worship item) or decouple it
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

The configured pre-service track is still a transitional browser-rendered source,
not an input owned by the server-side source mixer. Each remote viewer renders
that track directly; browser policy may require one sound-enabling click for a
YouTube source, while a direct audio URL can normally autoplay. The active
scene's `room_media_enabled` flag decides whether the presentation-output copy
is sent through the PC line-out to the sound desk. The Pre-service scene keeps
that route off while the Post-service scene enables it. The Pre-service scene also
excludes desk and room inputs, preventing musicians' rehearsal audio from being
published with the online track. A future server-side program-audio source can
replace this transitional split without changing the scene boundary.

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
window.
The session remains active if controller tabs, local output windows, or TV
browsers close or become suspended. Another presenter can reconnect and stop it
explicitly, which causes open desktop output windows to close and TV browsers to
return to waiting. Starting another service ends every other live session, so
only one service can be live across the system. Any unclosed session whose
service date is before the current Europe/Dublin date is ended during the next
live-state cleanup pass. This avoids external-monitor wiring and allows multiple
passive displays without output-ownership conflicts. The TV uses a remembered,
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

When neither presentation output nor a permitted manual stream is active, both panels remain disabled. During the configured
window before the next planned service, the page shows a starting-soon state and
can offer configured worship audio. Outside that window it clearly shows that no
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

CSpot reconciles each configured input into go2rtc as an FFmpeg-backed AAC
stream, so viewers receive independent and camera audio through the same
fragmented-MP4 MSE path and HLS compatibility path. The source URL and any
listener token stay server-side. The authenticated raw API relay at
`/api/v1/broadcast/live-audio` owns the server-side mix used for independent
audio playback and remains the compatibility fallback. Browsers normally use
the authenticated `/api/v1/broadcast/live-audio.mp4` variant: FFmpeg emits
roughly 200 ms AAC fragments, the client retains only complete recent
fragments, trims its decoded buffer, and targets about 250 ms behind the live
edge. Known MP3 bridge inputs use explicit demuxing and minimal input probing;
without that, FFmpeg opens and analyzes live inputs sequentially and can add
several seconds of latency for every source in a mix. Camera MSE playback uses
the same live-edge correction policy. Both
routes' FFmpeg filter graphs accept runtime gain and mute commands, so
compatible mixer changes reach an existing browser stream without reconnecting
it. Cancelling the fragmented stream aborts the request and reaps its FFmpeg
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
removed during post-service. The server mix drives normal viewer audio and
sermon recording. The transitional browser-local pre-service player described
above is the explicit exception.

Song backing audio has a compatibility fallback as well. When the selected live
route contains either the desk program or an enabled source explicitly assigned
the `media` role, the remote viewer suppresses its own YouTube backing iframe so
the captured PC media is heard exactly once. If neither program path is routed,
the legacy viewer-local iframe remains available instead of assuming that an
unclassified or silent source contains the track. The Worship route deliberately
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
records. Non-administrators can no longer mutate a plan once its service type's
configured start time has passed; types without a start time remain editable
through the service day and lock the following day. Default selection is
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
  while the output session is active; it does not restart a manually stopped
  recording on later sermon slides. A paused recording resumes on the next sermon
  slide. Leaving the sermon, reaching End, or closing output starts a persisted,
  configurable stop countdown (60 seconds by default); blanking never starts it.
  Returning to a sermon slide cancels the countdown and retains one continuous
  recording. If the countdown expires or End now is chosen, the grace audio is
  trimmed back to the departure point and the archive records the stop reason.
  Automatic captures shorter than 30 seconds are discarded after an automatic
  departure instead of being saved as false-positive sermon archives. A deliberate
  stop while still on the sermon retains even a short recording. Recorder transitions
  run on one background worker with a separate database session;
  stream probing and FFmpeg startup never block presenter API requests. Failed
  source probes enter a cooldown instead of retrying on every heartbeat. Automatic
  recording can be disabled persistently from Broadcast settings, preventing
  stream probes and recorder startup while leaving manual recording available.
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
- Changing a song's set key permanently transposes stored chord annotations;
  capo (0–5) changes display metadata only. Song saves stay in the editor with
  explicit Saved/Unsaved state, and song archiving requires confirmation.
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
