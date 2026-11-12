"""items.purpose: what the item is used for (items.description stays the item's name)

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('items', sa.Column('purpose', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('items', 'purpose')
