import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_ph = PasswordHasher()
_DUMMY_HASH = _ph.hash("timing-equaliser-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _ph.verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _ph.check_needs_rehash(stored_hash)


def burn_time(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def validate_password(password: str, username: str) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if len(password) > 128:
        return "Password must be at most 128 characters."
    if username and username.lower() in password.lower():
        return "Password must not contain the username."
    if len(set(password)) < 4:
        return "Password is too repetitive."
    return None
