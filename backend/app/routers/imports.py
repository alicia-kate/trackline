from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.core.errors import ServiceError
from app.models import User
from app.schemas import ImportCommitIn, ImportRowsIn
from app.services import access, importer, workflow

router = APIRouter(prefix="/api/import", tags=["import"])
writer = require_role("admin", "manager", "oic")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _scoped(user: User, results: list[dict]) -> list[dict]:
    return importer.restrict_projects(results, access.assigned(user)) if user.role == "oic" else results


def _rows(body: ImportRowsIn) -> list[dict]:
    rows = [r.model_dump() for r in body.rows]
    for r in rows:
        if any(len(v) > 2000 for v in r["f"].values()):
            raise ServiceError(422, "TOO_LONG", "A cell holds too much text.")
    return rows


@router.get("/template")
def template(_: User = Depends(writer), db: Session = Depends(get_db)):
    return Response(importer.template_bytes(db), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="trackline-import-template.xlsx"', "Cache-Control": "no-store"})


@router.post("/check")
def check(file: UploadFile = File(...), user: User = Depends(writer), db: Session = Depends(get_db)):
    """Reads the file and checks every row. Saves nothing."""
    data = file.file.read(importer.MAX_BYTES + 1)
    rows, warnings = importer.parse(data)
    return {"rows": _scoped(user, importer.validate_rows(rows, importer.load_context(db, rows))), "warnings": warnings, "cols": importer.columns_payload(), "max": importer.MAX_ROWS}


@router.post("/check-rows")
def check_rows(body: ImportRowsIn, user: User = Depends(writer), db: Session = Depends(get_db)):
    """Checks rows again after the person edited them on the page. Saves nothing."""
    rows = _rows(body)
    return {"rows": _scoped(user, importer.validate_rows(rows, importer.load_context(db, rows, body.new)))}


@router.post("/commit")
def commit(body: ImportCommitIn, request: Request, user: User = Depends(writer), db: Session = Depends(get_db)):
    return workflow.import_rows(db, user, _rows(body), body.only_valid, body.new, client_ip(request))
