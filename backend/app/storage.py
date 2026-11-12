"""All file-system work for uploaded documents lives here, so moving to cloud storage later means changing this one file."""
import hashlib
import os
import time
import uuid
import zipfile
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings
from app.core.errors import ServiceError

# extension -> (content type served back, required start of file)
TYPES: dict[str, tuple[str, bytes]] = {
    ".pdf": ("application/pdf", b"%PDF-"),
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b"PK\x03\x04"),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"PK\x03\x04"),
}
ZIP_MARKER = {".xlsx": "xl/workbook.xml", ".docx": "word/document.xml"}
CHUNK = 1024 * 1024


def root() -> Path:
    if not settings.storage_root.strip():
        raise ServiceError(503, "STORAGE_OFF", "Document storage is not set up. Ask an admin to set STORAGE_ROOT.")
    p = Path(settings.storage_root.strip())
    if not p.is_dir():
        raise ServiceError(503, "STORAGE_MISSING", "The document storage folder cannot be found. Ask an admin to check STORAGE_ROOT.")
    return p.resolve()


def resolve(rel: str) -> Path:
    """Turns a path stored in the database into a real path, refusing anything that escapes the storage folder."""
    base = root()
    p = (base / rel).resolve()
    if not p.is_relative_to(base):
        raise ServiceError(400, "BAD_PATH", "Invalid file path.")
    return p


def _replace(src: Path, dst: Path) -> None:
    # OneDrive or antivirus can hold a file for a moment right after it is written, so retry briefly.
    for n in range(6):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if n == 5:
                raise ServiceError(503, "FILE_LOCKED", "The storage folder is busy (is OneDrive syncing?). Try again in a moment.")
            time.sleep(0.3)


def save(stream: BinaryIO, original_name: str, rel_dir: str) -> tuple[str, str, int, str]:
    """Checks and stores one upload. Returns (relative path, content type, size, sha256)."""
    ext = Path(original_name).suffix.lower()
    if ext not in TYPES:
        raise ServiceError(415, "BAD_TYPE", "Allowed file types: PDF, JPG, PNG, Excel (xlsx) and Word (docx).")
    content_type, magic = TYPES[ext]
    limit = settings.max_upload_mb * CHUNK
    base = root()
    dest = (base / rel_dir).resolve()
    if not dest.is_relative_to(base):
        raise ServiceError(400, "BAD_PATH", "Invalid file path.")
    dest.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    tmp, final = dest / f".{uuid.uuid4().hex}.part", dest / name
    digest, size, first = hashlib.sha256(), 0, True
    try:
        with open(tmp, "wb") as out:
            while chunk := stream.read(CHUNK):
                if first:
                    first = False
                    if not chunk.startswith(magic):
                        raise ServiceError(415, "BAD_CONTENT", "The file content does not match its type.")
                size += len(chunk)
                if size > limit:
                    raise ServiceError(413, "TOO_BIG", f"Files can be up to {settings.max_upload_mb} MB.")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise ServiceError(422, "EMPTY", "That file is empty.")
        if ext in ZIP_MARKER:
            try:
                with zipfile.ZipFile(tmp) as z:
                    ok = ZIP_MARKER[ext] in z.namelist()
            except zipfile.BadZipFile:
                ok = False
            if not ok:
                raise ServiceError(415, "BAD_CONTENT", "The file content does not match its type.")
        _replace(tmp, final)
    finally:
        tmp.unlink(missing_ok=True)
    return f"{rel_dir}/{name}", content_type, size, digest.hexdigest()
