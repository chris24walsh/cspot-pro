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
- Mobile service preview `Audio`, `Light`, and `Blank` controls should be button-style like calendar/history controls, with active state shown by reversed color contrast.
- Service preview toggle buttons should use icons rather than initial letters.
- Blank state, theme state, and live slide state sync through presentation live state, localStorage, BroadcastChannel, and backend polling.
- Blank changes should publish the exact next value immediately to avoid stale cross-device sync.
- Arrow-key presenter navigation should be keydown-only to avoid double-advancing.
- Sorter/rail should auto-follow live slide when already in sync; if operator scrolls away, show catch-up arrow after delayed latest-slide check.
- Only one slideshow/output window should be active across devices; block starting another while one device already owns the output.
- Mobile dialogs/overlays must fit and remain scrollable.
- Mobile service calendar/search and worship set picker use single-column scrollable dialogs on small screens.
- Mobile text inputs use 16px font sizing to avoid disruptive browser auto-zoom.
- Worship builder mobile default tab is `Set`.
- Worship set mobile song-item buttons must fit inside the card; use compact 2x2 controls.
- Service and worship edit history lists show newest entries first.
- Sorter section cards do not show `sermon` or `reading` type text; titles align left.
- Worship live key dropdown keeps the current, original, and open absolute-key options available after alternatives are chosen.
- Service and Sunday School song search match lyrics as well as titles/metadata.
- Bible reference search supports numbered books and compact references, e.g. `1Kings3:5` and `2Tim1:7`.
- Bible import supports KJV JSON and eBible VPL zip; ASV is public domain and preferred default when available.
- Copyrighted Bible versions such as ESV/NIV/NKJV need licensed source text or an approved API before DB import.
- Sunday School is now an active module for date-based emergency-cover lesson preparation.
- Sunday School lesson structure: theme, Bible reference/story, crafts, songs, games, source notes, cover notes.
- Sunday School plan view is accordion-first, especially for mobile: opening one lesson element closes the others.
- Sunday School date/calendar selection is hidden behind a compact calendar/date button.
- Sunday School resources are imported as metadata/file links from local Spring 2026 folders, classified into packets, Bible, craft, game, coloring/activity, worksheet, and media.
- Sunday School calendar shading is teacher-name based; no full roster/scheduling model exists yet.
- Worship live fullscreen uses native Fullscreen API where available and a fixed-position mobile fallback when unavailable/rejected.
- Remote control of the church display from mobile/tablet is a desired direction.
- Longer-term feature areas: teacher scheduling, remote streaming view, and camera/OBS-style service overlay.

## Assumptions

- Prioritize live-service reliability bugs before new feature work.
- Prefer compact UI fixes that reduce wasted space without changing core workflows.
- Keep presenter UI dense and operational, not spacious or decorative.
- Treat mobile/tablet behavior as production-critical, especially preview visibility, blanking, fullscreen, and navigation.
- Keep sorter thumbnails compact unless full-content fidelity is explicitly required there.
- Do not pull scheduling, streaming, or camera automation into current scope unless explicitly requested.
- Do not copy purchased lesson body text into DB; keep source files linked and store only concise metadata/summaries.

## Unknowns

- Whether browser/device limits allow true one-click fullscreen on all target mobile/tablet devices.
- Whether remote fullscreen/control of the external display needs a dedicated display client.
- Preferred policy for disabling slideshow start: device-based, role-based, or user setting.
- Whether notes should autosave visibly, use explicit save, or both.
- Whether sorter thumbnails should eventually pillarbox fully despite smaller readable content.
- Exact ownership/release rule for single active slideshow across devices.
- Which licensed Bible source/provider to use for ESV, NIV, NKJV, NLT, and other popular copyrighted versions.

## Current Priorities

1. Stabilize presenter live state: navigation, blanking, sync, catch-up, fullscreen, and single-output ownership.
2. Verify mobile service overlays and controls on device: preview toggles, history, calendar, search, scrolling, and input zoom.
3. Verify mobile/tablet worship workflows on device: history order, set picker scrolling, and live key selection.
4. Build out Sunday School resource import/print workflows.
5. Improve notes UX and remaining search/history edge cases found during device testing.

## Next 3 Tasks

1. Verify mobile service fixes on device: icon preview buttons, fluid sorter/rail follow, history, dialogs, audio routing, Drive-only deck import, and single-output blocking.
2. Verify worship mobile fixes on device: newest-first history, set picker scrolling, and original/open key options in live key dropdown.
3. Decide licensed Bible source/provider for ESV/NIV/NKJV/NLT before importing copyrighted versions.
