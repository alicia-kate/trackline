"""Who may change what, and how changes wait for approval. Routers call these; they commit."""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ServiceError
from app.core.timefmt import fmt
from app.models import ChangeRequest, MasterRow, User
from app.repositories import audit
from app.services import access, attachments, importer, items
from app.services import users as user_service
from app.services.rules import ACTIONS, TEXT_FIELDS, NUM_FIELDS, DATE_FIELDS

KNOWN = set(TEXT_FIELDS + NUM_FIELDS + DATE_FIELDS) | {"status"}


def _queue(db: Session, user: User, **kw) -> ChangeRequest:
    r = ChangeRequest(requested_by=user.username, **kw)
    db.add(r)
    audit.add(db, actor_id=user.id, actor=user.username, action="request_submitted", target=kw.get("item_id"), detail=kw["summary"][:200])
    db.commit()
    return r


def create_item(db: Session, user: User, category: str, fields: dict, ip: str | None, attachment_ids: list[int] | None = None) -> dict:
    if user.role == "oic":
        access.require_project(user, fields.get("project"))
    o = items.validate_create(db, category, fields)
    docs = attachments.claim(db, user, attachment_ids or [])
    if access.writes_directly(user):
        item_id = items.create(db, user.username, user, category, o, ip)
        attachments.attach(db, docs, item_id, user.username)
        db.commit()
        return {"id": item_id, "queued": False}
    payload = {k: v for k, v in fields.items() if k in KNOWN and v not in (None, "")}
    if docs:
        payload["attachment_ids"] = [a.id for a in docs]
        payload["docs"] = [{"id": a.id, "name": a.original_name, "type": a.doc_type} for a in docs]
        for a in docs:
            a.status = "pending"
    r = _queue(db, user, kind="create", category=category, payload=payload, summary=f"Add {category.lower()}: {o['desc']}"[:300])
    if docs:
        attachments.hold(db, docs, r.id)
        db.commit()
    return {"id": None, "queued": True}


def update_item(db: Session, user: User, item_id: str, fields: dict, ip: str | None) -> dict:
    i = items.get_model(db, item_id)
    if user.role == "oic":
        access.require_visible(user, i)
        if fields.get("project") not in (None, ""):
            access.require_project(user, fields["project"])
    o = items.validate_update(db, item_id, fields)
    if access.writes_directly(user):
        items.update(db, user.username, user, item_id, o, ip)
        db.commit()
        return {"id": item_id, "queued": False}
    payload = {k: v for k, v in fields.items() if k in KNOWN and k != "status" and v is not None}
    _queue(db, user, kind="update", item_id=item_id, category=i.category, payload=payload, summary=f"Edit {item_id}: {i.description}"[:300])
    return {"id": item_id, "queued": True}


def act(db: Session, user: User, item_id: str, action: str, data: dict, ip: str | None) -> dict:
    i = items.get_model(db, item_id)
    if user.role == "oic":
        access.require_visible(user, i)  # an OIC/User acts only inside their projects; the change still waits for approval
    d = items.check_action(db, item_id, action, data)
    if access.writes_directly(user):
        items.run_action(db, user.username, user, item_id, action, d, ip)
        db.commit()
        return {"id": item_id, "queued": False}
    _queue(db, user, kind="action", item_id=item_id, category=i.category, action=action, payload=d, summary=f"{ACTIONS[action].title}: {item_id} {i.description}"[:300])
    return {"id": item_id, "queued": True}


def import_rows(db: Session, user: User, rows: list[dict], only_valid: bool, new: dict | None, ip: str | None) -> dict:
    """Saves a checked bulk import (or queues it for approval). By default every row must be clean; skipping bad rows is a deliberate option.
    `new` is Master data (projects, vendors, ...) the person agreed to add together with the items."""
    ctx = importer.load_context(db, rows, new)
    results = importer.validate_rows(rows, ctx)
    if user.role == "oic":
        importer.restrict_projects(results, access.assigned(user))
    bad = [r for r in results if r["e"]]
    good = [r for r in results if not r["e"]]
    if bad and not only_valid:
        raise ServiceError(422, "ROWS_INVALID", f"{len(bad)} row(s) still have problems. Fix them before importing.")
    if not good:
        raise ServiceError(422, "NOTHING", "There are no valid rows to import.")
    used = importer.used_new(good, ctx)
    summary = importer.summary_text(good, used)
    if used and user.role not in access.APPROVERS:
        raise ServiceError(403, "MASTER_FORBIDDEN", "Only an admin or inventory manager can add new Master data. Pick existing values, or ask them to add the new ones first.")
    # Anyone whose changes apply at once (admin, and a manager unless MANAGERS_NEED_APPROVAL) may add new Master data; otherwise the import waits for approval.
    if access.writes_directly(user):
        res = importer.create_all(db, user.username, user, good, ip, summary=summary, new=used)
        db.commit()
        return {**res, "queued": False, "skipped": bad}
    payload = {"rows": [{"c": r["c"], "n": r["n"], "f": r["f"]} for r in good], "new": used}
    _queue(db, user, kind="import", category="Mixed", payload=payload, summary=summary[:300])
    return {"created": 0, "ids": {}, "masters_created": {}, "queued": True, "submitted": len(good), "skipped": bad}


def request_access(db: Session, user: User, project: str, note: str) -> None:
    """An OIC/User asks for another project. An admin or inventory manager decides."""
    row = db.scalar(select(MasterRow).where(MasterRow.kind == "projects", MasterRow.active.is_(True), func.lower(MasterRow.name) == project.strip().lower()))
    if row is None:
        raise ServiceError(404, "NOT_FOUND", "Project not found.")
    if row.name.lower() in access.assigned(user):
        raise ServiceError(409, "ALREADY", "You already have access to this project.")
    waiting = db.scalar(select(ChangeRequest.id).where(ChangeRequest.kind == "access", ChangeRequest.status == "pending", ChangeRequest.requested_by == user.username,
                                                       ChangeRequest.payload["project"].astext == row.name).limit(1))
    if waiting:
        raise ServiceError(409, "ALREADY_ASKED", "You already asked for this project. It is waiting for approval.")
    _queue(db, user, kind="access", category="Project", payload={"project": row.name, "note": note.strip()[:200]}, summary=f"Project access: {row.name} for {user.username}"[:300])


def to_out(r: ChangeRequest) -> dict:
    payload = {k: v for k, v in r.payload.items() if k not in ("attachment_id", "attachment_ids", "docs")}
    if r.kind == "import":  # the rows themselves stay on the server; the list only needs the counts
        payload = {k.title(): v for k, v in importer.summary_counts([{"c": x["c"]} for x in r.payload.get("rows", [])]).items()}
        for kind, names in (r.payload.get("new") or {}).items():
            payload[f"New {kind}"] = ", ".join(names)
    return {"id": r.id, "kind": r.kind, "itemId": r.item_id or "", "category": r.category, "action": r.action, "payload": payload, "summary": r.summary,
            "by": r.requested_by, "at": fmt(r.requested_at), "status": r.status, "decidedBy": r.decided_by, "decidedAt": fmt(r.decided_at) if r.decided_at else None,
            "note": r.note, "attachmentId": r.payload.get("attachment_id"), "docs": r.payload.get("docs") or []}


def list_requests(db: Session, user: User) -> list[dict]:
    q = select(ChangeRequest).order_by(ChangeRequest.id.desc())
    if user.role == "oic":
        q = q.where(ChangeRequest.requested_by == user.username)  # an OIC sees only their own requests
    return [to_out(r) for r in db.scalars(q)]


def decide(db: Session, approver: User, req_id: int, approve: bool, note: str, ip: str | None) -> None:
    if not access.can_approve(approver):
        raise ServiceError(403, "FORBIDDEN", "You do not have access to this.")
    r = db.scalar(select(ChangeRequest).where(ChangeRequest.id == req_id).with_for_update())
    if r is None or r.status != "pending":
        raise ServiceError(409, "NOT_PENDING", "This request is no longer pending.")
    if r.requested_by == approver.username:
        raise ServiceError(403, "SELF_APPROVE", "You cannot decide your own request. Ask an admin or another inventory manager.")
    by = f"{r.requested_by} (approved by {approver.username})"
    try:
        if r.kind == "attachment":
            attachments.decide(db, r, approve, by)
        elif approve:
            if r.kind == "create":
                o = items.validate_create(db, r.category, {k: v for k, v in r.payload.items() if k in KNOWN})
                r.item_id = items.create(db, r.requested_by, None, r.category, o, ip, by=by)
                attachments.finalize(db, r.payload.get("attachment_ids") or [], r.item_id, by)
            elif r.kind == "update":
                o = items.validate_update(db, r.item_id, r.payload)
                items.update(db, r.requested_by, None, r.item_id, o, ip, by=by)
            elif r.kind == "import":
                rows = [{"key": f"{x['c']}-{x['n']}", "c": x["c"], "n": x["n"], "f": x["f"]} for x in r.payload["rows"]]
                new = r.payload.get("new") or {}
                bad = [x for x in importer.validate_rows(rows, importer.load_context(db, rows, new)) if x["e"]]
                if bad:
                    field, msg = next(iter(bad[0]["e"].items()))
                    raise ServiceError(409, "STALE_IMPORT", f"{len(bad)} row(s) no longer pass the checks (for example row {bad[0]['n']} on {importer.SHEETS[bad[0]['c']]}: {msg}). Reject this request and ask for the file to be uploaded again.")
                importer.create_all(db, r.requested_by, None, rows, ip, by=by, summary=r.summary, new=new)
            elif r.kind == "access":
                user_service.grant_project(db, approver, r.requested_by, r.payload["project"], ip)
            else:
                items.run_action(db, r.requested_by, None, r.item_id, r.action, r.payload, ip, by=by)
    except ServiceError as e:
        db.rollback()
        raise ServiceError(e.status, e.code, f"Cannot approve: {e.message[0].lower() + e.message[1:]}")
    if not approve and r.kind == "create":
        attachments.reject_waiting(db, r.payload.get("attachment_ids") or [])
    r.status = "approved" if approve else "rejected"
    r.decided_by, r.decided_at, r.note = approver.username, datetime.now(timezone.utc), note.strip() or None
    audit.add(db, actor_id=approver.id, actor=approver.username, action="request_approved" if approve else "request_rejected", target=r.item_id, detail=r.summary[:200], ip=ip)
    db.commit()
