from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def fmt(dt: datetime | None) -> str:
    """'2026-11-10 14:30' in the configured display timezone (the format the frontend already uses)."""
    if dt is None:
        return ""
    return dt.astimezone(ZoneInfo(settings.display_timezone)).strftime("%Y-%m-%d %H:%M")
