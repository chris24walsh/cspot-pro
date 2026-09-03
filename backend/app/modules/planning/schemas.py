from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class PlanTypeRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    starts_at: str | None = None
    default_duration_minutes: int | None = None
    active: bool
    default_outline: list["DefaultOutlineItem"] = Field(default_factory=list)


class DefaultOutlineItem(BaseModel):
    item_type: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    sequence: Decimal = Field(decimal_places=2)
    comment: str | None = None


class PlanTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    starts_at: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    default_duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    active: bool = True
    default_outline: list[DefaultOutlineItem] = Field(default_factory=list, max_length=40)


class PlanTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    starts_at: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    default_duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    active: bool | None = None
    default_outline: list[DefaultOutlineItem] | None = Field(default=None, max_length=40)


class PlanItemBase(BaseModel):
    parent_item_id: str | None = None
    item_type: str = "custom"
    sequence: Decimal = Field(decimal_places=2)
    title: str
    planned_start: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    comment: str | None = None
    key_signature: str | None = None
    song_id: str | None = None
    montage_random: bool = False
    auto_collapse_items: bool = False
    presentation_options: dict[str, Any] = Field(default_factory=dict)


class PlanItemCreate(PlanItemBase):
    pass


class PlanItemUpdate(BaseModel):
    parent_item_id: str | None = None
    item_type: str | None = None
    sequence: Decimal | None = Field(default=None, decimal_places=2)
    title: str | None = None
    planned_start: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    comment: str | None = None
    key_signature: str | None = None
    song_id: str | None = None
    teacher_notes: str | None = None
    montage_random: bool | None = None
    auto_collapse_items: bool | None = None
    presentation_options: dict[str, Any] | None = None


class PlanItemRead(PlanItemBase):
    id: str
    plan_id: str
    files: list["PlanItemFileRead"] = Field(default_factory=list)
    teacher_notes: str | None = None


class PlanItemHistorySnapshot(BaseModel):
    id: str
    parent_item_id: str | None = None
    item_type: str
    sequence: str
    title: str
    planned_start: str | None = None
    comment: str | None = None
    key_signature: str | None = None
    song_id: str | None = None


class PlanHistoryCreate(BaseModel):
    label: str
    before: list[PlanItemHistorySnapshot]
    after: list[PlanItemHistorySnapshot]
    affected: str | None = None
    change_type: str = "plan_items"
    restorable: bool = True


class PlanHistoryRead(PlanHistoryCreate):
    id: str
    entity_id: str
    entity_type: str
    actor_id: str | None = None
    actor_name: str | None = None
    created_at: datetime
    data_before: dict[str, Any] = Field(default_factory=dict)
    data_after: dict[str, Any] = Field(default_factory=dict)


class PlanItemFileRead(BaseModel):
    id: str
    file_id: str
    sort_order: int
    persistent: bool = False
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
    leader_id: str | None = None
    item_count: int


class PlanDetail(PlanBase):
    id: str
    plan_type: str
    items: list[PlanItemRead]


class WorshipLeaderAssignmentRead(BaseModel):
    service_date: date
    leader_id: str


class WorshipLeaderAssignmentUpdate(BaseModel):
    leader_id: str | None
