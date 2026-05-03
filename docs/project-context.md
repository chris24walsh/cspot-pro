# Project Context

This document captures the intent that has been communicated while shaping
`cspot-modern`. It is meant to be useful both for humans joining the project
and for coding agents that need durable context between sessions.

## Core Purpose

`cspot-modern` is a complete reimplementation of the legacy `cspot` church
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

## Product Priorities

In rough order:

1. Build and manage a church service plan end to end.
2. Present that plan reliably in a live setting.
3. Make songs, Bible passages, and sermon decks easy to add and operate.
4. Keep the system modular enough that future features can be added without
   major rework.
5. Preserve the useful behaviour of the original app while improving the
   information density, workflow, and maintainability.

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

## Confirmed UX Preferences

These preferences have been made explicit and should guide future changes.

### Presenter workflow

- `Present` should be the default landing view.
- The presenter UI should prioritize the actual service flow rather than acting
  as a passive preview page.
- The main preview should be balanced against a visible slide sorter and section
  rail.
- Section management belongs in the section rail, not on every slide tile.
- Insert actions should happen in context, especially between sections.

### Interaction style

- Use app-native confirmation dialogs rather than browser prompts.
- Avoid persistent success banners that clutter the interface.
- Keep error messages visible enough to be actionable.
- Use keyboard navigation aggressively where it helps live operation.

### Song handling

- New songs should support paste-in lyrics and formatting assistance.
- Worship songs should be normalized into a consistent slide structure.
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
