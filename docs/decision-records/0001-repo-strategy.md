# 0001: Use a New Repository for the Reimplementation

## Status

Accepted

## Context

The existing `chris24walsh/cspot` repository is a working fork of c-SPOT. It is
valuable as a behavioural reference, but the target project is a complete
reimplementation with a more modern language/framework, improved architecture,
updated visuals, container-first lifecycle, and room for new features.

The legacy project is built around Laravel/PHP, Blade templates, older frontend
tooling, and a LAMP-style Docker image. A branch inside that repository would
inherit the old repository shape, history, assumptions, issue context, and
tooling expectations even if most files were deleted.

## Decision

Create a separate sibling repository named `cspot-pro`.

Keep the cloned legacy repository at `../cspot` as a read-only reference while
designing the new product.

## Consequences

Benefits:

- The new project can start with a clean framework, dependency tree, container
  model, test strategy, and CI layout.
- The legacy app remains easy to inspect without mixing old and new files.
- It is clearer to future contributors that this is a reimplementation rather
  than an incremental Laravel upgrade.
- Data migration can be treated as an explicit boundary instead of accidental
  compatibility pressure.

Trade-offs:

- Git history will not directly show line-by-line continuity from the legacy
  implementation.
- Any issues, releases, and deployment documentation from the old project need
  to be intentionally copied or linked if still useful.
- If the GitHub remote should replace the old project eventually, that will be a
  separate publishing decision.

## Notes

A branch on `chris24walsh/cspot` would be reasonable only if the goal were an
incremental Laravel modernization. Because this is a ground-up reimplementation,
the clean repository is the better default.
