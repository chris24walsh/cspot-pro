import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session
from urllib.parse import quote

from app.core.config import settings
from app.core.database import get_session
from app.modules.identity.auth import require_permission
from app.modules.identity.models import User
from app.modules.integrations.google_drive import (
    build_google_drive_authorize_url,
    build_google_drive_state,
    decode_google_drive_state,
    exchange_google_drive_code,
    fetch_google_profile,
    google_drive_status,
    import_google_drive_file,
    list_google_drive_decks,
    revoke_google_drive_connection,
    upsert_google_drive_connection,
)
from app.modules.integrations.schemas import (
    GoogleDriveFileRead,
    GoogleDriveImportRead,
    GoogleDriveImportRequest,
    GoogleDriveStatusRead,
)
from app.modules.library.routes import UPLOAD_ROOT, stored_file_to_read

router = APIRouter()


def _drive_redirect_target(result: str) -> str:
    base = (settings.public_app_url or "http://localhost:5173").rstrip("/")
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}googleDrive={quote(result, safe='')}"


@router.get("/google-drive/status", response_model=GoogleDriveStatusRead)
def get_google_drive_status(
    _current_user: User = Depends(require_permission("library:read")),
    session: Session = Depends(get_session),
) -> GoogleDriveStatusRead:
    return google_drive_status(session)


@router.get("/google-drive/connect")
def connect_google_drive(
    current_user: User = Depends(require_permission("users:manage")),
) -> RedirectResponse:
    try:
        state = build_google_drive_state(user_id=current_user.id)
        return RedirectResponse(build_google_drive_authorize_url(state=state))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/google-drive/callback")
def complete_google_drive_connect(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_session),
) -> RedirectResponse:
    if error:
        return RedirectResponse(_drive_redirect_target(f"error:{error}"))
    if not code or not state:
        return RedirectResponse(_drive_redirect_target("error:missing-code"))

    try:
        payload = decode_google_drive_state(state)
        user_id = payload.get("sub")
        if not isinstance(user_id, str):
            raise ValueError("Invalid Google Drive connection state.")
        user = session.get(User, user_id)
        if user is None or not user.active:
            raise ValueError("The user who started this Google Drive connection is no longer active.")
        token_data = exchange_google_drive_code(code)
        profile = fetch_google_profile(str(token_data["access_token"]))
        upsert_google_drive_connection(
            session=session,
            connected_by_user=user,
            token_data=token_data,
            profile=profile,
        )
        return RedirectResponse(_drive_redirect_target("connected"))
    except (jwt.InvalidTokenError, ValueError, KeyError) as exc:
        return RedirectResponse(_drive_redirect_target(f"error:{str(exc)}"))


@router.delete("/google-drive/connection", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_google_drive(
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    revoke_google_drive_connection(session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/google-drive/files", response_model=list[GoogleDriveFileRead])
def search_google_drive_files(
    q: str = Query(default="", max_length=120),
    _current_user: User = Depends(require_permission("library:create")),
    session: Session = Depends(get_session),
) -> list[GoogleDriveFileRead]:
    try:
        return list_google_drive_decks(session, query=q.strip())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/google-drive/import", response_model=GoogleDriveImportRead, status_code=status.HTTP_201_CREATED)
def import_google_drive_deck(
    payload: GoogleDriveImportRequest,
    current_user: User = Depends(require_permission("library:create")),
    session: Session = Depends(get_session),
) -> GoogleDriveImportRead:
    try:
        stored, source = import_google_drive_file(
            session=session,
            file_id=payload.file_id,
            display_name=payload.display_name,
            uploaded_by_user_id=current_user.id,
            upload_root=UPLOAD_ROOT,
        )
        return GoogleDriveImportRead(file=stored_file_to_read(stored), source=source)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
