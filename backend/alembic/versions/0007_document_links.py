"""one document can be linked to many items

attachment_items lists every item a document belongs to. Existing documents are linked to the item they were uploaded on.

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'attachment_items',
        sa.Column('attachment_id', sa.BigInteger(), nullable=False),
        sa.Column('item_id', sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(['attachment_id'], ['attachments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('attachment_id', 'item_id'),
    )
    op.create_index('ix_attachment_items_item_id', 'attachment_items', ['item_id'])
    op.execute("INSERT INTO attachment_items (attachment_id, item_id) SELECT id, item_id FROM attachments")


def downgrade() -> None:
    op.drop_index('ix_attachment_items_item_id', table_name='attachment_items')
    op.drop_table('attachment_items')
