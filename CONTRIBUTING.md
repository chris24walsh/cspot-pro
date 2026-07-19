# Contributing to cspot-pro

Thanks for helping improve cspot-pro. Small, focused changes are easiest to
review and safest for teams using the app during live services.

By submitting a contribution, you agree that it may be distributed under the
project's AGPL-3.0-or-later license.

## Before you start

- Search existing issues before opening a new one.
- Open an issue before a large feature or architectural change.
- Do not include private church data, credentials, recordings, licensed lyrics,
  copyrighted Bible text, or purchased lesson material in issues or commits.
- Preserve imported slide decks as-is unless the change explicitly concerns
  conversion.

## Local setup

```bash
cp .env.example .env
docker compose up --build
```

The web app runs at <http://localhost:5173> and the API documentation at
<http://localhost:8000/docs>.

## Pull requests

1. Keep the change scoped and explain the user-visible outcome.
2. Add or update tests for changed behaviour.
3. Update relevant documentation when configuration, architecture, or product
   behaviour changes.
4. Run `npm run build` and the relevant frontend/backend tests.
5. Call out migrations, breaking changes, and manual deployment steps.

Use native in-app dialogs rather than browser prompts, keep presenter UI dense,
and avoid destructive migration or deployment behaviour.

## Branches and remote testing

Create a short-lived `feature/<topic>`, `fix/<topic>`, or `docs/<topic>` branch
and merge it through a reviewed pull request. Do not push directly to `main` or
test against production data. GitHub CI checks the frontend and backend.

For device or integration testing, use the isolated private environment in
[docs/collaboration-and-sandbox.md](docs/collaboration-and-sandbox.md).
