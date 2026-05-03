from pydantic import BaseModel


class InstrumentRead(BaseModel):
    id: str
    name: str
    sort_order: int


class TeamAssignmentBase(BaseModel):
    plan_id: str
    user_id: str | None = None
    role_label: str
    instrument_id: str | None = None
    status: str = "invited"
    notes: str | None = None


class TeamAssignmentCreate(TeamAssignmentBase):
    pass


class TeamAssignmentUpdate(BaseModel):
    user_id: str | None = None
    role_label: str | None = None
    instrument_id: str | None = None
    status: str | None = None
    notes: str | None = None


class TeamAssignmentRead(TeamAssignmentBase):
    id: str
    user_name: str | None = None
    instrument_name: str | None = None
    confirmed: bool
    requested: bool
    available: bool
