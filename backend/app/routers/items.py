from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models import User
from app.schemas import ActionIn, ItemEdit, ItemWrite, WriteResult
from app.services import items, workflow

router = APIRouter(prefix="/api/items", tags=["items"])
anyone = require_role("admin", "manager", "oic", "viewer")
writer = require_role("admin", "manager", "oic")  # an OIC/User's changes wait for approval and stay inside their projects
actor = writer


@router.get("")
def list_items(user: User = Depends(anyone), db: Session = Depends(get_db)):
    return items.list_all(db, user)


@router.get("/{item_id}")
def get_item(item_id: str, user: User = Depends(anyone), db: Session = Depends(get_db)):
    return items.get_out(db, item_id, user)


@router.get("/{item_id}/movements")
def stock_movements(item_id: str, user: User = Depends(anyone), db: Session = Depends(get_db)):
    return items.movements(db, user, item_id)


@router.post("", response_model=WriteResult, status_code=201)
def create_item(body: ItemWrite, request: Request, user: User = Depends(writer), db: Session = Depends(get_db)):
    return workflow.create_item(db, user, body.category, body.fields, client_ip(request), body.attachment_ids)


@router.patch("/{item_id}", response_model=WriteResult)
def update_item(item_id: str, body: ItemEdit, request: Request, user: User = Depends(writer), db: Session = Depends(get_db)):
    return workflow.update_item(db, user, item_id, body.fields, client_ip(request))


@router.post("/{item_id}/actions", response_model=WriteResult)
def run_action(item_id: str, body: ActionIn, request: Request, user: User = Depends(actor), db: Session = Depends(get_db)):
    return workflow.act(db, user, item_id, body.action, body.data, client_ip(request))
