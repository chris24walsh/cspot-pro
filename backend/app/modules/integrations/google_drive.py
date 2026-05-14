from __future__ import annotations

from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
import secrets
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.models import User
from app.modules.integrations.models import OAuthConnection
from app.modules.integrations.schemas import GoogleDriveFileRead, GoogleDriveStatusRead
from app.modules.library.models import StoredFile

GOOGLE_DRIVE_PROVIDER = "google_drive"
GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
GOOGLE_DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{file_id}/export"
GOOGLE_DRIVE_DOWNLOAD_URL = "https://www.googleapis.com/drive/v3/files/{file_id}"
GOOGLE_DRIVE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.readonly",
]
GOOGLE_DRIVE_EXPORT_MIME_TYPE = "application/pdf"
GOOGLE_SLIDES_MIME_TYPE = "application/vnd.google-apps.presentation"
GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
GOOGLE_DECK_MIME_TYPES = {
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    GOOGLE_SLIDES_MIME_TYPE,
}
STATE_LIFETIME_MINUTES = 15
STATE_ALGORITHM = "HS256"


def _escape_drive_query(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _fernet() -> Fernet:
    key_material = sha256(settings.auth_secret_key.encode("utf-8")).digest()
    return Fernet(urlsafe_b64encode(key_material))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Stored Google integration secrets can no longer be decrypted.") from exc


def build_google_drive_state(*, user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "nonce": secrets.token_urlsafe(12),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=STATE_LIFETIME_MINUTES)).timestamp()),
        "iss": settings.app_name,
        "provider": GOOGLE_DRIVE_PROVIDER,
    }
    return jwt.encode(payload, settings.auth_secret_key, algorithm=STATE_ALGORITHM)


def decode_google_drive_state(state: str) -> dict[str, object]:
    return jwt.decode(
        state,
        settings.auth_secret_key,
        algorithms=[STATE_ALGORITHM],
        issuer=settings.app_name,
    )


def ensure_google_drive_configured() -> None:
    if settings.google_drive_configured:
        return
    raise ValueError(
        "Google Drive is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and PUBLIC_APP_URL."
    )


def google_drive_status(session: Session) -> GoogleDriveStatusRead:
    connection = session.scalar(
        select(OAuthConnection).where(OAuthConnection.provider == GOOGLE_DRIVE_PROVIDER)
    )
    return GoogleDriveStatusRead(
        configured=settings.google_drive_configured,
        connected=connection is not None,
        account_email=connection.account_email if connection else None,
        account_name=connection.account_name if connection else None,
        scope=connection.scope if connection else None,
        connected_at=connection.created_at if connection else None,
    )


def build_google_drive_authorize_url(*, state: str) -> str:
    ensure_google_drive_configured()
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_drive_redirect_uri,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "scope": " ".join(GOOGLE_DRIVE_SCOPES),
        "state": state,
    }
    return f"{GOOGLE_AUTH_BASE_URL}?{urlencode(params)}"


def _json_request(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> dict[str, object]:
    request = Request(url, data=data, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)

    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(detail or f"Google request failed with status {exc.code}.") from exc
    except URLError as exc:
        raise ValueError("Could not reach Google right now.") from exc


def _binary_request(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[bytes, str | None]:
    request = Request(url, method="GET")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read(), response.headers.get_content_type()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(detail or f"Google download failed with status {exc.code}.") from exc
    except URLError as exc:
        raise ValueError("Could not download the selected Drive file right now.") from exc


def exchange_google_drive_code(code: str) -> dict[str, object]:
    ensure_google_drive_configured()
    body = urlencode(
        {
            "code": code,
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "redirect_uri": settings.google_drive_redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    return _json_request(
        GOOGLE_TOKEN_URL,
        method="POST",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def _refresh_google_drive_tokens(connection: OAuthConnection, session: Session) -> OAuthConnection:
    refresh_token = decrypt_secret(connection.refresh_token_encrypted)
    if not refresh_token:
        raise ValueError("The stored Google Drive connection cannot be refreshed. Reconnect the account.")

    body = urlencode(
        {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    token_data = _json_request(
        GOOGLE_TOKEN_URL,
        method="POST",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    access_token = token_data.get("access_token")
    if not isinstance(access_token, str):
        raise ValueError("Google did not return a refreshed access token.")

    connection.access_token_encrypted = encrypt_secret(access_token)
    expires_in = int(token_data.get("expires_in", 3600))
    connection.expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


def get_google_drive_connection_or_none(session: Session) -> OAuthConnection | None:
    return session.scalar(select(OAuthConnection).where(OAuthConnection.provider == GOOGLE_DRIVE_PROVIDER))


def get_valid_google_drive_access_token(session: Session) -> str:
    connection = get_google_drive_connection_or_none(session)
    if connection is None:
        raise ValueError("Google Drive is not connected yet.")

    if connection.expires_at and connection.expires_at <= datetime.now(UTC) + timedelta(minutes=2):
        connection = _refresh_google_drive_tokens(connection, session)

    access_token = decrypt_secret(connection.access_token_encrypted)
    if not access_token:
        raise ValueError("The Google Drive connection is missing an access token. Reconnect the account.")
    return access_token


def fetch_google_profile(access_token: str) -> dict[str, object]:
    return _json_request(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )


def upsert_google_drive_connection(
    *,
    session: Session,
    connected_by_user: User,
    token_data: dict[str, object],
    profile: dict[str, object],
) -> OAuthConnection:
    access_token = token_data.get("access_token")
    if not isinstance(access_token, str):
        raise ValueError("Google did not return an access token.")

    refresh_token_raw = token_data.get("refresh_token")
    refresh_token = refresh_token_raw if isinstance(refresh_token_raw, str) else None
    expires_in = int(token_data.get("expires_in", 3600))
    connection = get_google_drive_connection_or_none(session) or OAuthConnection(provider=GOOGLE_DRIVE_PROVIDER)
    connection.provider_user_id = str(profile.get("sub")) if profile.get("sub") else None
    connection.account_email = str(profile.get("email")) if profile.get("email") else None
    connection.account_name = str(profile.get("name")) if profile.get("name") else None
    connection.scope = str(token_data.get("scope")) if token_data.get("scope") else " ".join(GOOGLE_DRIVE_SCOPES)
    connection.access_token_encrypted = encrypt_secret(access_token)
    if refresh_token:
        connection.refresh_token_encrypted = encrypt_secret(refresh_token)
    connection.expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    connection.connected_by_user_id = connected_by_user.id
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


def revoke_google_drive_connection(session: Session) -> None:
    connection = get_google_drive_connection_or_none(session)
    if connection is None:
        return

    refresh_token = decrypt_secret(connection.refresh_token_encrypted)
    access_token = decrypt_secret(connection.access_token_encrypted)
    token_to_revoke = refresh_token or access_token
    if token_to_revoke:
        body = urlencode({"token": token_to_revoke}).encode("utf-8")
        try:
            _json_request(
                GOOGLE_REVOKE_URL,
                method="POST",
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except ValueError:
            pass

    session.delete(connection)
    session.commit()


def _find_google_drive_folders(
    *,
    access_token: str,
    name: str,
    parent_ids: list[str] | None = None,
) -> list[str]:
    escaped = _escape_drive_query(name)
    query_parts = [
        "trashed=false",
        f"mimeType='{GOOGLE_FOLDER_MIME_TYPE}'",
        f"name='{escaped}'",
    ]
    if parent_ids:
        query_parts.append("(" + " or ".join(f"'{parent_id}' in parents" for parent_id in parent_ids) + ")")

    params = urlencode(
        {
            "q": " and ".join(query_parts),
            "pageSize": "50",
            "fields": "files(id,name)",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
    )
    payload = _json_request(
        f"{GOOGLE_DRIVE_FILES_URL}?{params}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    files = payload.get("files")
    if not isinstance(files, list):
        return []
    return [str(item["id"]) for item in files if isinstance(item, dict) and item.get("id")]


def _folder_ids_for_path(access_token: str, folder_path: str) -> list[str]:
    parts = [part.strip() for part in folder_path.replace("\\", "/").split("/") if part.strip()]
    parent_ids: list[str] | None = None
    for index, part in enumerate(parts):
        found = _find_google_drive_folders(access_token=access_token, name=part, parent_ids=parent_ids)
        if not found and index == 0 and len(parts) > 1:
            # The first visible name may be a shared-drive label rather than a folder.
            continue
        if not found:
            return []
        parent_ids = found
    return parent_ids or []


def list_google_drive_decks(
    session: Session,
    *,
    query: str,
    limit: int = 20,
    folder_path: str | None = None,
) -> list[GoogleDriveFileRead]:
    access_token = get_valid_google_drive_access_token(session)
    escaped = _escape_drive_query(query)
    mime_filters = " or ".join([f"mimeType='{mime_type}'" for mime_type in sorted(GOOGLE_DECK_MIME_TYPES)])
    query_parts = [f"trashed=false", f"({mime_filters})"]
    if escaped:
        query_parts.append(f"name contains '{escaped}'")
    if folder_path:
        folder_ids = _folder_ids_for_path(access_token, folder_path)
        if not folder_ids:
            return []
        query_parts.append("(" + " or ".join(f"'{folder_id}' in parents" for folder_id in folder_ids) + ")")

    params = urlencode(
        {
            "q": " and ".join(query_parts),
            "orderBy": "modifiedTime desc,name_natural",
            "pageSize": str(limit),
            "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
    )
    payload = _json_request(
        f"{GOOGLE_DRIVE_FILES_URL}?{params}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    files = payload.get("files")
    if not isinstance(files, list):
        return []

    results: list[GoogleDriveFileRead] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        file_id = item.get("id")
        name = item.get("name")
        mime_type = item.get("mimeType")
        if not isinstance(file_id, str) or not isinstance(name, str) or not isinstance(mime_type, str):
            continue
        modified_time = item.get("modifiedTime")
        results.append(
            GoogleDriveFileRead(
                id=file_id,
                name=name,
                mime_type=mime_type,
                modified_time=datetime.fromisoformat(modified_time.replace("Z", "+00:00"))
                if isinstance(modified_time, str)
                else None,
                web_view_link=item.get("webViewLink") if isinstance(item.get("webViewLink"), str) else None,
                source_kind="google_slides" if mime_type == GOOGLE_SLIDES_MIME_TYPE else "drive_file",
            )
        )
    return results


def import_google_drive_file(
    *,
    session: Session,
    file_id: str,
    display_name: str | None,
    uploaded_by_user_id: str,
    upload_root: Path,
) -> tuple[StoredFile, GoogleDriveFileRead]:
    matches = [item for item in list_google_drive_decks(session, query="", limit=100) if item.id == file_id]
    selected = matches[0] if matches else None
    if selected is None:
        access_token = get_valid_google_drive_access_token(session)
        params = urlencode(
            {
                "fields": "id,name,mimeType,modifiedTime,webViewLink",
                "supportsAllDrives": "true",
            }
        )
        payload = _json_request(
            f"{GOOGLE_DRIVE_FILES_URL}/{file_id}?{params}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        selected = GoogleDriveFileRead(
            id=str(payload.get("id")),
            name=str(payload.get("name")),
            mime_type=str(payload.get("mimeType")),
            modified_time=datetime.fromisoformat(str(payload.get("modifiedTime")).replace("Z", "+00:00"))
            if payload.get("modifiedTime")
            else None,
            web_view_link=str(payload.get("webViewLink")) if payload.get("webViewLink") else None,
            source_kind="google_slides"
            if payload.get("mimeType") == GOOGLE_SLIDES_MIME_TYPE
            else "drive_file",
        )

    access_token = get_valid_google_drive_access_token(session)
    if selected.mime_type == GOOGLE_SLIDES_MIME_TYPE:
        content, content_type = _binary_request(
            f"{GOOGLE_DRIVE_EXPORT_URL.format(file_id=file_id)}?{urlencode({'mimeType': GOOGLE_DRIVE_EXPORT_MIME_TYPE})}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        target_name = f"{display_name or selected.name}.pdf"
    else:
        content, content_type = _binary_request(
            f"{GOOGLE_DRIVE_DOWNLOAD_URL.format(file_id=file_id)}?{urlencode({'alt': 'media', 'supportsAllDrives': 'true'})}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        suffix = Path(selected.name).suffix
        target_name = f"{display_name or Path(selected.name).stem}{suffix or ''}"

    upload_root.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid4()}-{Path(target_name).name}"
    storage_path = upload_root / storage_name
    storage_path.write_bytes(content)
    checksum = sha256(content).hexdigest()

    stored = StoredFile(
        display_name=display_name or Path(target_name).stem,
        storage_path=str(storage_path),
        content_type=content_type or selected.mime_type,
        checksum=checksum,
        uploaded_by_id=uploaded_by_user_id,
    )
    session.add(stored)
    session.commit()
    session.refresh(stored)
    return stored, selected
