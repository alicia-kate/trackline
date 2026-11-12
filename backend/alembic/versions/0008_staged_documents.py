"""documents uploaded together with a new item

A document can now be uploaded before its item exists (status 'staged', then 'pending' while the item waits for approval).
Such a document has no item until the item is created, so attachments.item_id may be empty.

Revision ID: 0008
Revises: 0007
"""
from alembic import op

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('attachments', 'item_id', nullable=True)
    op.drop_constraint('ck_attachments_status', 'attachments', type_='check')
    op.create_check_constraint('ck_attachments_status', 'attachments', "status IN ('active','pending','rejected','deleted','staged')")


def downgrade() -> None:
    op.execute("DELETE FROM attachment_items WHERE attachment_id IN (SELECT id FROM attachments WHERE item_id IS NULL)")
    op.execute("DELETE FROM attachments WHERE item_id IS NULL")
    op.drop_constraint('ck_attachments_status', 'attachments', type_='check')
    op.create_check_constraint('ck_attachments_status', 'attachments', "status IN ('active','pending','rejected','deleted')")
    op.alter_column('attachments', 'item_id', nullable=False)
