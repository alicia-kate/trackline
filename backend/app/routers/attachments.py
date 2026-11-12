
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import client_ip, get_db, require_role
from app.core.errors import ServiceError
from app.models import User
from app.schemas import LinkItemsIn
from app.services import attachments

router = APIRouter(prefix="/api", tags=["attachments"])
anyone = require_role("admin", "manager", "oic", "viewer")
INLINE = {"application/pdf", "image/png", "image/jpeg"}  # shown in the browser; everything else downloads


staff = require_role("admin", "manager")


@router.get("/attachments")
def list_documents(project: str | None = None, vendor: str | None = None, q: str | None = None, user: User = Depends(anyone), db: Session = Depends(get_db)):
    return attachments.list_docs(db, user, project, vendor, q)


@router.post("/attachments/{att_id}/links")
def share_attachment(att_id: int, body: LinkItemsIn, request: Request, user: User = Depends(staff), db: Session = Depends(get_db)):
    return attachments.share(db, user, att_id, body.item_ids, client_ip(request))


@router.delete("/attachments/{att_id}/links/{item_id}", status_code=204)
def unlink_attachment(att_id: int, item_id: str, request: Request, user: User = Depends(staff), db: Session = Depends(get_db)):
    attachments.unlink(db, user, att_id, item_id, client_ip(request))


@router.post("/uploads", status_code=201)
def stage_upload(request: Request, doc_type: str = Form(...), file: UploadFile = File(...),
                 user: User = Depends(require_role("admin", "manager", "oic")), db: Session = Depends(get_db)):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > (settings.max_upload_mb + 1) * 1024 * 1024:
        raise ServiceError(413, "TOO_BIG", f"Files can be up to {settings.max_upload_mb} MB.")
    return attachments.stage(db, user, doc_type, file.filename or "document", file.file)


@router.delete("/uploads/{att_id}", status_code=204)
def unstage_upload(att_id: int, user: User = Depends(require_role("admin", "manager", "oic")), db: Session = Depends(get_db)):
    attachments.unstage(db, user, att_id)


@router.get("/items/{item_id}/attachments")
def list_attachments(item_id: str, user: User = Depends(anyone), db: Session = Depends(get_db)):
    return attachments.list_for_item(db, user, item_id)


@router.post("/items/{item_id}/attachments", status_code=201)
def upload_attachment(item_id: str, request: Request, doc_type: str = Form(...), file: UploadFile = File(...),
                      user: User = Depends(require_role("admin", "manager", "oic")), db: Session = Depends(get_db)):
    # Reject obviously oversized uploads before reading them (the real limit is enforced while saving).
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > (settings.max_upload_mb + 1) * 1024 * 1024:
        raise ServiceError(413, "TOO_BIG", f"Files can be up to {settings.max_upload_mb} MB.")
    return attachments.upload(db, user, item_id, doc_type, file.filename or "document", file.file, client_ip(request))


@router.get("/attachments/{att_id}/file")
def get_attachment(att_id: int, download: bool = False, user: User = Depends(anyone), db: Session = Depends(get_db)):
    a, path = attachments.get_file(db, user, att_id)
    inline = not download and a.content_type in INLINE
    resp = FileResponse(path, media_type=a.content_type, filename=a.original_name, content_disposition_type="inline" if inline else "attachment")
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"  # lets the in-app preview show it; other sites still cannot frame it
    return resp


@router.delete("/attachments/{att_id}", status_code=204)
def delete_attachment(att_id: int, request: Request, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    attachments.delete(db, admin, att_id, client_ip(request))
