from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class PresentationStatus(BaseModel):
    plan_id: str
    status: str
    current_item: str
    slide_index: int


@router.get("/status", response_model=PresentationStatus)
def get_presentation_status() -> PresentationStatus:
    return PresentationStatus(
        plan_id="demo-sunday-service",
        status="ready",
        current_item="Worship set",
        slide_index=0,
    )
