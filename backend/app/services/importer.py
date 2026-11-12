"""Bulk import of items from an Excel template.

Flow: download_template -> fill in -> parse (read the file) -> validate_rows (check every row) -> create_all (save).
The server keeps nothing between steps: the page holds the rows and sends them back each time, and every step checks them again.
"""
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ServiceError
from app.models import Item, MasterRow, User
from app.repositories import audit
from app.services import items, masters
from app.services.rules import CATEGORIES, CREATE_STATUSES, REQUIRED

CURRENCY = "SGD"  # keep in step with CURRENCY in frontend/src/lib/rules.ts
MAX_ROWS = 1000
MAX_BYTES = 5 * 1024 * 1024
SHEETS = {"Asset": "Assets", "License": "Software Licenses", "Spare": "Spares"}
PLURAL = {"Asset": "assets", "License": "licenses", "Spare": "spares"}
MASTER_KIND = {"project": "projects", "vendor": "vendors", "loc": "locations", "dept": "departments"}
MASTER_NAME = {"project": "Projects", "vendor": "Vendors", "loc": "Locations", "dept": "Departments"}
LIMIT = {"desc": 200, "use": 500, "make": 100, "model": 100, "sn": 120, "mg": 50, "winfo": 300, "oic": 100, "user": 100, "remarks": 1000}


@dataclass(frozen=True)
class Col:
    key: str
    header: str
    kind: str  # text | int | money | date | status | project | vendor | loc | dept
    help: str
    width: int = 18


def _c(key, header, kind, help, width=18):
    return Col(key, header, kind, help, width)


_COMMON_TAIL = [_c("remarks", "Remarks", "text", "Anything else worth knowing.", 30)]
COLS: dict[str, list[Col]] = {
    "Asset": [
        _c("desc", "Item name", "text", "Name of the item, e.g. Dell Latitude 7440 laptop.", 28),
        _c("use", "Description", "text", "What it is used for, e.g. Field laptop for the site engineering team.", 34), _c("make", "Make", "text", "Brand, e.g. Dell."),
        _c("model", "Model", "text", "Model name or number."), _c("sn", "Serial number", "text", "Must be unique among assets."),
        _c("mg", "MG No", "text", "Your internal MG number. Must be unique."), _c("date", "Purchase date", "date", "Format 2026-11-10 (or 10/11/2026, day first)."),
        _c("cost", f"Purchase cost ({CURRENCY})", "money", "Numbers only, up to 2 decimals."), _c("project", "Purchase project", "project", "Pick from the list (Master data)."),
        _c("vendor", "Vendor / supplier", "vendor", "Pick from the list (Master data)."), _c("wdue", "Warranty / support end date", "date", "The date the warranty or support ends. It drives the warranty alert. Format 2026-11-10."),
        _c("winfo", "Warranty / support terms", "text", "The terms in words, e.g. 3-year onsite next business day, contract WS-1234 (up to 300 characters).", 30),
        _c("status", "Status", "status", "Available, Assigned or In Use. Blank means Available."), _c("loc", "Location / site", "loc", "Pick from the list (Master data)."),
        _c("oic", "OIC responsible person", "text", "Name of the person responsible."), _c("user", "Current user", "text", "Who is using it now, if anyone."),
        _c("dept", "Department", "dept", "Pick from the list (Master data)."),
    ] + _COMMON_TAIL,
    "License": [
        _c("desc", "Item name", "text", "Name of the software or subscription, e.g. Microsoft 365 Business.", 28),
        _c("use", "Description", "text", "What it is used for, e.g. Email and documents for the project office.", 34), _c("make", "Publisher", "text", "Who makes it, e.g. Microsoft."),
        _c("sn", "License key", "text", "The key or subscription ID, if you hold one."), _c("qty", "Seats", "int", "Number of seats or licenses (1 or more)."),
        _c("date", "Purchase date", "date", "Format 2026-11-10 (or 10/11/2026, day first)."), _c("cost", f"Purchase cost ({CURRENCY})", "money", "Numbers only, up to 2 decimals."),
        _c("project", "Purchase project", "project", "Pick from the list (Master data)."), _c("vendor", "Vendor / supplier", "vendor", "Pick from the list (Master data)."),
        _c("due", "Next renewal / expiry", "date", "Format 2026-11-10."), _c("winfo", "Warranty / support terms", "text", "Support terms or contract number (up to 300 characters).", 30),
        _c("status", "Status", "status", "Available, Assigned or In Use. Blank means Available."), _c("loc", "Location / site", "loc", "Pick from the list (Master data)."),
        _c("oic", "OIC responsible person", "text", "Name of the person responsible."), _c("user", "Current user", "text", "Who is using it now, if anyone."),
        _c("dept", "Department", "dept", "Pick from the list (Master data)."),
    ] + _COMMON_TAIL,
    "Spare": [
        _c("desc", "Item name", "text", "Name of the spare or consumable, e.g. HDMI cable 2 m.", 28),
        _c("use", "Description", "text", "What it is used for, e.g. Spare for meeting-room displays.", 34), _c("make", "Make", "text", "Brand, if it matters."),
        _c("sn", "Part number", "text", "Part number, if any."), _c("qty", "Opening balance", "int", "How many you hold now (0 or more)."),
        _c("min", "Reorder level", "int", "A low-stock alert shows when the balance falls to this number or lower."), _c("date", "Purchase date", "date", "Format 2026-11-10."),
        _c("cost", f"Purchase cost ({CURRENCY})", "money", "Numbers only, up to 2 decimals."), _c("project", "Purchase project", "project", "Pick from the list (Master data)."),
        _c("vendor", "Vendor / supplier", "vendor", "Pick from the list (Master data)."), _c("loc", "Location / site", "loc", "Pick from the list (Master data)."),
        _c("oic", "OIC responsible person", "text", "Name of the person responsible."),
    ] + _COMMON_TAIL,
}


def is_required(cat: str, key: str) -> bool:
    return key in REQUIRED[cat]


def header_text(cat: str, c: Col) -> str:
    return c.header + (" *" if is_required(cat, c.key) else "")


def columns_payload() -> dict:
    return {cat: [{"k": c.key, "h": header_text(cat, c), "kind": c.kind, "req": is_required(cat, c.key), "help": c.help} for c in cols] for cat, cols in COLS.items()}


# ---------------------------------------------------------------- template

def _masters(db: Session) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {k: [] for k in MASTER_KIND.values()}
    for r in db.scalars(select(MasterRow).where(MasterRow.active.is_(True)).order_by(MasterRow.name)):
        out[r.kind].append(r.name)
    return out


def template_bytes(db: Session) -> bytes:
    m = _masters(db)
    wb = Workbook()
    ins = wb.active
    ins.title = "Instructions"
    lines = [
        ("Trackline bulk import template", "t"),
        ("", ""),
        ("1. Use the sheet that matches what you are adding: Assets, Software Licenses or Spares. You can fill one, two or all three.", ""),
        ("2. Add one item per row, starting on row 2. Columns marked * are required. Leave the others blank if you do not have the information.", ""),
        ("3. Project, Vendor, Location and Department have a drop-down of your Master data (see the 'Lists' sheet). If one is new, just type it. After you upload, Trackline lets you add it to Master data or switch the rows to an existing value.", ""),
        ("4. Dates: write 2026-11-10 (year-month-day). A normal Excel date also works. 10/11/2026 is read as 10 November 2026 (day first).", ""),
        ("5. Do not rename the sheets, move the columns or change the header row. Do not edit the 'Lists' sheet.", ""),
        ("6. In Trackline, open Import, upload this file and press Check. Nothing is saved until you press Import. Problems are shown row by row and can be fixed on the page.", ""),
        ("", ""),
        ("Good to know", "t"),
        ("- Item IDs (AST-, LIC-, SPR-) are created automatically. Do not type them.", ""),
        ("- Asset: serial numbers and MG numbers must be unique. An MG number can only be used once across all items.", ""),
        ("- Item name is what the item is called. Description is optional: what it is used for.", ""),
        ("- Warranty / support end date is the date (it drives the warranty alert). Warranty / support terms is the wording, such as the contract number.", ""),
        ("- Costs are in " + CURRENCY + ".", ""),
        ("- Assets always count as 1. Licenses use Seats. Spares use Opening balance and Reorder level.", ""),
        ("- Status can be Available, Assigned or In Use. Leave it blank for Available.", ""),
        ("- Up to 1,000 rows per file. Documents such as invoices cannot be imported here: attach them on each item afterwards.", ""),
        ("- This imports new items only. It does not change items that already exist.", ""),
    ]
    for i, (text, style) in enumerate(lines, start=1):
        c = ins.cell(row=i, column=1, value=text)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if style == "t":
            c.font = Font(bold=True, size=13)
    ins.column_dimensions["A"].width = 120

    lst = wb.create_sheet("Lists")
    heads = ["Projects", "Vendors", "Locations", "Departments", "Status"]
    data = [m["projects"], m["vendors"], m["locations"], m["departments"], list(CREATE_STATUSES)]
    for ci, (h, vals) in enumerate(zip(heads, data), start=1):
        lst.cell(row=1, column=ci, value=h).font = Font(bold=True)
        for ri, v in enumerate(vals, start=2):
            lst.cell(row=ri, column=ci, value=v)
        lst.column_dimensions[get_column_letter(ci)].width = 26
    lst.cell(row=1, column=7, value="Do not edit this sheet. It is refreshed every time you download the template.").font = Font(italic=True, color="888888")
    list_col = {"project": 1, "vendor": 2, "loc": 3, "dept": 4, "status": 5}
    list_len = {"project": len(data[0]), "vendor": len(data[1]), "loc": len(data[2]), "dept": len(data[3]), "status": len(data[4])}

    req_fill, opt_fill = PatternFill("solid", fgColor="FCE9B8"), PatternFill("solid", fgColor="E8EEFC")
    last = MAX_ROWS + 1
    for cat in CATEGORIES:
        ws = wb.create_sheet(SHEETS[cat])
        for ci, c in enumerate(COLS[cat], start=1):
            cell = ws.cell(row=1, column=ci, value=header_text(cat, c))
            cell.font = Font(bold=True)
            cell.fill = req_fill if is_required(cat, c.key) else opt_fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")
            cell.comment = Comment(c.help, "Trackline", width=260, height=70)
            ws.column_dimensions[get_column_letter(ci)].width = max(c.width, len(header_text(cat, c)) + 2)
            L = get_column_letter(ci)
            if c.kind in list_col:
                n = max(list_len[c.kind], 1)
                dv = DataValidation(type="list", formula1=f"=Lists!${get_column_letter(list_col[c.kind])}$2:${get_column_letter(list_col[c.kind])}${n + 1}", allow_blank=True)
                dv.error, dv.errorTitle, dv.showErrorMessage = "This is not in the list yet. You can keep it: Trackline will offer to add it to Master data when you upload.", "Not in the list", True
                dv.errorStyle = "warning"
                ws.add_data_validation(dv)
                dv.add(f"{L}2:{L}{last}")
            elif c.kind in ("int", "money"):
                dv = DataValidation(type="whole" if c.kind == "int" else "decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True)
                dv.error, dv.errorTitle, dv.showErrorMessage = "Enter a number of 0 or more.", "Not a valid number", True
                ws.add_data_validation(dv)
                dv.add(f"{L}2:{L}{last}")
            if c.kind == "date":
                for r in range(2, last + 1):
                    ws.cell(row=r, column=ci).number_format = "yyyy-mm-dd"
        ws.row_dimensions[1].height = 32
        ws.freeze_panes = "B2"
    wb.move_sheet("Lists", offset=len(wb.sheetnames) - 1 - wb.sheetnames.index("Lists"))  # the lists sheet goes last
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- reading the file

def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else format(Decimal(repr(v)), "f")
    if isinstance(v, (int, Decimal)):
        return format(v, "f") if isinstance(v, Decimal) else str(v)
    return re.sub(r"[\x00-\x08\x0b-\x1f]", "", str(v)).strip()


def _head_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("*", "")).strip().lower()


def parse(data: bytes) -> tuple[list[dict], list[str]]:
    """Reads the uploaded workbook into rows. Returns (rows, warnings). Nothing is checked beyond the shape of the file."""
    if len(data) > MAX_BYTES:
        raise ServiceError(413, "TOO_BIG", f"The file can be up to {MAX_BYTES // 1024 // 1024} MB.")
    if not data.startswith(b"PK\x03\x04"):
        raise ServiceError(415, "BAD_CONTENT", "That is not an Excel (.xlsx) file.")
    try:
        with zipfile.ZipFile(BytesIO(data)) as z:
            info = z.infolist()
            if "xl/workbook.xml" not in z.namelist():
                raise ServiceError(415, "BAD_CONTENT", "That is not an Excel (.xlsx) file.")
            if len(info) > 300 or sum(i.file_size for i in info) > 100 * 1024 * 1024:
                raise ServiceError(413, "TOO_BIG", "That file is too large to read safely.")
    except zipfile.BadZipFile:
        raise ServiceError(415, "BAD_CONTENT", "That is not an Excel (.xlsx) file.")
    try:
        wb = load_workbook(BytesIO(data), read_only=True, data_only=True)  # values only: formulas are never run
    except Exception:
        raise ServiceError(422, "BAD_FILE", "The file could not be read. Download a fresh template and try again.")
    rows: list[dict] = []
    warnings: list[str] = []
    found = False
    for cat in CATEGORIES:
        name = SHEETS[cat]
        if name not in wb.sheetnames:
            continue
        found = True
        ws = wb[name]
        it = ws.iter_rows(min_row=1, max_row=MAX_ROWS + 500, values_only=True)
        head = next(it, None) or ()
        by_head = {_head_key(header_text(cat, c)): c for c in COLS[cat]}
        pos: dict[int, Col] = {}
        for idx, h in enumerate(head):
            t = _cell_text(h)
            if not t:
                continue
            col = by_head.get(_head_key(t))
            if col is None:
                warnings.append(f"Sheet '{name}': the column '{t}' is not part of the template and was ignored.")
            else:
                pos[idx] = col
        missing = [header_text(cat, c) for c in COLS[cat] if is_required(cat, c.key) and c not in pos.values()]
        if missing:
            raise ServiceError(422, "BAD_TEMPLATE", f"Sheet '{name}' has no '{missing[0]}' column. Download a fresh template and copy your data into it.")
        for n, row in enumerate(it, start=2):
            f = {c.key: _cell_text(row[i]) if i < len(row) else "" for i, c in pos.items()}
            if not any(f.values()):
                continue
            f = {k: _date_text(v) if _kind(cat, k) == "date" else v for k, v in f.items()}
            rows.append({"key": f"{cat}-{n}", "c": cat, "n": n, "f": f})
            if len(rows) > MAX_ROWS:
                raise ServiceError(422, "TOO_MANY", f"A file can have up to {MAX_ROWS:,} rows. Split it into smaller files.")
    wb.close()
    if not found:
        raise ServiceError(422, "BAD_TEMPLATE", "This does not look like the Trackline template. Download the template and use its sheets.")
    if not rows:
        raise ServiceError(422, "EMPTY", "No rows were found. Fill in the template starting on row 2.")
    return rows, warnings


def _kind(cat: str, key: str) -> str:
    return next((c.kind for c in COLS[cat] if c.key == key), "text")


_DMY = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$")


def _date_text(v: str) -> str:
    m = _DMY.match(v)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()  # day first
        except ValueError:
            return v
    return v


# ---------------------------------------------------------------- checking rows

@dataclass
class Context:
    masters: dict[str, dict[str, tuple[str, bool]]]  # kind -> lower name -> (name, active)
    mg_taken: dict[str, str]  # value -> item id that already has it
    serial_taken: dict[str, str]
    accepted: dict[str, dict[str, str]] = field(default_factory=dict)  # kind -> lower name -> name: new Master data the person agreed to add


def clean_new(new: dict | None) -> dict[str, list[str]]:
    """Tidies the names a person agreed to add to Master data: known kinds only, trimmed, no blanks or repeats."""
    out: dict[str, list[str]] = {}
    for kind, names in (new or {}).items():
        if kind not in set(MASTER_KIND.values()):
            continue
        seen: dict[str, str] = {}
        for n in names[:200]:
            t = re.sub(r"\s+", " ", str(n)).strip()
            if t and len(t) <= 100:
                seen.setdefault(t.lower(), t)
        if seen:
            out[kind] = list(seen.values())
    return out


def load_context(db: Session, rows: list[dict], new: dict[str, list[str]] | None = None) -> Context:
    masters: dict[str, dict[str, tuple[str, bool]]] = {k: {} for k in MASTER_KIND.values()}
    for r in db.scalars(select(MasterRow)):
        masters[r.kind][r.name.strip().lower()] = (r.name, r.active)
    mgs = {str(r["f"].get("mg", "")).strip() for r in rows} - {""}
    sns = {str(r["f"].get("sn", "")).strip() for r in rows if r["c"] == "Asset"} - {""}
    mg_taken = {m: i for i, m in db.execute(select(Item.id, Item.mg_no).where(Item.mg_no.in_(mgs))).all()} if mgs else {}
    sn_taken = {s: i for i, s in db.execute(select(Item.id, Item.serial_no).where(Item.category == "Asset", Item.serial_no.in_(sns))).all()} if sns else {}
    return Context(masters, mg_taken, sn_taken, {k: {n.lower(): n for n in v} for k, v in clean_new(new).items()})


def _check_value(cat: str, c: Col, raw: str, ctx: Context) -> tuple[str, str | None, bool]:
    """Returns (cleaned value, problem or None, whether the value is simply missing from Master data)."""
    v = (raw or "").strip()
    if not v:
        return "", ("Required" if is_required(cat, c.key) else None), False
    k = c.kind
    if k == "text":
        lim = LIMIT.get(c.key, 100)
        return (v, f"Too long (up to {lim} characters)", False) if len(v) > lim else (v, None, False)
    if k in MASTER_KIND:
        hit = ctx.masters[MASTER_KIND[k]].get(v.lower())
        if hit is None:
            added = ctx.accepted.get(MASTER_KIND[k], {}).get(v.lower())
            if added:
                return added, None, False  # the person agreed to add it to Master data
            return v, f"'{v}' is not in Master data ({MASTER_NAME[k]})", True
        if not hit[1]:
            return v, f"'{hit[0]}' is deactivated in Master data", False
        return hit[0], None, False  # use the exact spelling from Master data
    if k == "status":
        hit = next((s for s in CREATE_STATUSES if s.lower() == v.lower()), None)
        return (hit, None, False) if hit else (v, "Use Available, Assigned or In Use", False)
    if k == "date":
        try:
            d = date.fromisoformat(v)
        except ValueError:
            return v, "Use the format 2026-11-10", False
        if not 1990 <= d.year <= 2100:
            return v, "Check the year", False
        return d.isoformat(), None, False
    if k == "int":
        try:
            n = Decimal(v.replace(",", "").replace(" ", ""))
        except InvalidOperation:
            return v, "Must be a whole number", False
        if n != n.to_integral_value() or n < 0 or n > 1_000_000:
            return v, "Must be a whole number from 0 to 1,000,000", False
        if c.key == "qty" and cat == "License" and n < 1:
            return v, "A license needs at least 1 seat", False
        return str(int(n)), None, False
    if k == "money":
        try:
            n = Decimal(v.replace(",", "").replace(" ", ""))
        except InvalidOperation:
            return v, "Must be a number", False
        if n < 0 or n >= Decimal(10) ** 12:
            return v, "Must be 0 or more", False
        if n != n.quantize(Decimal("0.01")):
            return v, "Use at most 2 decimals", False
        return format(n.quantize(Decimal("0.01")), "f"), None, False
    return v, None, False


def validate_rows(rows: list[dict], ctx: Context) -> list[dict]:
    """Checks every row. Returns the rows with `f` tidied up and `e` = {field: problem}. A row with an empty `e` is ready to import."""
    out: list[dict] = []
    seen_mg: dict[str, str] = {}
    seen_sn: dict[str, str] = {}
    for r in rows:
        cat = r["c"]
        f_in = r.get("f", {})
        f: dict[str, str] = {}
        e: dict[str, str] = {}
        u: list[str] = []  # fields whose value is just not in Master data yet
        for c in COLS[cat]:
            v, problem, unknown = _check_value(cat, c, str(f_in.get(c.key, "") or ""), ctx)
            f[c.key] = v
            if problem:
                e[c.key] = problem
            if unknown:
                u.append(c.key)
        where = f"row {r['n']} on '{SHEETS[cat]}'"
        if f.get("mg") and "mg" not in e:
            if f["mg"] in ctx.mg_taken:
                e["mg"] = f"Already used by {ctx.mg_taken[f['mg']]}"
            elif f["mg"] in seen_mg:
                e["mg"] = f"Same MG No as {seen_mg[f['mg']]}"
            else:
                seen_mg[f["mg"]] = where
        if cat == "Asset" and f.get("sn") and "sn" not in e:
            if f["sn"] in ctx.serial_taken:
                e["sn"] = f"Already used by {ctx.serial_taken[f['sn']]}"
            elif f["sn"] in seen_sn:
                e["sn"] = f"Same serial number as {seen_sn[f['sn']]}"
            else:
                seen_sn[f["sn"]] = where
        out.append({"key": r["key"], "c": cat, "n": r["n"], "f": f, "e": e, "u": u})
    return out


def restrict_projects(results: list[dict], allowed: set[str]) -> list[dict]:
    """For an OIC/User: a row may only use a project they are assigned to."""
    for r in results:
        v = (r["f"].get("project") or "").strip()
        if v and v.lower() not in allowed and "project" not in r["e"]:
            r["e"]["project"] = "Not one of your assigned projects"
    return results


# ---------------------------------------------------------------- saving

def summary_counts(rows: list[dict]) -> dict[str, int]:
    return {PLURAL[c]: sum(1 for r in rows if r["c"] == c) for c in CATEGORIES}


def summary_text(rows: list[dict], new: dict[str, list[str]] | None = None) -> str:
    n = summary_counts(rows)
    extra = sum(len(v) for v in (new or {}).values())
    return f"Import {len(rows)} items from Excel ({n['assets']} assets, {n['licenses']} licenses, {n['spares']} spares)" + (f" and add {extra} new Master data entr{'y' if extra == 1 else 'ies'}" if extra else "")


def used_new(rows: list[dict], ctx: Context) -> dict[str, list[str]]:
    """Of the Master data the person agreed to add, only what the given (valid) rows actually use."""
    used: dict[str, dict[str, str]] = {}
    for r in rows:
        for c in COLS[r["c"]]:
            if c.kind not in MASTER_KIND:
                continue
            kind, v = MASTER_KIND[c.kind], (r["f"].get(c.key) or "")
            if v and v.lower() not in ctx.masters[kind] and v.lower() in ctx.accepted.get(kind, {}):
                used.setdefault(kind, {})[v.lower()] = v
    return {k: sorted(v.values(), key=str.lower) for k, v in used.items()}


def create_all(db: Session, actor_name: str, actor: User | None, rows: list[dict], ip: str | None, by: str | None = None, summary: str | None = None,
               new: dict[str, list[str]] | None = None) -> dict:
    """Saves already-checked rows in the caller's transaction (the caller commits). All or nothing.
    `new` is Master data to add first (names the person agreed to create); it is created in the same transaction."""
    for kind, names in (new or {}).items():
        for n in names:
            masters.create(db, actor, kind, n, {}, ip, commit=False, actor_name=actor_name)
    order = {c: i for i, c in enumerate(CATEGORIES)}
    ids: dict[str, list[str]] = {c: [] for c in CATEGORIES}
    for r in sorted(rows, key=lambda x: (order[x["c"]], x["n"])):
        o = items.validate_create(db, r["c"], r["f"])  # the same rules as the Add item form
        ids[r["c"]].append(items.create(db, actor_name, actor, r["c"], o, ip, by=by, note="Imported from Excel", log_audit=False))
    flat = [i for c in CATEGORIES for i in ids[c]]
    audit.add(db, actor_id=actor.id if actor else None, actor=actor_name, action="items_imported", target=None,
              detail=((summary or f"Imported {len(flat)} items from Excel") + (f" · {flat[0]} to {flat[-1]}" if flat else ""))[:200], ip=ip)
    return {"created": len(flat), "ids": {PLURAL[c]: ids[c] for c in CATEGORIES}, "masters_created": new or {}}
