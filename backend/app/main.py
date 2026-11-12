from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.deps import csrf_guard
from app.core.errors import ServiceError
from app.routers import attachments, auth, imports, items, masters, requests, users

app = FastAPI(
    title="Trackline API",
    dependencies=[Depends(csrf_guard)],
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)


@app.exception_handler(ServiceError)
async def service_error(_: Request, e: ServiceError):
    return JSONResponse(status_code=e.status, content={"detail": {"code": e.code, "message": e.message}})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(items.router)
app.include_router(masters.router)
app.include_router(requests.router)
app.include_router(attachments.router)
app.include_router(imports.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
