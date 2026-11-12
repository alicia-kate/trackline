from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models import User
from app.schemas import PasswordReset, ProjectsIn, UserCreate, UserOut, UserUpdate
from app.services import users

router = APIRouter(prefix="/api/users", tags=["users"])
admin_only = require_role("admin")
staff = require_role("admin", "manager")


@router.get("", response_model=list[UserOut])
def list_users(actor: User = Depends(staff), db: Session = Depends(get_db)):
    return users.list_for(db, actor)


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    return users.create(db, actor, body.username, body.role, body.password, ip=client_ip(request), full_name=body.full_name, projects=body.projects)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, request: Request, actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    return users.update(db, actor, user_id, body.role, body.is_active, client_ip(request), body.full_name, body.projects)


@router.post("/{user_id}/reset-password", status_code=204)
def reset_password(user_id: int, body: PasswordReset, request: Request, actor: User = Depends(admin_only), db: Session = Depends(get_db)):
    users.reset_password(db, actor, user_id, body.new_password, client_ip(request))


@router.put("/{user_id}/projects", response_model=UserOut)
def set_projects(user_id: int, body: ProjectsIn, request: Request, actor: User = Depends(staff), db: Session = Depends(get_db)):
    return users.set_projects(db, actor, user_id, body.projects, client_ip(request))
