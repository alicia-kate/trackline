from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User


def by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def list_all(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.username)))


def add(db: Session, user: User) -> User:
    db.add(user)
    db.flush()
    db.refresh(user)
    return user


def active_admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active)) or 0
