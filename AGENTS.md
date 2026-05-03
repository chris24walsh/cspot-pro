# cspot-pro Agent Notes

This file gives future contributors and coding agents a compact operating
context for the repo.

## What This Project Is

`cspot-pro` is a clean reimplementation of the legacy `cspot` church service
planning tool with a container-first workflow, a modern web stack, and a strong
focus on presentation usability.

The legacy app in `../cspot` remains the behavioural reference. This repo is
the new source of truth for architecture, product direction, and future
implementation.

## What Matters Most

1. Presenting a church service smoothly is the core experience.
2. Plans are made of sections, and sections are made of slides.
3. Song slides should be easy to create, consistent in formatting, and quick to
   navigate while presenting.
4. Imported sermon and slide-deck content should be preserved as-is rather than
   reparsed into worship-style slides.
5. The app should remain portable, testable, and easy to expand.

## Product Direction

- Treat the app as a modular monolith.
- Prefer explicit module boundaries over clever abstractions.
- Keep the UI dense and work-focused rather than spacious and marketing-like.
- Minimize wasted space, especially in the presenter workflow.
- Prefer native in-app dialogs and overlays over browser prompts.
- Avoid destructive operational steps unless explicitly requested by the user.

## Current UX Shape

- `Present` is the default landing workflow.
- The presenter surface is split into:
  - main preview
  - slide sorter
  - section rail
- The section rail is for structure management:
  - jump to section
  - reorder section
  - remove section
  - insert new section between existing sections
- The slide sorter is for selecting specific slides inside a section.

## Keyboard Expectations

- `Left` / `Right`: previous and next slide
- `Up` / `Down`: same as previous and next on normal slides
- `Up` / `Down` on Bible reading slides: previous and next verse
- `s`: open search overlay
- `F5`: start slideshow

## Documentation To Keep Updated

When architecture or product direction changes, update these files in the same
change where practical:

- `README.md`
- `docs/project-context.md`
- `docs/current-architecture.md`
- `docs/legacy-feature-map.md` when parity assumptions change

## Known Active Concern

Imported slide-deck rendering currently depends on LibreOffice conversion. The
browser-side proportional scaling is in place, but remaining fidelity gaps may
still come from LibreOffice export differences compared with PowerPoint.
