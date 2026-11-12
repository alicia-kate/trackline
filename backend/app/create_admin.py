import getpass
import sys

from app.core.errors import ServiceError
from app.db.session import SessionLocal
from app.services import users


def main() -> None:
    username = input("Admin username: ").strip()
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")
    with SessionLocal() as db:
        try:
            user = users.create(db, None, username, "admin", password, must_change=False)
        except ServiceError as e:
            sys.exit(e.message)
    print(f"Admin '{user.username}' created.")


if __name__ == "__main__":
    main()
