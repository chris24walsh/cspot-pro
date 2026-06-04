from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_permission
from app.modules.site.models import SiteContentBlock
from app.modules.site.schemas import SiteContentBlockRead, SiteContentBlockUpdate

router = APIRouter()


def block_to_read(block: SiteContentBlock) -> SiteContentBlockRead:
    return SiteContentBlockRead(
        id=block.id,
        key=block.key,
        label=block.label,
        block_type=block.block_type,
        value=block.value,
        draft_value=block.draft_value,
        published=block.published,
        updated_at=block.updated_at,
    )


@router.get("/content", response_model=list[SiteContentBlockRead])
def list_site_content(
    session: Session = Depends(get_session),
) -> list[SiteContentBlockRead]:
    blocks = session.scalars(select(SiteContentBlock).order_by(SiteContentBlock.key)).all()
    return [block_to_read(block) for block in blocks if block.published]


@router.get(
    "/content/admin",
    response_model=list[SiteContentBlockRead],
    dependencies=[Depends(require_permission("site:edit"))],
)
def list_site_content_for_admin(
    session: Session = Depends(get_session),
) -> list[SiteContentBlockRead]:
    blocks = session.scalars(select(SiteContentBlock).order_by(SiteContentBlock.key)).all()
    return [block_to_read(block) for block in blocks]


@router.patch(
    "/content/{key}",
    response_model=SiteContentBlockRead,
    dependencies=[Depends(require_permission("site:edit"))],
)
def upsert_site_content(
    key: str,
    payload: SiteContentBlockUpdate,
    session: Session = Depends(get_session),
) -> SiteContentBlockRead:
    block = session.scalar(select(SiteContentBlock).where(SiteContentBlock.key == key))
    if block is None:
        block = SiteContentBlock(
            key=key,
            label=payload.label or key.replace(".", " ").replace("_", " ").title(),
            block_type=payload.block_type or "text",
            value=payload.value,
            published=payload.published,
        )
        session.add(block)
    else:
        block.label = payload.label or block.label
        block.block_type = payload.block_type or block.block_type
        block.value = payload.value
        block.published = payload.published
        block.draft_value = None

    session.commit()
    session.refresh(block)
    return block_to_read(block)
