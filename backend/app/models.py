from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Identity, Index, Integer, Numeric, String, Text,
                        UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin','manager','oic','viewer')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(30), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(100))  # how items write this person's name (OIC / current user)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    must_change_password: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    failed_login_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    project_rows: Mapped[list["UserProject"]] = relationship(lazy="selectin", cascade="all, delete-orphan", order_by="UserProject.project")

    @property
    def projects(self) -> list[str]:
        return [p.project for p in self.project_rows]


class UserProject(Base):
    """A project an OIC/User may work in. The name matches Master data (projects)."""
    __tablename__ = "user_projects"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    project: Mapped[str] = mapped_column(String(100), primary_key=True)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_username: Mapped[str | None] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(40))
    target: Mapped[str | None] = mapped_column(String(100))
    detail: Mapped[str | None] = mapped_column(String(500))
    ip: Mapped[str | None] = mapped_column(String(45))


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("category IN ('Asset','License','Spare')", name="ck_items_category"),
        # Blank values are stored as NULL, so only real values must be unique.
        Index("uq_items_mg_no", "mg_no", unique=True, postgresql_where=text("mg_no IS NOT NULL")),
        Index("uq_items_asset_serial", "serial_no", unique=True, postgresql_where=text("category = 'Asset' AND serial_no IS NOT NULL")),
    )

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # e.g. AST-1001
    category: Mapped[str] = mapped_column(String(10))
    description: Mapped[str] = mapped_column(String(200))
    make: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    serial_no: Mapped[str | None] = mapped_column(String(120))  # serial number, license key or part number
    mg_no: Mapped[str | None] = mapped_column(String(50))
    qty: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    min_qty: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    purchase_date: Mapped[date | None] = mapped_column(Date)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    project: Mapped[str | None] = mapped_column(String(100))
    vendor: Mapped[str | None] = mapped_column(String(100))
    expiry_date: Mapped[date | None] = mapped_column(Date)  # license renewal / expiry
    warranty_expiry: Mapped[date | None] = mapped_column(Date)  # warranty or support end (assets)
    purpose: Mapped[str | None] = mapped_column(String(500))  # what the item is used for (`description` holds the item's name)
    warranty_info: Mapped[str | None] = mapped_column(String(300))  # warranty / support terms, contract no., who to call
    status: Mapped[str] = mapped_column(String(20), server_default=text("'Available'"))
    location: Mapped[str | None] = mapped_column(String(100))
    oic: Mapped[str | None] = mapped_column(String(100))
    used_by: Mapped[str | None] = mapped_column(String(100))
    department: Mapped[str | None] = mapped_column(String(100))
    remarks: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ItemHistory(Base):
    __tablename__ = "item_history"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    action: Mapped[str] = mapped_column(String(40))
    note: Mapped[str | None] = mapped_column(String(500))
    by: Mapped[str | None] = mapped_column(String(120))


class MasterRow(Base):
    __tablename__ = "master_data"
    __table_args__ = (
        UniqueConstraint("kind", "name", name="uq_master_kind_name"),
        CheckConstraint("kind IN ('projects','vendors','locations','departments')", name="ck_master_kind"),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))


class ChangeRequest(Base):
    __tablename__ = "change_requests"
    __table_args__ = (
        CheckConstraint("kind IN ('create','update','action','attachment','import','access')", name="ck_requests_kind"),
        CheckConstraint("status IN ('pending','approved','rejected')", name="ck_requests_status"),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    kind: Mapped[str] = mapped_column(String(12))
    item_id: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(10))
    action: Mapped[str | None] = mapped_column(String(12))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    summary: Mapped[str] = mapped_column(String(300))
    requested_by: Mapped[str] = mapped_column(String(50))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(10), server_default=text("'pending'"), index=True)
    decided_by: Mapped[str | None] = mapped_column(String(50))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(300))


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (CheckConstraint("status IN ('active','pending','rejected','deleted','staged')", name="ck_attachments_status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("items.id", ondelete="RESTRICT"), index=True)  # empty until the item exists
    doc_type: Mapped[str] = mapped_column(String(30))
    original_name: Mapped[str] = mapped_column(String(255))  # shown to people, never used as a path
    stored_path: Mapped[str] = mapped_column(String(400), unique=True)  # relative to STORAGE_ROOT
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(10), server_default=text("'active'"))
    request_id: Mapped[int | None] = mapped_column(ForeignKey("change_requests.id", ondelete="SET NULL"))
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_by: Mapped[str] = mapped_column(String(50))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_by: Mapped[str | None] = mapped_column(String(50))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AttachmentItem(Base):
    """The items a document belongs to. One document can be linked to many items."""
    __tablename__ = "attachment_items"

    attachment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("attachments.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(20), ForeignKey("items.id", ondelete="RESTRICT"), primary_key=True, index=True)


class StockMovement(Base):
    """One line per stock in / stock out on a spare, so the balance can be traced."""
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("direction IN ('in','out')", name="ck_stock_direction"),
        CheckConstraint("qty > 0", name="ck_stock_qty"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    direction: Mapped[str] = mapped_column(String(3))
    qty: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(String(200))
    issued_to: Mapped[str | None] = mapped_column(String(100))
    remarks: Mapped[str | None] = mapped_column(String(500))
    by: Mapped[str | None] = mapped_column(String(120))
