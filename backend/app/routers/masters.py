from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models import User
from app.schemas import MasterCreate, MasterUpdate
from app.services import masters

router = APIRouter(prefix="/api/masters", tags=["masters"])
anyone = require_role("admin", "manager", "oic", "viewer")
editor = require_role("admin", "manager")


@router.get("")
def list_masters(_: User = Depends(anyone), db: Session = Depends(get_db)):
    return masters.list_all(db)


@router.post("/{kind}", status_code=201)
def create_master(kind: str, body: MasterCreate, request: Request, actor: User = Depends(editor), db: Session = Depends(get_db)):
    masters.create(db, actor, kind, body.name, body.data, client_ip(request))


@router.patch("/{kind}")
def update_master(kind: str, body: MasterUpdate, request: Request, actor: User = Depends(editor), db: Session = Depends(get_db)):
    masters.update(db, actor, kind, body.name, body.data, body.active, client_ip(request))
