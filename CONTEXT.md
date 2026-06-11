# Cspot Execution Context

## Facts

- Core priority: reliable live presentation for church services.
- Repo: `/home/chwalsh/dev/cspot-modern`; prod host: `plex`; prod repo: `/home/chris/plex/cspot-pro`.
- After user-facing code changes, commit/push, pull on prod, and rebuild `cspot-api`, `cspot-web`, `cspot-db`.
- Deploy command:
  `ssh -o BatchMode=yes -o ConnectTimeout=8 plex 'cd /home/chris/plex/cspot-pro && git pull --ff-only origin main && cd /home/chris/plex && docker compose up -d --build cspot-api cspot-web cspot-db && docker compose ps cspot-api cspot-web cspot-db'`
- Presenter is the main service-control surface: preview, slide sorter, section rail, notes, search, and slideshow controls.
- Imported sermon/deck slides must be preserved visually and shown fully in preview/live via proportional image scaling and white pillarbox/letterbox space.
- Do not force rendered slide images to `width: 100%; height: 100%`; scale from natural image size into available frame.
- Sermon/image previews need maximum vertical space; avoid headers/toolbars that reduce scaled content size.
- Song and Bible text previews may use a faint, compact top label strip for context.
- Mobile presenter controls should stay as small separate edge buttons, not grouped panels over slide content.
- Mobile dark/blank controls are button-style with state color; desktop dark/blank controls are toggle-style.
- Blank state, theme state, and live slide state sync through presentation live state, localStorage, BroadcastChannel, and backend polling.
- Blank changes should publish the exact next value immediately to avoid stale cross-device sync.
- Arrow-key presenter navigation should be keydown-only to avoid double-advancing.
- Sorter/rail should auto-follow live slide when already in sync; if operator scrolls away, show catch-up arrow after delayed latest-slide check.
- Worship builder mobile default tab is `Set`.
- Worship set mobile song-item buttons must fit inside the card; use compact 2x2 controls.
- Sorter section cards should not show `sermon` or `reading` type text; titles should align left.
- Worship live fullscreen uses native Fullscreen API where available and a fixed-position mobile fallback when unavailable/rejected.
- Remote control of the church display from mobile/tablet is a desired direction.
- Longer-term feature areas: Sunday school, teacher scheduling, remote streaming view, and camera/OBS-style service overlay.

## Assumptions

- Prioritize live-service reliability bugs before new feature work.
- Prefer compact UI fixes that reduce wasted space without changing core workflows.
- Keep presenter UI dense and operational, not spacious or decorative.
- Treat mobile/tablet behavior as production-critical, especially preview visibility, blanking, fullscreen, and navigation.
- Keep sorter thumbnails compact unless full-content fidelity is explicitly required there.
- Do not pull Sunday school, scheduling, streaming, or camera automation into current scope unless explicitly requested.

## Unknowns

- Whether browser/device limits allow true one-click fullscreen on all target mobile/tablet devices.
- Whether remote fullscreen/control of the external display needs a dedicated display client.
- Preferred policy for disabling slideshow start: device-based, role-based, or user setting.
- Whether notes should autosave visibly, use explicit save, or both.
- Whether sorter thumbnails should eventually pillarbox fully despite smaller readable content.

## Current Priorities

1. Stabilize presenter live state: navigation, blanking, sync, catch-up, and fullscreen.
2. Preserve imported sermon/deck slide fidelity in preview and live output.
3. Tighten mobile/tablet presenter and worship workflows.
4. Improve history, notes, Bible search, and song search.
5. Define remote display-control architecture.

## Next 3 Tasks

1. Decide and implement disabling slideshow start on tablet/mobile or by user role.
2. Fix mobile history access and scrolling in worship/service live views.
3. Fix Bible search for numbered books with chapter/verse queries.
