from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.router import api_router
from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.settings import audio_sources
from app.modules.broadcast.transport import reconcile_audio_sources
from app.modules.planning.reference_data import ensure_worship_set_plan_type


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal.begin() as session:
        ensure_worship_set_plan_type(session)
        viewer_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        configured_audio_sources = audio_sources(viewer_settings) if viewer_settings else []
    reconcile_audio_sources(configured_audio_sources)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Modern c-SPOT service planning API.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    return app


app = create_app()
