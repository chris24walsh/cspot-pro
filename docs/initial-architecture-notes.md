# Initial Architecture Notes

## Product Shape

cspot-pro should preserve the useful parts of c-SPOT while making the system
easier to evolve:

- Service and event planning calendar
- Plan running order with ordered items
- Songs, lyrics, chords, sequence, keys, and attachments
- Teams, roles, instruments, availability, and reminders
- Resources and file attachments
- Presentation/projection mode with optional synced controller view
- Bible passage lookup/import
- Internal notes/messages where they still add value
- Administration for users, roles, plan types, defaults, and customization

## Recommended Repository Direction

Start as a modular monolith rather than microservices.

Reasoning:

- The domain is connected: plans, items, songs, teams, and presentation all touch
  each other.
- A monolith is easier to run locally, test, containerize, and deploy for a
  personal/small-church tool.
- Module boundaries can still be explicit so future extraction is possible.

Suggested modules:

- `identity`: users, auth, roles, permissions
- `planning`: plans, plan types, ordered items, notes
- `music`: songs, lyrics, chords, OnSong import/export, attachments
- `people`: teams, instruments, availability, reminders
- `presentation`: slide generation, offline cache, synced control
- `library`: resources, files, Bible content/references
- `imports`: provider-specific import workflows and provenance tracking

## Container Strategy

Use Docker Compose from the beginning:

- web application container
- database container
- cache/queue container if needed
- worker container for background jobs such as imports, email, and slide
  generation
- optional local object storage later for uploaded files

Production images should be small, pinned, and built from the application rather
than a full LAMP-style machine image.

## Data Strategy

Treat the legacy database as source material, not the new schema.

Early work should include:

- documenting legacy tables and relationships
- designing a cleaner schema
- writing import scripts from legacy MySQL exports once the new domain model is
  stable enough

## Lyrics Import Strategy

Build lyrics import as an extensible workflow, not a single scraper.

Recommended flow:

1. A user searches or pastes a source URL/text.
2. A provider module fetches or parses where permitted.
3. The app shows a review screen before saving.
4. Saved lyrics retain source, imported date, license/status, and confidence.
5. The user can edit lyrics after import.

Provider modules should be isolated behind an interface so new sources can be
added without changing song editing or plan features.

Important constraint: many lyric sites restrict copying, automated access, or
redistribution. Even for personal use, the app should avoid bypassing access
controls or building brittle automated scraping against sites that disallow it.
Support manual paste/import, public-domain and permissively licensed sources,
and source-specific providers only where terms and robots rules allow it.

## Candidate Stack

To confirm before scaffolding:

- Backend: Python with FastAPI, or another language you are happier maintaining
- Frontend: React + TypeScript, likely Vite
- Database: PostgreSQL
- ORM/migrations: SQLAlchemy + Alembic if Python is chosen
- Tests: pytest for backend, Playwright for browser flows
- Background jobs: lightweight worker first, queue later if needed

This keeps the app portable, testable, and familiar to modern tooling without
over-splitting it too early.
