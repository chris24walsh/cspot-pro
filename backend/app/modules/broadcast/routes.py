from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.schemas import BroadcastViewerSettingsRead, BroadcastViewerSettingsUpdate
from app.modules.identity.auth import CurrentUser, require_permission
from app.modules.identity.models import User

router = APIRouter()


def viewer_settings(session: Session) -> BroadcastViewerSettings:
    settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    if settings is None:
        settings = BroadcastViewerSettings(
            stream_title="Sunday Service",
            stream_description="Join us online for worship, prayer, Scripture, and teaching.",
            pre_service_minutes=60,
            starting_soon_message="Our service will begin shortly",
            offline_message="No service is streaming right now",
        )
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def settings_read(settings: BroadcastViewerSettings) -> BroadcastViewerSettingsRead:
    return BroadcastViewerSettingsRead(
        stream_title=settings.stream_title,
        stream_description=settings.stream_description,
        camera_url=settings.camera_url,
        pre_service_audio_url=settings.pre_service_audio_url,
        pre_service_minutes=settings.pre_service_minutes,
        starting_soon_message=settings.starting_soon_message,
        offline_message=settings.offline_message,
    )


@router.get("/viewer-settings", response_model=BroadcastViewerSettingsRead)
def get_viewer_settings(
    _current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    return settings_read(viewer_settings(session))


@router.patch("/viewer-settings", response_model=BroadcastViewerSettingsRead)
def update_viewer_settings(
    payload: BroadcastViewerSettingsUpdate,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    settings = viewer_settings(session)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if (
            field
            in {"stream_title", "pre_service_minutes", "starting_soon_message", "offline_message"}
            and value is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field} cannot be empty"
            )
        if isinstance(value, str):
            value = value.strip()
            if not value and field in {"stream_title", "starting_soon_message", "offline_message"}:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{field} cannot be empty",
                )
            value = value or None
        setattr(settings, field, value)
    session.commit()
    session.refresh(settings)
    return settings_read(settings)
