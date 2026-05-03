from pydantic import BaseModel


class RoleRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    system_role: bool


class UserBase(BaseModel):
    email: str
    name: str
    start_page: str | None = None
    email_confirmed: bool = False
    active: bool = True


class UserCreate(UserBase):
    role_names: list[str] = ["user"]
    password: str | None = None


class UserUpdate(BaseModel):
    email: str | None = None
    name: str | None = None
    start_page: str | None = None
    email_confirmed: bool | None = None
    active: bool | None = None
    role_names: list[str] | None = None
    password: str | None = None


class UserRead(UserBase):
    id: str
    roles: list[str]


class MemberRead(BaseModel):
    id: str
    email: str
    name: str
    active: bool


class SessionUserRead(UserRead):
    permissions: list[str]


class LoginRequest(BaseModel):
    email: str
    password: str


class BootstrapStatusRead(BaseModel):
    available: bool


class BootstrapAdminRequest(BaseModel):
    email: str
    name: str
    password: str
