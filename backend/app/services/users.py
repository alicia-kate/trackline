import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import security
from app.core.errors import ServiceError
from app.models import MasterRow, User, UserProject
from app.repositories import audit, sessions, users

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,30}$")


def _actor(a: User | None) -> tuple[int | None, str | None]:
    return (a.id, a.username) if a else (None, "system")


def _projects(db: Session, names: list[str]) -> list[str]:
    """Master data spelling of each project. Every one must exist and be active."""
    known = {r.name.strip().lower(): r.name for r in db.scalars(select(MasterRow).where(MasterRow.kind == "projects", MasterRow.active.is_(True)))}
    out: list[str] = []
    for n in names:
        hit = known.get(n.strip().lower())
        if hit is None:
            raise ServiceError(422, "BAD_PROJECT", f"'{n}' is not an active project in Master data.")
        if hit not in out:
            out.append(hit)
    return out


def _apply_projects(user: User, names: list[str]) -> None:
    have = {p.project for p in user.project_rows}
    for p in list(user.project_rows):
        if p.project not in names:
            user.project_rows.remove(p)
    for n in names:
        if n not in have:
            user.project_rows.append(UserProject(project=n))


def create(db: Session, actor: User | None, username: str, role: str, password: str, must_change: bool = True, ip: str | None = None, full_name: str | None = None,
           projects: list[str] | None = None) -> User:
    name = username.strip().lower()
    if not USERNAME_RE.match(name):
        raise ServiceError(422, "BAD_USERNAME", "Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore.")
    problem = security.validate_password(password, name)
    if problem:
        raise ServiceError(422, "WEAK_PASSWORD", problem)
    if users.by_username(db, name):
        raise ServiceError(409, "USERNAME_TAKEN", "That username already exists.")
    names = _projects(db, projects or []) if role == "oic" else []
    if role == "oic" and not names:
        raise ServiceError(422, "PROJECT_REQUIRED", "Choose at least one project for an OIC/User.")
    aid, aname = _actor(actor)
    user = User(username=name, full_name=(full_name or "").strip() or None, password_hash=security.hash_password(password), role=role, is_active=True,
                must_change_password=must_change, failed_login_count=0, created_by=aid)
    user.project_rows = [UserProject(project=n) for n in names]
    try:
        users.add(db, user)
    except IntegrityError:
        db.rollback()
        raise ServiceError(409, "USERNAME_TAKEN", "That username already exists.")
    audit.add(db, actor_id=aid, actor=aname, action="user_created", target=name, detail=(f"role={role}" + (f", projects: {', '.join(names)}" if names else ""))[:500], ip=ip)
    db.commit()
    return user


def update(db: Session, actor: User, user_id: int, role: str | None, is_active: bool | None, ip: str | None, full_name: str | None = None,
           projects: list[str] | None = None) -> User:
    target = users.by_id(db, user_id)
    if target is None:
        raise ServiceError(404, "NOT_FOUND", "User not found.")
    new_role = role or target.role
    new_active = target.is_active if is_active is None else is_active
    if target.id == actor.id and (new_role != target.role or not new_active):
        raise ServiceError(400, "SELF_CHANGE", "You cannot change your own role or deactivate yourself.")
    if target.role == "admin" and target.is_active and (new_role != "admin" or not new_active) and users.active_admin_count(db) <= 1:
        raise ServiceError(400, "LAST_ADMIN", "There must be at least one active admin.")
    names = _projects(db, projects) if projects is not None and new_role == "oic" else None
    if new_role == "oic" and not (names if names is not None else target.projects):
        raise ServiceError(422, "PROJECT_REQUIRED", "Choose at least one project for an OIC/User.")
    changes = []
    if names is not None and set(names) != set(target.projects):
        _apply_projects(target, names)
        changes.append("projects: " + ", ".join(names))
    if new_role != target.role:
        changes.append(f"role {target.role}->{new_role}")
        target.role = new_role
    if new_active != target.is_active:
        changes.append("activated" if new_active else "deactivated")
        target.is_active = new_active
        if not new_active:
            sessions.delete_for_user(db, target.id)
    if full_name is not None and (full_name.strip() or None) != target.full_name:
        target.full_name = full_name.strip() or None
        changes.append("full name changed")
    if changes:
        audit.add(db, actor_id=actor.id, actor=actor.username, action="user_updated", target=target.username, detail=", ".join(changes)[:500], ip=ip)
    db.commit()
    return target


def reset_password(db: Session, actor: User, user_id: int, new_password: str, ip: str | None) -> None:
    target = users.by_id(db, user_id)
    if target is None:
        raise ServiceError(404, "NOT_FOUND", "User not found.")
    problem = security.validate_password(new_password, target.username)
    if problem:
        raise ServiceError(422, "WEAK_PASSWORD", problem)
    target.password_hash = security.hash_password(new_password)
    target.must_change_password = True
    target.failed_login_count = 0
    target.locked_until = None
    target.password_changed_at = datetime.now(timezone.utc)
    sessions.delete_for_user(db, target.id)
    audit.add(db, actor_id=actor.id, actor=actor.username, action="password_reset", target=target.username, ip=ip)
    db.commit()


def list_for(db: Session, actor: User) -> list[User]:
    """Admins see every account; an inventory manager only sees OIC/Users (to give them project access)."""
    rows = users.list_all(db)
    return rows if actor.role == "admin" else [u for u in rows if u.role == "oic"]


def set_projects(db: Session, actor: User, user_id: int, projects: list[str], ip: str | None) -> User:
    target = users.by_id(db, user_id)
    if target is None:
        raise ServiceError(404, "NOT_FOUND", "User not found.")
    if target.role != "oic":
        raise ServiceError(400, "NOT_OIC", "Only OIC/User accounts are given projects.")
    names = _projects(db, projects)
    if not names:
        raise ServiceError(422, "PROJECT_REQUIRED", "Choose at least one project for an OIC/User.")
    if set(names) != set(target.projects):
        _apply_projects(target, names)
        audit.add(db, actor_id=actor.id, actor=actor.username, action="user_updated", target=target.username, detail=("projects: " + ", ".join(names))[:500], ip=ip)
    db.commit()
    return target


def grant_project(db: Session, actor: User, username: str, project: str, ip: str | None) -> None:
    """Adds one project to an OIC/User when their access request is approved. The caller commits."""
    target = users.by_username(db, username)
    if target is None or not target.is_active or target.role != "oic":
        raise ServiceError(409, "NOT_FOUND", "That account is no longer an active OIC/User.")
    if project.lower() not in {p.lower() for p in target.projects}:
        target.project_rows.append(UserProject(project=project))
        audit.add(db, actor_id=actor.id, actor=actor.username, action="user_updated", target=target.username, detail=f"project access added: {project}"[:500], ip=ip)
