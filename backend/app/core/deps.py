from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ServiceError
from app.db.session import SessionLocal
from app.models import User
from app.services import auth


def get_db():
    with SessionLocal() as db:
        yield db


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def csrf_guard(request: Request) -> None:
    if request.method not in ("GET", "HEAD", "OPTIONS") and not request.headers.get("x-requested-with"):
        raise ServiceError(403, "CSRF", "Missing request header.")


def user_any(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.cookie_name)
    user = auth.user_from_token(db, token)
    if user is None:
        raise ServiceError(401, "NOT_AUTHENTICATED", "Please sign in.")
    request.state.token = token
    return user


def user_ready(user: User = Depends(user_any)) -> User:
    if user.must_change_password:
        raise ServiceError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password first.")
    return user


def require_role(*roles: str):
    def dep(user: User = Depends(user_ready)) -> User:
        if user.role not in roles:
            raise ServiceError(403, "FORBIDDEN", "You do not have access to this.")
        return user

    return dep
