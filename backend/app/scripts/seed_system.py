from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.identity.models import Role
from app.modules.identity.permissions import ROLE_DEFINITIONS
from app.scripts.import_bible import autoload_kjv_if_missing
from app.scripts.seed_demo import get_or_create, seed_reference_data


def seed_roles(session: Session) -> None:
    for name, definition in ROLE_DEFINITIONS.items():
        get_or_create(
            session,
            Role,
            name=name,
            defaults={"description": str(definition["description"]), "system_role": True},
        )


def main() -> None:
    with SessionLocal() as session:
        seed_roles(session)
        seed_reference_data(session)
        session.commit()
        try:
            autoload_kjv_if_missing(session)
        except Exception:
            session.rollback()
        print("Seeded cspot-pro system data.")


if __name__ == "__main__":
    main()
