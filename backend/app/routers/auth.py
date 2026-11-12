from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import client_ip, get_db, user_any
from app.models import User
from app.schemas import LoginIn, PasswordChange, UserOut
from app.services import access, auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _out(user: User) -> UserOut:
    """The signed-in person, plus whether their changes wait for approval (the screens use it to label buttons)."""
    return UserOut.model_validate(user).model_copy(update={"needs_approval": access.needs_approval(user)})


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user, token = auth.login(db, body.username, body.password, client_ip(request), request.headers.get("user-agent"))
    response.set_cookie(settings.cookie_name, token, max_age=settings.session_hours * 3600, httponly=True,
                        secure=settings.cookie_secure, samesite="lax", path="/")
    return _out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: User = Depends(user_any), db: Session = Depends(get_db)):
    auth.logout(db, user, request.state.token, client_ip(request))
    response.delete_cookie(settings.cookie_name, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(user_any)):
    return _out(user)


@router.post("/change-password", response_model=UserOut)
def change_password(body: PasswordChange, request: Request, user: User = Depends(user_any), db: Session = Depends(get_db)):
    return _out(auth.change_password(db, user, request.state.token, body.current_password, body.new_password, client_ip(request)))
