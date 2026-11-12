"""allow bulk imports to wait for approval

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint('ck_requests_kind', 'change_requests', type_='check')
    op.create_check_constraint('ck_requests_kind', 'change_requests', "kind IN ('create','update','action','attachment','import')")


def downgrade() -> None:
    op.execute("DELETE FROM change_requests WHERE kind = 'import'")
    op.drop_constraint('ck_requests_kind', 'change_requests', type_='check')
    op.create_check_constraint('ck_requests_kind', 'change_requests', "kind IN ('create','update','action','attachment')")
