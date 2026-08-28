from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.router import api_router
from app.core.change_revision import ChangeDomain, change_revision
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

    @app.middleware("http")
    async def publish_durable_changes(request: Request, call_next):
        response = await call_next(request)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and response.status_code < 400:
            prefixes: tuple[tuple[str, ChangeDomain], ...] = (
                ("/api/v1/planning", "planning"),
                ("/api/v1/music", "music"),
                ("/api/v1/identity", "identity"),
            )
            for prefix, domain in prefixes:
                if request.url.path.startswith(prefix):
                    change_revision.bump(domain)
                    break
        return response

    app.include_router(api_router)
    return app


app = create_app()
