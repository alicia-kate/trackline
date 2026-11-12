from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.errors import ServiceError
from app.models import User, UserSession
from app.repositories import audit, sessions, users


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _bad() -> ServiceError:
    return ServiceError(401, "INVALID_CREDENTIALS", "Invalid username or password.")


def login(db: Session, username: str, password: str, ip: str | None, agent: str | None) -> tuple[User, str]:
    now = _now()
    name = username.strip().lower()
    user = users.by_username(db, name)
    if user is None or not user.is_active or (user.locked_until and user.locked_until > now):
        security.burn_time(password)
        audit.add(db, actor_id=None, actor=name[:50], action="login_failed", detail="unknown, inactive or locked", ip=ip)
        db.commit()
        raise _bad()
    if not security.verify_password(user.password_hash, password):
        user.failed_login_count += 1
        detail = None
        if user.failed_login_count >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_count = 0
            detail = "account locked"
        audit.add(db, actor_id=user.id, actor=user.username, action="login_failed", detail=detail, ip=ip)
        db.commit()
        raise _bad()
    if security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    token = security.new_token()
    sessions.add(db, UserSession(token_hash=security.token_hash(token), user_id=user.id,
                                 expires_at=now + timedelta(hours=settings.session_hours), ip=ip, user_agent=(agent or "")[:300]))
    audit.add(db, actor_id=user.id, actor=user.username, action="login", ip=ip)
    db.commit()
    return user, token


def user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    s = sessions.by_hash(db, security.token_hash(token))
    if s is None:
        return None
    if s.expires_at <= _now():
        sessions.delete_hash(db, s.token_hash)
        db.commit()
        return None
    user = users.by_id(db, s.user_id)
    return user if user and user.is_active else None


def logout(db: Session, user: User, token: str, ip: str | None) -> None:
    sessions.delete_hash(db, security.token_hash(token))
    audit.add(db, actor_id=user.id, actor=user.username, action="logout", ip=ip)
    db.commit()


def change_password(db: Session, user: User, token: str, current: str, new: str, ip: str | None) -> User:
    if not security.verify_password(user.password_hash, current):
        audit.add(db, actor_id=user.id, actor=user.username, action="password_change_failed", ip=ip)
        db.commit()
        raise ServiceError(400, "WRONG_PASSWORD", "Current password is incorrect.")
    problem = security.validate_password(new, user.username)
    if problem:
        raise ServiceError(422, "WEAK_PASSWORD", problem)
    if security.verify_password(user.password_hash, new):
        raise ServiceError(422, "WEAK_PASSWORD", "New password must be different from the current one.")
    user.password_hash = security.hash_password(new)
    user.must_change_password = False
    user.password_changed_at = _now()
    sessions.delete_for_user(db, user.id, keep_hash=security.token_hash(token))
    audit.add(db, actor_id=user.id, actor=user.username, action="password_changed", ip=ip)
    db.commit()
    return user
