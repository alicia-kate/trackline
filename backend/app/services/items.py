from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ServiceError
from app.core.timefmt import fmt
from app.models import Item, ItemHistory, StockMovement, User
from app.repositories import audit
from app.services import access
from app.services.rules import (ACTIONS, BASE, CATEGORIES, CREATE_STATUSES, DATE_FIELDS, LABEL, NUM_FIELDS, PREFIX, REQUIRED, TEXT_FIELDS, can_do)

# frontend field name -> model attribute
ATTR = {"desc": "description", "make": "make", "model": "model", "sn": "serial_no", "mg": "mg_no", "project": "project", "vendor": "vendor", "loc": "location",
        "oic": "oic", "user": "used_by", "dept": "department", "remarks": "remarks", "qty": "qty", "min": "min_qty", "cost": "cost", "date": "purchase_date", "due": "expiry_date",
        "wdue": "warranty_expiry", "winfo": "warranty_info", "use": "purpose"}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _iso(d: date | None) -> str:
    return d.isoformat() if d else ""


def _num(v: Decimal | int | None) -> int | float | str:
    if v is None:
        return ""
    return int(v) if v == int(v) else float(v)


def to_out(i: Item, hist: list[ItemHistory]) -> dict:
    """The JSON shape the frontend already understands."""
    return {
        "id": i.id, "c": i.category, "desc": i.description, "make": i.make or "", "model": i.model or "", "sn": i.serial_no or "", "mg": i.mg_no or "",
        "qty": i.qty, "min": i.min_qty, "date": _iso(i.purchase_date), "cost": _num(i.cost), "project": i.project or "", "vendor": i.vendor or "",
        "due": _iso(i.expiry_date), "wdue": _iso(i.warranty_expiry), "winfo": i.warranty_info or "", "use": i.purpose or "", "status": i.status, "loc": i.location or "", "oic": i.oic or "", "user": i.used_by or "", "dept": i.department or "",
        "remarks": i.remarks or "", "active": i.active,
        "hist": [{"t": fmt(h.at), "a": h.action, "n": h.note or "", "by": h.by or ""} for h in hist],
    }


def _history(db: Session, item_id: str, action: str, note: str, by: str) -> None:
    db.add(ItemHistory(item_id=item_id, action=action[:40], note=note[:500], by=by[:120]))


def expire_licenses(db: Session) -> None:
    """Licenses past their expiry date become 'Expired' (same rule the browser used to apply)."""
    rows = db.scalars(select(Item).where(Item.category == "License", Item.active.is_(True), Item.status.notin_(("Expired", "Disposed")),
                                         Item.expiry_date < _today())).all()
    for i in rows:
        i.status = "Expired"
        _history(db, i.id, "Expired", "Passed expiry date", "System")
    if rows:
        db.commit()


def list_all(db: Session, user: User | None = None) -> list[dict]:
    """Every item, or for an OIC/User only the items in their assigned projects."""
    expire_licenses(db)
    q = select(Item).order_by(Item.id)
    if user is not None and user.role == "oic":
        q = q.where(func.lower(func.trim(Item.project)).in_(sorted(access.assigned(user)) or [""]))
    rows = db.scalars(q).all()
    hq = select(ItemHistory).order_by(ItemHistory.at.desc(), ItemHistory.id.desc())
    if user is not None and user.role == "oic":
        hq = hq.where(ItemHistory.item_id.in_([i.id for i in rows] or [""]))
    hist: dict[str, list[ItemHistory]] = {}
    for h in db.scalars(hq):
        hist.setdefault(h.item_id, []).append(h)
    return [to_out(i, hist.get(i.id, [])) for i in rows]


def get_model(db: Session, item_id: str) -> Item:
    i = db.get(Item, item_id)
    if i is None:
        raise ServiceError(404, "NOT_FOUND", "Item not found.")
    return i


def get_out(db: Session, item_id: str, user: User | None = None) -> dict:
    i = get_model(db, item_id)
    if user is not None:
        access.require_visible(user, i)
    h = db.scalars(select(ItemHistory).where(ItemHistory.item_id == item_id).order_by(ItemHistory.at.desc(), ItemHistory.id.desc())).all()
    return to_out(i, list(h))


def movements(db: Session, user: User, item_id: str) -> list[dict]:
    """The stock in / stock out log of one spare, newest first."""
    i = get_model(db, item_id)
    access.require_visible(user, i)
    rows = db.scalars(select(StockMovement).where(StockMovement.item_id == item_id).order_by(StockMovement.at.desc(), StockMovement.id.desc())).all()
    return [{"id": m.id, "at": fmt(m.at), "dir": m.direction, "qty": m.qty, "balance": m.balance_after, "why": m.reason or "", "to": m.issued_to or "",
             "note": m.remarks or "", "by": m.by or ""} for m in rows]


# ---------- cleaning input ----------

def _clean(fields: dict, category: str) -> dict:
    """Returns {frontend key: python value}. Blank text becomes None. Unknown keys are ignored."""
    out: dict = {}
    for k in TEXT_FIELDS:
        if k in fields:
            v = fields[k]
            v = None if v is None else str(v).strip()
            if k == "winfo" and v and len(v) > 300:
                raise ServiceError(422, "TOO_LONG", "Warranty / support terms can be up to 300 characters.")
            if k == "use" and v and len(v) > 500:
                raise ServiceError(422, "TOO_LONG", "Description can be up to 500 characters.")
            out[k] = v or None
    for k in NUM_FIELDS:
        if k in fields:
            v = fields[k]
            if v in (None, ""):
                out[k] = None
                continue
            try:
                n = Decimal(str(v))
            except InvalidOperation:
                raise ServiceError(422, "BAD_NUMBER", f"{LABEL.get(k, k.title())} must be a number.")
            if n < 0:
                raise ServiceError(422, "BAD_NUMBER", f"{LABEL.get(k, k.title())} cannot be negative.")
            if k in ("qty", "min"):
                if n != n.to_integral_value():
                    raise ServiceError(422, "BAD_NUMBER", f"{LABEL.get(k)} must be a whole number.")
                n = int(n)
            out[k] = n
    for k in DATE_FIELDS:
        if k in fields:
            v = fields[k]
            if v in (None, ""):
                out[k] = None
                continue
            try:
                out[k] = date.fromisoformat(str(v))
            except ValueError:
                raise ServiceError(422, "BAD_DATE", "Dates must look like 2026-11-10.")
    if "status" in fields and fields["status"] in CREATE_STATUSES:
        out["status"] = fields["status"]
    return out


def _check_duplicates(db: Session, category: str, o: dict, self_id: str | None) -> None:
    if o.get("mg"):
        q = select(Item.id).where(Item.mg_no == o["mg"])
        if self_id:
            q = q.where(Item.id != self_id)
        if db.scalar(q.limit(1)):
            raise ServiceError(409, "DUPLICATE", "That MG No already exists.")
    if category == "Asset" and o.get("sn"):
        q = select(Item.id).where(Item.category == "Asset", Item.serial_no == o["sn"])
        if self_id:
            q = q.where(Item.id != self_id)
        if db.scalar(q.limit(1)):
            raise ServiceError(409, "DUPLICATE", "That serial number already exists.")


def validate_create(db: Session, category: str, fields: dict) -> dict:
    if category not in CATEGORIES:
        raise ServiceError(422, "BAD_CATEGORY", "Category must be Asset, License or Spare.")
    o = _clean(fields, category)
    missing = [LABEL[k] for k in REQUIRED[category] if o.get(k) in (None, "")]
    if missing:
        raise ServiceError(422, "MISSING", "Fill in: " + ", ".join(missing))
    _check_duplicates(db, category, o, None)
    return o


def validate_update(db: Session, item_id: str, fields: dict) -> dict:
    i = get_model(db, item_id)
    o = _clean(fields, i.category)
    o.pop("status", None)  # status only changes through actions
    if i.category != "License":
        o.pop("qty", None)  # assets are always 1; spare balances move through stock in / out
    for k in REQUIRED[i.category]:
        if k in o and o[k] in (None, ""):
            raise ServiceError(422, "MISSING", f"{LABEL[k]} is required.")
    _check_duplicates(db, i.category, o, item_id)
    return o


# ---------- create / update ----------

def _next_id(db: Session, category: str) -> str:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('trackline-item-id'))"))
    p = PREFIX[category]
    top = db.scalar(select(func.max(cast(func.substr(Item.id, 5), Integer))).where(Item.category == category)) or 0
    return f"{p}-{max(BASE[category], top) + 1:04d}"


def create(db: Session, actor_name: str, actor: User | None, category: str, o: dict, ip: str | None, by: str | None = None,
           note: str = "Added to the register", log_audit: bool = True) -> str:
    item_id = _next_id(db, category)
    item = Item(id=item_id, category=category, status=o.get("status", "Available"), active=True, qty=o.get("qty") if o.get("qty") is not None else 1,
                min_qty=o.get("min") or 0, updated_at=func.now())
    for k, attr in ATTR.items():
        if k in o and k not in ("qty", "min"):
            setattr(item, attr, o[k])
    if category == "Asset":
        item.qty = 1
    try:
        db.add(item)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ServiceError(409, "DUPLICATE", "That serial number or MG No already exists.")
    _history(db, item_id, "Created", note, by or actor_name)
    if log_audit:  # a bulk import writes one audit line for the whole file instead
        audit.add(db, actor_id=actor.id if actor else None, actor=actor_name, action="item_created", target=item_id, detail=(o.get("desc") or "")[:200], ip=ip)
    return item_id


def _same(a, b) -> bool:
    if a in (None, "") and b in (None, ""):
        return True
    if isinstance(a, (int, float, Decimal)) and isinstance(b, (int, float, Decimal)):
        return Decimal(str(a)) == Decimal(str(b))
    return str(a if a is not None else "") == str(b if b is not None else "")


def update(db: Session, actor_name: str, actor: User | None, item_id: str, o: dict, ip: str | None, by: str | None = None) -> str:
    i = get_model(db, item_id)
    before = to_out(i, [])
    changed = []
    for k, v in o.items():
        attr = ATTR[k]
        cur = getattr(i, attr)
        cur_cmp = before[k] if k in before else cur
        new_cmp = v.isoformat() if isinstance(v, date) else v
        if not _same(cur_cmp, new_cmp):
            changed.append(k)
        setattr(i, attr, v)
    if changed:
        i.updated_at = func.now()
        _history(db, item_id, "Edited", "Changed: " + ", ".join(changed), by or actor_name)
        audit.add(db, actor_id=actor.id if actor else None, actor=actor_name, action="item_updated", target=item_id, detail=", ".join(changed), ip=ip)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ServiceError(409, "DUPLICATE", "That serial number or MG No already exists.")
    return item_id


# ---------- actions ----------

def _clean_action(action: str, data: dict) -> dict[str, str]:
    a = ACTIONS[action]
    d = {k: str(data[k]).strip() for k in a.fields if k in data and data[k] is not None}
    missing = [k for k in a.required if not d.get(k)]
    if missing:
        raise ServiceError(422, "MISSING", "Fill in all required fields.")
    return d


def check_action(db: Session, item_id: str, action: str, data: dict) -> dict[str, str]:
    """Validates without changing anything. Returns the cleaned data."""
    if action not in ACTIONS:
        raise ServiceError(422, "BAD_ACTION", "Unknown action.")
    i = get_model(db, item_id)
    if not can_do(i.category, i.status, i.active, action):
        raise ServiceError(409, "NOT_ALLOWED", "This action is not allowed for the item in its current state.")
    d = _clean_action(action, data)
    if action in ("in", "out"):
        try:
            q = Decimal(d["q"])
        except InvalidOperation:
            q = Decimal(0)
        if q <= 0 or q != q.to_integral_value():
            raise ServiceError(422, "BAD_NUMBER", "Quantity must be a whole number above zero.")
        q = int(q)
        d["q"] = str(q)
        if action == "out" and q > i.qty:
            raise ServiceError(409, "NOT_ENOUGH", f"Only {i.qty} units on hand.")
    if action == "renew":
        try:
            new = date.fromisoformat(d["due"])
        except ValueError:
            raise ServiceError(422, "BAD_DATE", "Dates must look like 2026-11-10.")
        if i.expiry_date and new <= i.expiry_date:
            raise ServiceError(409, "BAD_DATE", f"New expiry must be later than {i.expiry_date.isoformat()}.")
    if d.get("cost"):
        try:
            if Decimal(d["cost"]) < 0:
                raise ValueError
        except (InvalidOperation, ValueError):
            raise ServiceError(422, "BAD_NUMBER", "Renewal cost must be a positive number.")
    return d


def run_action(db: Session, actor_name: str, actor: User | None, item_id: str, action: str, data: dict, ip: str | None, by: str | None = None) -> str:
    d = check_action(db, item_id, action, data)
    i = get_model(db, item_id)
    a = ACTIONS[action]
    n = " · ".join(x for x in [
        d.get("who") and f"To {d['who']}{' / ' + d['dept'] if d.get('dept') else ''}",
        d.get("user") and f"To {d['user']}",
        d.get("loc") and f"Location: {d['loc']}",
        d.get("why") and f"Reason: {d['why']}",
        d.get("cost") and f"Cost: {d['cost']}",
        d.get("rem"),
    ] if x)
    if "who" in d:
        i.used_by = d["who"]
        i.department = d.get("dept") or None
    if action == "return":
        i.used_by = None
        i.department = None
    if d.get("loc"):
        i.location = d["loc"]
    if action == "renew":
        i.expiry_date = date.fromisoformat(d["due"])
        n = f"New expiry {d['due']}" + (f" · {n}" if n else "")
        if i.status == "Expired":
            i.status = "Available"
    if action in ("in", "out"):
        q = int(d["q"]) * (1 if action == "in" else -1)
        i.qty += q
        db.add(StockMovement(item_id=item_id, direction=action, qty=abs(q), balance_after=i.qty, reason=(d.get("why") or None) and d["why"][:200],
                             issued_to=(d.get("user") or None) and d["user"][:100], remarks=(d.get("rem") or None) and d["rem"][:500], by=(by or actor_name)[:120]))
        n = f"{'+' if q > 0 else '−'}{abs(q)} · Balance {i.qty}" + (f" · {n}" if n else "")
    if a.to:
        i.status = a.to
    if action == "off":
        i.active = False
    if action == "on":
        i.active = True
    i.updated_at = func.now()
    _history(db, item_id, a.title, n, by or actor_name)
    audit.add(db, actor_id=actor.id if actor else None, actor=actor_name, action="item_action", target=item_id, detail=action, ip=ip)
    return item_id
