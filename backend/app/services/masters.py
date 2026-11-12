from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ServiceError
from app.models import MasterRow, User
from app.repositories import audit

FIELDS = {
    "projects": ("code", "lead", "site", "description"),
    "vendors": ("contact", "email", "phone"),
    "locations": ("code", "site"),
    "departments": ("code", "head"),
}


def _kind(kind: str) -> str:
    if kind not in FIELDS:
        raise ServiceError(404, "NOT_FOUND", "Unknown master data type.")
    return kind


def _clean(kind: str, data: dict[str, str]) -> dict[str, str]:
    return {k: str(data[k]).strip()[: 1000 if k == "description" else 300] for k in FIELDS[kind] if k in data}


def _out(r: MasterRow) -> dict:
    return {"name": r.name, "active": r.active, **r.data}


def list_all(db: Session) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {k: [] for k in FIELDS}
    for r in db.scalars(select(MasterRow).order_by(MasterRow.id)):
        out[r.kind].append(_out(r))
    return out


def _find(db: Session, kind: str, name: str) -> MasterRow | None:
    return db.scalar(select(MasterRow).where(MasterRow.kind == kind, MasterRow.name == name))


def create(db: Session, actor: User | None, kind: str, name: str, data: dict[str, str], ip: str | None = None, commit: bool = True, actor_name: str | None = None) -> None:
    _kind(kind)
    name = name.strip()
    if not name:
        raise ServiceError(422, "MISSING", "Name is required.")
    if db.scalar(select(MasterRow.id).where(MasterRow.kind == kind, func.lower(MasterRow.name) == name.lower()).limit(1)):
        raise ServiceError(409, "DUPLICATE", "That name already exists.")
    db.add(MasterRow(kind=kind, name=name, active=True, data=_clean(kind, data)))
    audit.add(db, actor_id=actor.id if actor else None, actor=actor.username if actor else (actor_name or "system"), action="master_created", target=f"{kind}:{name}", ip=ip)
    if commit:  # an import adds Master data and items in one transaction and commits once
        db.commit()


def update(db: Session, actor: User, kind: str, name: str, data: dict[str, str] | None, active: bool | None, ip: str | None) -> None:
    _kind(kind)
    r = _find(db, kind, name)
    if r is None:
        raise ServiceError(404, "NOT_FOUND", "Record not found.")
    changes = []
    if data is not None:
        r.data = {**r.data, **_clean(kind, data)}
        changes.append("details")
    if active is not None and active != r.active:
        r.active = active
        changes.append("reactivated" if active else "deactivated")
    if changes:
        audit.add(db, actor_id=actor.id, actor=actor.username, action="master_updated", target=f"{kind}:{name}", detail=", ".join(changes), ip=ip)
    db.commit()
