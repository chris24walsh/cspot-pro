from fastapi import APIRouter

from app.api.capabilities import router as capabilities_router
from app.modules.broadcast.routes import router as broadcast_router
from app.modules.communication.routes import router as communication_router
from app.modules.identity.routes import router as identity_router
from app.modules.imports.routes import router as imports_router
from app.modules.integrations.routes import router as integrations_router
from app.modules.library.routes import router as library_router
from app.modules.music.routes import router as music_router
from app.modules.people.routes import router as people_router
from app.modules.planning.routes import router as planning_router
from app.modules.presentation.routes import router as presentation_router

api_router = APIRouter()


@api_router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/api/v1/app", tags=["system"])
def app_info() -> dict[str, object]:
    return {
        "name": "cspot-pro",
        "modules": [
            "identity",
            "integrations",
            "planning",
            "music",
            "people",
            "library",
            "presentation",
            "broadcast",
            "communication",
            "imports",
        ],
    }


api_router.include_router(capabilities_router, prefix="/api/v1", tags=["capabilities"])
api_router.include_router(identity_router, prefix="/api/v1/identity", tags=["identity"])
api_router.include_router(integrations_router, prefix="/api/v1/integrations", tags=["integrations"])
api_router.include_router(planning_router, prefix="/api/v1/planning", tags=["planning"])
api_router.include_router(music_router, prefix="/api/v1/music", tags=["music"])
api_router.include_router(people_router, prefix="/api/v1/people", tags=["people"])
api_router.include_router(library_router, prefix="/api/v1/library", tags=["library"])
api_router.include_router(presentation_router, prefix="/api/v1/presentation", tags=["presentation"])
api_router.include_router(broadcast_router, prefix="/api/v1/broadcast", tags=["broadcast"])
api_router.include_router(
    communication_router,
    prefix="/api/v1/communication",
    tags=["communication"],
)
api_router.include_router(imports_router, prefix="/api/v1/imports", tags=["imports"])
