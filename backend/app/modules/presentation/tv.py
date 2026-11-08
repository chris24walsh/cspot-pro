"""Anonymous, read-only TV access restricted to content in active services."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.library import routes as library
from app.modules.library.models import ItemFile
from app.modules.music.models import Song
from app.modules.music.routes import song_to_read
from app.modules.planning import routes as planning
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation import routes as presentation
from app.modules.broadcast.settings import service_schedules
from app.modules.broadcast.routes import viewer_settings

router = APIRouter()


def live_services(session: Session):
    return presentation.list_live_presentation_services(None, session)


def display_plan_ids(session: Session) -> set[str]:
    ids = {service.plan_id for service in live_services(session)}
    plans = [session.get(Plan, plan_id) for plan_id in ids]
    dates = {plan.service_date.date() for plan in plans if plan}
    if dates:
        ids.update(session.scalars(select(Plan.id).join(PlanType).where(
            Plan.deleted_at.is_(None), func.date(Plan.service_date).in_(dates),
            PlanType.name == "Worship Set",
        )).all())
    return ids


def require_display_plan(session: Session, plan_id: str):
    if plan_id not in display_plan_ids(session):
        raise HTTPException(404, "No active TV output for this plan.")


def require_display_file(session: Session, file_id: str):
    plan_ids = display_plan_ids(session)
    if session.scalar(select(ItemFile.id).join(PlanItem).where(
        ItemFile.file_id == file_id, PlanItem.plan_id.in_(plan_ids),
        PlanItem.deleted_at.is_(None),
    ).limit(1)):
        return
    # Plans also inherit persistent images from earlier services. Authorize the
    # files actually supplied to the display, including those inherited images.
    for plan_id in plan_ids:
        detail = planning.get_plan(plan_id, None, session)
        if any(file.file_id == file_id for item in detail.items for file in item.files):
            return
    raise HTTPException(404, "File is not part of the active TV output.")


@router.get("/presentation/live")
def get_live_services(session: Session = Depends(get_session)):
    return live_services(session)


@router.get("/presentation/live/{plan_id}")
def get_live_state(plan_id: str, session: Session = Depends(get_session)):
    require_display_plan(session, plan_id)
    return presentation.get_presentation_live_state(plan_id, None, session)


@router.get("/presentation/pointer/{plan_id}")
def get_pointer(plan_id: str, session: Session = Depends(get_session)):
    require_display_plan(session, plan_id)
    return presentation.get_presentation_pointer(plan_id, None, session)


def display_plan(session: Session, plan_id: str):
    detail = planning.get_plan(plan_id, None, session)
    detail.info = None
    detail.leader_id = None
    detail.teacher_id = None
    for item in detail.items:
        item.teacher_notes = None
    return detail


@router.get("/planning/plans")
def get_plans(session: Session = Depends(get_session)):
    return [display_plan(session, plan_id) for plan_id in display_plan_ids(session)]


@router.get("/planning/plans/{plan_id}")
def get_plan(plan_id: str, session: Session = Depends(get_session)):
    require_display_plan(session, plan_id)
    return display_plan(session, plan_id)


@router.get("/music/songs")
def get_songs(session: Session = Depends(get_session)):
    song_ids = select(PlanItem.song_id).where(
        PlanItem.plan_id.in_(display_plan_ids(session)), PlanItem.deleted_at.is_(None),
    )
    return [song_to_read(song) for song in session.scalars(select(Song).where(
        Song.id.in_(song_ids), Song.deleted_at.is_(None),
    )).all()]


@router.get("/broadcast/viewer-settings")
def get_settings(session: Session = Depends(get_session)):
    return {"service_schedules": service_schedules(viewer_settings(session))}


@router.get("/library/files/{file_id}/slides")
def get_slides(file_id: str, session: Session = Depends(get_session)):
    require_display_file(session, file_id)
    slides = library.list_rendered_slides(file_id, None, session)
    for slide in slides:
        slide.image_url = slide.image_url.replace("/api/v1/", "/api/v1/tv/", 1)
    return slides


@router.get("/library/files/{file_id}/slides/{slide_index}.png")
def get_slide(file_id: str, slide_index: int, session: Session = Depends(get_session)):
    require_display_file(session, file_id)
    return library.get_rendered_slide(file_id, slide_index, None, session)


@router.get("/library/files/{file_id}/download")
def get_file(file_id: str, session: Session = Depends(get_session)):
    require_display_file(session, file_id)
    return library.download_file(file_id, None, session)
