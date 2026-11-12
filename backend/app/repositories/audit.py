from sqlalchemy.orm import Session

from app.models import AuditLog


def add(db: Session, *, actor_id: int | None, actor: str | None, action: str, target: str | None = None,
        detail: str | None = None, ip: str | None = None) -> None:
    db.add(AuditLog(actor_user_id=actor_id, actor_username=actor, action=action, target=target, detail=detail, ip=ip))
