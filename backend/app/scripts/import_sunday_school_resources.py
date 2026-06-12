from __future__ import annotations

import argparse
from pathlib import Path

from app.core.database import SessionLocal
from app.modules.sunday_school.importer import (
    import_resources_from_default_roots,
    import_resources_from_roots,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import Sunday School lesson resources from local folders."
    )
    parser.add_argument(
        "roots",
        nargs="*",
        help="Optional folders to scan. Defaults to configured Spring folders.",
    )
    args = parser.parse_args()

    roots = [Path(root).expanduser().resolve() for root in args.roots]
    with SessionLocal() as session:
        result = (
            import_resources_from_roots(session, roots)
            if roots
            else import_resources_from_default_roots(session)
        )
    print(f"Scanned {result.scanned} files; imported {result.imported} new resources.")


if __name__ == "__main__":
    main()
