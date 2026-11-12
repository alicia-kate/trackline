from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["admin", "manager", "oic", "viewer"]


class LoginIn(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str | None = None
    role: Role
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime
    needs_approval: bool = False  # filled in for the signed-in person: their changes wait for approval
    projects: list[str] = []  # projects an OIC/User may work in


class UserCreate(BaseModel):
    username: str = Field(max_length=30)
    role: Role
    password: str = Field(max_length=128)
    full_name: str | None = Field(None, max_length=100)
    projects: list[str] = Field(default_factory=list, max_length=100)


class ImportRowIn(BaseModel):
    key: str = Field(max_length=40)
    c: Literal["Asset", "License", "Spare"]
    n: int = Field(0, ge=0, le=1_000_000)
    f: dict[str, str] = Field(max_length=40)


class ImportRowsIn(BaseModel):
    rows: list[ImportRowIn] = Field(min_length=1, max_length=1000)
    new: dict[str, list[str]] = Field(default_factory=dict, max_length=4)  # Master data the person agreed to add, by kind


class ImportCommitIn(ImportRowsIn):
    only_valid: bool = False  # off by default: every row must be clean


class UserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    full_name: str | None = Field(None, max_length=100)
    projects: list[str] | None = Field(None, max_length=100)


class ProjectsIn(BaseModel):
    projects: list[str] = Field(max_length=100)


class LinkItemsIn(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=100)


class AccessIn(BaseModel):
    project: str = Field(min_length=1, max_length=100)
    note: str = Field("", max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class PasswordReset(BaseModel):
    new_password: str = Field(max_length=128)


# ---------- inventory ----------
Scalar = str | int | float | None


class ItemWrite(BaseModel):
    category: Literal["Asset", "License", "Spare"]
    fields: dict[str, Scalar]
    attachment_ids: list[int] = Field(default_factory=list, max_length=20)


class ItemEdit(BaseModel):
    fields: dict[str, Scalar]


class ActionIn(BaseModel):
    action: str = Field(max_length=12)
    data: dict[str, Scalar] = {}


class WriteResult(BaseModel):
    id: str | None = None
    queued: bool = False


class DecideIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=300)


class MasterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    data: dict[str, str] = {}


class MasterUpdate(BaseModel):
    name: str = Field(max_length=100)
    data: dict[str, str] | None = None
    active: bool | None = None
