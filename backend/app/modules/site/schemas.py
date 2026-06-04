from datetime import datetime

from pydantic import BaseModel


class SiteContentBlockRead(BaseModel):
    id: str
    key: str
    label: str
    block_type: str
    value: str
    draft_value: str | None
    published: bool
    updated_at: datetime


class SiteContentBlockUpdate(BaseModel):
    label: str | None = None
    block_type: str | None = None
    value: str
    published: bool = True
