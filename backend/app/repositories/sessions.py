from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import UserSession


def add(db: Session, s: UserSession) -> None:
    db.add(s)
    db.flush()


def by_hash(db: Session, token_hash: str) -> UserSession | None:
    return db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))


def delete_hash(db: Session, token_hash: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == token_hash))


def delete_for_user(db: Session, user_id: int, keep_hash: str | None = None) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_hash:
        stmt = stmt.where(UserSession.token_hash != keep_hash)
    db.execute(stmt)
