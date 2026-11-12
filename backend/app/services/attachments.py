import re
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import storage
from app.core.errors import ServiceError
from app.core.timefmt import fmt
from app.models import Attachment, AttachmentItem, ChangeRequest, Item, ItemHistory, User
from app.repositories import audit
from app.services import access

# What people pick  ->  folder name on disk
DOC_TYPES = {"Invoice": "Invoice", "Warranty": "Warranty", "Transmittal advice": "Transmittal-advice", "Asset file": "Asset-file", "Other": "Other"}
CATEGORY_DIR = {"Asset": "Assets", "License": "Licenses", "Spare": "Spares"}
ITEM_ID = re.compile(r"^[A-Z]{3}-\d{4,}$")


def to_out(a: Attachment, items: list[str] | None = None) -> dict:
    return {"id": a.id, "itemId": a.item_id or "", "items": items if items is not None else ([a.item_id] if a.item_id else []), "docType": a.doc_type, "name": a.original_name, "type": a.content_type,
            "size": a.size_bytes, "by": a.uploaded_by, "at": fmt(a.uploaded_at), "status": a.status}


def _links(db: Session, ids: list[int]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {i: [] for i in ids}
    if ids:
        for aid, iid in db.execute(select(AttachmentItem.attachment_id, AttachmentItem.item_id).where(AttachmentItem.attachment_id.in_(ids)).order_by(AttachmentItem.item_id)):
            out[aid].append(iid)
    return out


def _visible(db: Session, user: User, ids: set[str]) -> set[str]:
    """Of these items, the ones this person may see (an OIC/User only sees their projects)."""
    if user.role != "oic" or not ids:
        return ids
    return {i.id for i in db.scalars(select(Item).where(Item.id.in_(ids))) if access.can_see(user, i)}


def _out_many(db: Session, user: User, rows: list[Attachment]) -> list[dict]:
    links = _links(db, [a.id for a in rows])
    seen = _visible(db, user, {i for v in links.values() for i in v})
    return [to_out(a, [i for i in links[a.id] if i in seen]) for a in rows]


def _can_see(a: Attachment, user: User) -> bool:
    return a.status == "active" or (a.status == "pending" and (access.can_approve(user) or a.uploaded_by_id == user.id))


def stage(db: Session, user: User, doc_type: str, filename: str, stream: BinaryIO) -> dict:
    """Store a file for an item that is not created yet. It joins the item when the item is created or approved."""
    if doc_type not in DOC_TYPES:
        raise ServiceError(422, "BAD_DOC_TYPE", "Choose a document type.")
    original = Path(filename.replace("\\", "/")).name.strip()[:255] or "document"
    rel, ctype, size, sha = storage.save(stream, original, f"Staging/{user.id}")
    a = Attachment(item_id=None, doc_type=doc_type, original_name=original, stored_path=rel, content_type=ctype, size_bytes=size, sha256=sha,
                   status="staged", uploaded_by_id=user.id, uploaded_by=user.username)
    db.add(a)
    db.commit()
    return to_out(a, [])


def unstage(db: Session, user: User, att_id: int) -> None:
    a = db.get(Attachment, att_id)
    if a is None or a.status != "staged" or a.uploaded_by_id != user.id:
        raise ServiceError(404, "NOT_FOUND", "Document not found.")
    a.status, a.deleted_by, a.deleted_at = "deleted", user.username, datetime.now(timezone.utc)
    db.commit()


def claim(db: Session, user: User, ids: list[int]) -> list[Attachment]:
    """The staged files this person uploaded for the item they are creating."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    rows = list(db.scalars(select(Attachment).where(Attachment.id.in_(ids)).with_for_update()))
    if len(rows) != len(ids) or any(a.status != "staged" or a.uploaded_by_id != user.id for a in rows):
        raise ServiceError(422, "BAD_DOCUMENT", "One of the documents was not found. Add it again.")
    return rows


def attach(db: Session, rows: list[Attachment], item_id: str, by: str) -> None:
    for a in rows:
        a.item_id, a.status = item_id, "active"
        db.add(AttachmentItem(attachment_id=a.id, item_id=item_id))
        db.add(ItemHistory(item_id=item_id, action="Document added", note=f"{a.original_name} ({a.doc_type})", by=by))


def hold(db: Session, rows: list[Attachment], request_id: int) -> None:
    for a in rows:
        a.status, a.request_id = "pending", request_id


def finalize(db: Session, ids: list[int], item_id: str, by: str) -> None:
    """The item was approved: its waiting documents join it."""
    if ids:
        attach(db, list(db.scalars(select(Attachment).where(Attachment.id.in_(ids), Attachment.status == "pending", Attachment.item_id.is_(None)))), item_id, by)


def reject_waiting(db: Session, ids: list[int]) -> None:
    if ids:
        for a in db.scalars(select(Attachment).where(Attachment.id.in_(ids), Attachment.status == "pending", Attachment.item_id.is_(None))):
            a.status = "rejected"


def _item_for(db: Session, user: User, item_id: str) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise ServiceError(404, "NOT_FOUND", "Item not found.")
    access.require_visible(user, item)  # an OIC/User only sees documents of their own items
    return item


def list_for_item(db: Session, user: User, item_id: str) -> list[dict]:
    _item_for(db, user, item_id)
    rows = db.scalars(select(Attachment).join(AttachmentItem, AttachmentItem.attachment_id == Attachment.id)
                      .where(AttachmentItem.item_id == item_id, Attachment.status.in_(("active", "pending"))).order_by(Attachment.uploaded_at.desc())).all()
    return _out_many(db, user, [a for a in rows if _can_see(a, user)])


def list_docs(db: Session, user: User, project: str | None, vendor: str | None, q: str | None) -> list[dict]:
    """Documents of every item in a project or from a vendor, each document once."""
    stmt = (select(Attachment).join(AttachmentItem, AttachmentItem.attachment_id == Attachment.id).join(Item, Item.id == AttachmentItem.item_id)
            .where(Attachment.status.in_(("active", "pending"))))
    if project:
        stmt = stmt.where(func.lower(func.trim(Item.project)) == project.strip().lower())
    if vendor:
        stmt = stmt.where(func.lower(func.trim(Item.vendor)) == vendor.strip().lower())
    if q:
        stmt = stmt.where(Attachment.original_name.ilike(f"%{q.strip()}%"))
    if user.role == "oic":
        stmt = stmt.where(func.lower(func.trim(Item.project)).in_(sorted(access.assigned(user)) or [""]))
    rows = db.scalars(stmt.distinct().order_by(Attachment.uploaded_at.desc()).limit(500)).all()
    return _out_many(db, user, [a for a in rows if _can_see(a, user)])


def _size_text(n: int) -> str:
    return f"{n / 1024:.0f} KB" if n < 1024 * 1024 else f"{n / 1024 / 1024:.1f} MB"


def upload(db: Session, user: User, item_id: str, doc_type: str, filename: str, stream: BinaryIO, ip: str | None) -> dict:
    item = db.get(Item, item_id)
    if item is None or not ITEM_ID.match(item_id):
        raise ServiceError(404, "NOT_FOUND", "Item not found.")
    access.require_visible(user, item)
    if doc_type not in DOC_TYPES:
        raise ServiceError(422, "BAD_DOC_TYPE", "Choose a document type.")
    original = Path(filename.replace("\\", "/")).name.strip()[:255] or "document"
    rel_dir = f"{CATEGORY_DIR[item.category]}/{item_id}/{DOC_TYPES[doc_type]}"
    rel, ctype, size, sha = storage.save(stream, original, rel_dir)
    admin = access.writes_directly(user)
    a = Attachment(item_id=item_id, doc_type=doc_type, original_name=original, stored_path=rel, content_type=ctype, size_bytes=size, sha256=sha,
                   status="active" if admin else "pending", uploaded_by_id=user.id, uploaded_by=user.username)
    db.add(a)
    db.flush()
    db.add(AttachmentItem(attachment_id=a.id, item_id=item_id))
    if admin:
        db.add(ItemHistory(item_id=item_id, action="Document added", note=f"{original} ({doc_type})", by=user.username))
    else:
        req = ChangeRequest(kind="attachment", item_id=item_id, category=item.category, requested_by=user.username,
                            summary=f"Upload document to {item_id}: {original}"[:300],
                            payload={"file": original, "type": doc_type, "size": _size_text(size), "attachment_id": a.id})
        db.add(req)
        db.flush()
        a.request_id = req.id
    audit.add(db, actor_id=user.id, actor=user.username, action="attachment_uploaded", target=item_id, detail=f"{original} ({doc_type}) {a.status}", ip=ip)
    db.commit()
    return {"attachment": to_out(a), "queued": not admin}


def get_file(db: Session, user: User, att_id: int) -> tuple[Attachment, Path]:
    a = db.get(Attachment, att_id)
    if a is None or not _can_see(a, user):
        raise ServiceError(404, "NOT_FOUND", "Document not found.")
    linked = set(_links(db, [a.id])[a.id])
    # A document that waits for its new item to be approved has no item yet: its uploader and the approvers may open it.
    if not (_visible(db, user, linked) if linked else (a.uploaded_by_id == user.id or access.can_approve(user))):
        raise ServiceError(404, "NOT_FOUND", "Document not found.")
    p = storage.resolve(a.stored_path)
    if not p.is_file():
        raise ServiceError(404, "FILE_MISSING", "The file is missing from the storage folder. Ask an admin to check the storage folder.")
    return a, p


def delete(db: Session, admin: User, att_id: int, ip: str | None) -> None:
    a = db.get(Attachment, att_id)
    if a is None or a.status != "active":
        raise ServiceError(404, "NOT_FOUND", "Document not found.")
    a.status, a.deleted_by, a.deleted_at = "deleted", admin.username, datetime.now(timezone.utc)
    for iid in _links(db, [a.id])[a.id]:
        db.add(ItemHistory(item_id=iid, action="Document removed", note=f"{a.original_name} ({a.doc_type})", by=admin.username))
    audit.add(db, actor_id=admin.id, actor=admin.username, action="attachment_deleted", target=a.item_id, detail=a.original_name, ip=ip)
    db.commit()


def _active(db: Session, att_id: int) -> Attachment:
    a = db.get(Attachment, att_id)
    if a is None or a.status not in ("active", "pending"):
        raise ServiceError(404, "NOT_FOUND", "Document not found.")
    if a.status != "active":
        raise ServiceError(409, "NOT_ACTIVE", "A document can be shared once it has been approved.")
    return a


def share(db: Session, actor: User, att_id: int, item_ids: list[str], ip: str | None) -> dict:
    """Link an approved document to more items."""
    a = _active(db, att_id)
    have = set(_links(db, [a.id])[a.id])
    added: list[str] = []
    for iid in dict.fromkeys(item_ids):
        if db.get(Item, iid) is None:
            raise ServiceError(404, "NOT_FOUND", f"Item {iid} not found.")
        if iid in have:
            continue
        db.add(AttachmentItem(attachment_id=a.id, item_id=iid))
        db.add(ItemHistory(item_id=iid, action="Document linked", note=f"{a.original_name} ({a.doc_type})", by=actor.username))
        added.append(iid)
    if added:
        audit.add(db, actor_id=actor.id, actor=actor.username, action="attachment_linked", target=a.item_id, detail=f"{a.original_name} -> {', '.join(added)}"[:500], ip=ip)
    db.commit()
    return to_out(a, _links(db, [a.id])[a.id])


def unlink(db: Session, actor: User, att_id: int, item_id: str, ip: str | None) -> None:
    a = _active(db, att_id)
    links = _links(db, [a.id])[a.id]
    if item_id not in links:
        raise ServiceError(404, "NOT_FOUND", "That item is not linked to this document.")
    if len(links) <= 1:
        raise ServiceError(409, "LAST_LINK", "A document must stay linked to at least one item. Remove the document instead.")
    db.delete(db.get(AttachmentItem, (a.id, item_id)))
    db.add(ItemHistory(item_id=item_id, action="Document unlinked", note=f"{a.original_name} ({a.doc_type})", by=actor.username))
    audit.add(db, actor_id=actor.id, actor=actor.username, action="attachment_unlinked", target=item_id, detail=a.original_name, ip=ip)
    db.commit()


# ---- called when an admin or inventory manager decides someone's upload ----

def decide(db: Session, req: ChangeRequest, approve: bool, by: str) -> None:
    a = db.get(Attachment, req.payload.get("attachment_id"))
    if a is None or a.status != "pending":
        raise ServiceError(409, "NOT_PENDING", "The uploaded file is no longer waiting.")
    if approve:
        a.status = "active"
        for iid in _links(db, [a.id])[a.id]:
            db.add(ItemHistory(item_id=iid, action="Document added", note=f"{a.original_name} ({a.doc_type})", by=by))
    else:
        a.status = "rejected"
