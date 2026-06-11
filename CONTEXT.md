# Cspot Execution Context

## Facts

- Core priority: reliable live presentation for church services.
- Current active work centers on presenter, worship live, mobile/tablet live view, slide preview, dialogs, history, notes, Bible search, and song search.
- Imported decks must remain visually intact and be pillarboxed correctly in preview and live slideshow.
- Mobile/tablet live use is operationally important, but starting the external slideshow from those devices may need to be blocked.
- Worship live fullscreen uses the native Fullscreen API where available and a fixed-position mobile fallback when the API is missing or rejected.
- Presenter catch-up arrows are recalculated after live-slide navigation settles, with stale delayed checks ignored.
- Imported slide images must keep intrinsic sizing inside preview/output frames; avoid forcing rendered images to `width: 100%; height: 100%`.
- Main presenter preview should show full imported slide content with contained/pillarboxed rendering; sorter thumbnails may stay compact for navigation.
- Rendered slide images should be explicitly scaled from natural image dimensions to the available preview/live frame; bars should be white.
- Remote control of the church display from mobile/tablet is a desired direction.
- Longer-term feature areas: Sunday school, teacher scheduling, remote streaming view, and camera/OBS-style service overlay.

## Assumptions

- Prioritize live-service bugs before new feature work.
- Prefer compact UI fixes that reduce wasted space without changing core workflows.
- Treat mobile fullscreen, blanking, catch-up state, and history access as live-operation reliability issues.
- Keep Sunday school, scheduling, streaming, and camera automation out of the immediate stage unless explicitly pulled forward.

## Unknowns

- Whether browser/device limits allow true one-click fullscreen on all target mobile/tablet devices.
- Whether remote fullscreen control of the external display is possible without a dedicated display client.
- Exact screens where imported slide pillarboxing still fails.
- Preferred policy for disabling slideshow start: device-based, role-based, or user setting.
- Whether notes should autosave visibly, via explicit save, or both.

## Prioritized Stages

1. Stabilize live presentation controls and state.
2. Fix preview/live rendering fidelity and responsive layouts.
3. Tighten mobile/tablet workflows and dialogs.
4. Improve search, history, and notes usability.
5. Design remote display control path.
6. Defer Sunday school, scheduling, streaming, and camera overlay until live-service basics are solid.

## Next 3 Tasks

1. Decide and implement the policy for disabling slideshow start on tablet/mobile or by user role.
2. Fix blank toggle reliability so the first `B` press consistently holds.
3. Fix mobile history access and scrolling in worship/service live views.
