from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_permission

router = APIRouter()


class PresentationStatus(BaseModel):
    plan_id: str
    status: str
    current_item: str
    slide_index: int


@router.get("/status", response_model=PresentationStatus)
def get_presentation_status(
    _current_user: User = Depends(require_permission("presentation:use")),
) -> PresentationStatus:
    return PresentationStatus(
        plan_id="demo-sunday-service",
        status="ready",
        current_item="Worship set",
        slide_index=0,
    )
