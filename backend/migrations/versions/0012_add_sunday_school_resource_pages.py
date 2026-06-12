"""add sunday school resource page ranges

Revision ID: 0012_add_sunday_school_resource_pages
Revises: 0011_add_sunday_school_resources
Create Date: 2026-06-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_add_sunday_school_resource_pages"
down_revision: str | None = "0011_add_sunday_school_resources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sunday_school_resources", sa.Column("page_start", sa.Integer(), nullable=True))
    op.add_column("sunday_school_resources", sa.Column("page_end", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("sunday_school_resources", "page_end")
    op.drop_column("sunday_school_resources", "page_start")
