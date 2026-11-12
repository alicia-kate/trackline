from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models import User
from app.schemas import AccessIn, DecideIn
from app.services import workflow

router = APIRouter(prefix="/api/requests", tags=["requests"])


@router.get("")
def list_requests(user: User = Depends(require_role("admin", "manager", "oic", "viewer")), db: Session = Depends(get_db)):
    return workflow.list_requests(db, user)


@router.post("/{request_id}/decide", status_code=204)
def decide(request_id: int, body: DecideIn, request: Request, approver: User = Depends(require_role("admin", "manager")), db: Session = Depends(get_db)):
    workflow.decide(db, approver, request_id, body.approve, body.note, client_ip(request))


@router.post("/access", status_code=204)
def request_access(body: AccessIn, request: Request, user: User = Depends(require_role("oic")), db: Session = Depends(get_db)):
    workflow.request_access(db, user, body.project, body.note)
