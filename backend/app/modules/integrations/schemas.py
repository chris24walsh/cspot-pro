from datetime import datetime

from pydantic import BaseModel

from app.modules.library.schemas import StoredFileRead


class GoogleDriveStatusRead(BaseModel):
    configured: bool
    connected: bool
    account_email: str | None = None
    account_name: str | None = None
    scope: str | None = None
    connected_at: datetime | None = None


class GoogleDriveFileRead(BaseModel):
    id: str
    name: str
    mime_type: str
    modified_time: datetime | None = None
    web_view_link: str | None = None
    source_kind: str


class GoogleDriveImportRequest(BaseModel):
    file_id: str
    display_name: str | None = None


class GoogleDriveParseRequest(BaseModel):
    file_id: str


class GoogleDriveImportRead(BaseModel):
    file: StoredFileRead
    source: GoogleDriveFileRead
