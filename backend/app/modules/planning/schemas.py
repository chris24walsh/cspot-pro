from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PlanTypeRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    starts_at: str | None = None
    default_duration_minutes: int | None = None
    active: bool


class PlanItemBase(BaseModel):
    item_type: str = "custom"
    sequence: Decimal = Field(decimal_places=2)
    title: str
    comment: str | None = None
    key_signature: str | None = None
    song_id: str | None = None


class PlanItemCreate(PlanItemBase):
    pass


class PlanItemUpdate(BaseModel):
    item_type: str | None = None
    sequence: Decimal | None = Field(default=None, decimal_places=2)
    title: str | None = None
    comment: str | None = None
    key_signature: str | None = None
    song_id: str | None = None


class PlanItemRead(PlanItemBase):
    id: str
    plan_id: str
    files: list["PlanItemFileRead"] = Field(default_factory=list)


class PlanItemFileRead(BaseModel):
    id: str
    file_id: str
    sort_order: int
    display_name: str
    content_type: str | None = None


class PlanBase(BaseModel):
    plan_type_id: str
    service_date: datetime
    title: str
    subtitle: str | None = None
    leader_id: str | None = None
    teacher_id: str | None = None
    status: str = "draft"
    info: str | None = None


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    plan_type_id: str | None = None
    service_date: datetime | None = None
    title: str | None = None
    subtitle: str | None = None
    leader_id: str | None = None
    teacher_id: str | None = None
    status: str | None = None
    info: str | None = None


class PlanSummary(BaseModel):
    id: str
    title: str
    service_date: datetime
    status: str
    plan_type: str
    subtitle: str | None = None
    item_count: int


class PlanDetail(PlanBase):
    id: str
    items: list[PlanItemRead]
