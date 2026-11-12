"""Who may see, change and approve what. One place, so the rules read the same everywhere.

Roles
  admin    everything: users, master data, settings, approvals
  manager  Inventory Manager: everything an admin does except creating and managing user accounts; gives OIC/Users project access
  oic      OIC/User: sees, adds and edits items only in the projects they are assigned; every change waits for approval
  viewer   read-only
"""
from app.core.config import settings
from app.core.errors import ServiceError
from app.models import Item, User

ROLES = ("admin", "manager", "oic", "viewer")
APPROVERS = ("admin", "manager")


def writes_directly(user: User) -> bool:
    """True when the person's changes apply at once instead of waiting for approval."""
    return user.role == "admin" or (user.role == "manager" and not settings.managers_need_approval)


def needs_approval(user: User) -> bool:
    return user.role in ("manager", "oic") and not writes_directly(user)


def can_approve(user: User) -> bool:
    return user.role in APPROVERS


def assigned(user: User) -> set[str]:
    """The projects an OIC/User is assigned to (lowercase)."""
    return {p.strip().lower() for p in user.projects}


def in_scope(user: User, project: object) -> bool:
    return user.role != "oic" or str(project or "").strip().lower() in assigned(user)


def require_project(user: User, project: object) -> None:
    if not in_scope(user, project):
        raise ServiceError(403, "OUT_OF_SCOPE", "You can only work in the projects you are assigned to. Request access to another project from the Inventory page.")


def can_see(user: User, item: Item) -> bool:
    return in_scope(user, item.project)


def require_visible(user: User, item: Item) -> None:
    if not can_see(user, item):
        raise ServiceError(404, "NOT_FOUND", "Item not found.")
